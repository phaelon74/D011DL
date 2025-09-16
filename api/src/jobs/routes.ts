import { FastifyInstance } from 'fastify';
import { createDownloadBodySchema, createUploadBodySchema } from '../schemas';
import pool from '../db/pool';
import downloadQueue from './queue';
import { processDownloadJob } from './worker';
import { STORAGE_ROOT } from '../config';
import path from 'path';
import { processHfUploadJob } from './uploadWorker';
import uploadQueue from './uploadQueue';
import got from 'got';

const downloadsRoutes = async (server: FastifyInstance) => {

    server.post('/downloads', { preHandler: [server.authenticate] }, async (request, reply) => {
        try {
            const { author, repo, revision, selection } = createDownloadBodySchema.parse(request.body);
            
            // Build path safely to avoid accidental double slashes if STORAGE_ROOT has a trailing '/'
            const rootPath = path.join(STORAGE_ROOT, author, repo, revision);

            // 1. Upsert model
            const modelRes = await pool.query(
                `INSERT INTO models (author, repo, revision, root_path, locations)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (author, repo, revision) DO UPDATE SET
                   updated_at = now(),
                   root_path = EXCLUDED.root_path,
                   locations = (
                     CASE WHEN NOT (EXCLUDED.root_path = ANY(COALESCE(models.locations, ARRAY[]::text[])))
                          THEN array_append(COALESCE(models.locations, ARRAY[]::text[]), EXCLUDED.root_path)
                          ELSE COALESCE(models.locations, ARRAY[]::text[])
                     END
                   )
                 RETURNING id`,
                [author, repo, revision, rootPath, [rootPath]]
            );
            const modelId = modelRes.rows[0].id;

            // Create a new download job
            const jobRes = await pool.query(
                'INSERT INTO downloads (model_id, selection_json, status) VALUES ($1, $2, $3) RETURNING id',
                [modelId, JSON.stringify(selection), 'queued']
            );
            const jobId = jobRes.rows[0].id;

            downloadQueue.add(() => processDownloadJob(jobId));

            reply.code(202).send({ download_id: jobId, status: 'queued' });

        } catch (error: any) {
            console.error('Error creating download:', error);
            reply.code(500).send({ message: 'Internal Server Error' });
        }
    });

    // Trigger HF upload job for a model
    server.post('/uploads/:id', { preHandler: [server.authenticate] }, async (request, reply) => {
        try {
            const { id: modelId } = request.params as { id: string };
            const body = (request as any).body || {};
            const parsed = createUploadBodySchema.safeParse(body);

            const modelRes = await pool.query('SELECT * FROM models WHERE id = $1', [modelId]);
            if (modelRes.rows.length === 0) {
                return reply.code(404).send({ message: 'Model not found' });
            }
            const model = modelRes.rows[0];
            if (model.author !== 'TheHouseOfTheDude') {
                return reply.code(403).send({ message: 'Uploads are only enabled for author TheHouseOfTheDude' });
            }

            // Default to model.revision; clients may pass override via body later if needed
            const revision = (parsed.success && parsed.data.revision) ? parsed.data.revision : (model.revision || 'main');

            // Enforce rule: if branch exists and contains non-init files, do NOT allow upload
            let initRequired = true;
            try {
                const treeUrl = `https://huggingface.co/api/models/${model.author}/${model.repo}/tree/${encodeURIComponent(revision)}`;
                const list: any[] = await got(treeUrl, { responseType: 'json', timeout: { request: 5000 } }).json();
                const files = Array.isArray(list) ? list.filter((f: any) => f && f.type === 'file') : [];
                const ignored = new Set([`.gitattributes`, `.init-${revision}`]);
                const nonInit = files.filter((f: any) => !ignored.has(f.path));
                if (nonInit.length > 0) {
                    return reply.code(409).send({ message: 'HF branch already contains files; upload is disabled.' });
                }
                // Branch exists and effectively empty -> no init required
                initRequired = false;
            } catch (e: any) {
                // 404 or network: treat as missing (init required)
            }

            const jobRes = await pool.query('INSERT INTO hf_uploads (model_id, status, revision, init_required, log) VALUES ($1, $2, $3, $4, $5) RETURNING id', [modelId, 'queued', revision, initRequired, initRequired ? '[INIT] init_required=true' : '[INIT] init_required=false']);
            const jobId = jobRes.rows[0].id;

            uploadQueue.add(() => processHfUploadJob(jobId));

            reply.code(202).send({ upload_id: jobId, status: 'queued' });
        } catch (error: any) {
            request.log.error(error);
            reply.code(500).send({ message: 'Internal Server Error' });
        }
    });

    server.post('/downloads/:id/retry', { preHandler: [server.authenticate] }, async (request, reply) => {
        try {
            const { id: oldJobId } = request.params as { id: string };

            // 1. Get old job details
            const oldJobRes = await pool.query('SELECT * FROM downloads WHERE id = $1', [oldJobId]);
            if (oldJobRes.rows.length === 0) {
                return reply.code(404).send({ message: 'Job not found' });
            }
            const oldJob = oldJobRes.rows[0];

            // 2. Create a new job record with the same details
            const newJobRes = await pool.query(
                `INSERT INTO downloads (model_id, selection_json, status)
                 VALUES ($1, $2, 'queued')
                 RETURNING id`,
                [oldJob.model_id, oldJob.selection_json]
            );
            const newJobId = newJobRes.rows[0].id;

            // 3. Add to queue
            downloadQueue.add(() => processDownloadJob(newJobId));

            reply.code(202).send({ message: 'Retry job started', jobId: newJobId });
        } catch (error: any) {
            console.error('Error retrying job:', error);
            reply.code(500).send({ message: 'Internal Server Error' });
        }
    });
};

export default downloadsRoutes;
