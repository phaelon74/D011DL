import { FastifyInstance } from 'fastify';
import { createDownloadBodySchema } from '../schemas';
import pool from '../db/pool';
import downloadQueue from './queue';
import { processDownloadJob } from './worker';
import { STORAGE_ROOT } from '../config';
import path from 'path';

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
