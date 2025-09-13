import { FastifyInstance } from 'fastify';
import { createDownloadBodySchema } from '../schemas';
import pool from '../db/pool';
import downloadQueue from './queue';
import { processDownloadJob } from './worker';
import { STORAGE_ROOT } from '../config';

const downloadsRoutes = async (server: FastifyInstance) => {
    // All routes in this plugin are protected
    server.addHook('onRequest', server.authenticate);
    
    // Create download job
    server.post('/downloads', { preHandler: [server.authenticate] }, async (request, reply) => {
        try {
            const { author, repo, revision, selection } = createDownloadBodySchema.parse(request.body);
            const userId = request.user?.id;
            const rootPath = `${STORAGE_ROOT}/${author}/${repo}/${revision}`;

            // 1. Upsert model
            const modelRes = await pool.query(
                `INSERT INTO models (author, repo, revision, root_path, locations)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (author, repo, revision) DO UPDATE SET updated_at = now()
                 RETURNING id`,
                [author, repo, revision, rootPath, [rootPath]]
            );
            const modelId = modelRes.rows[0].id;

            // 2. Create download job record
            const jobRes = await pool.query(
                'INSERT INTO downloads (model_id, selection_json, status) VALUES ($1, $2, $3) RETURNING id',
                [modelId, JSON.stringify(selection), 'queued']
            );
            const jobId = jobRes.rows[0].id;

            downloadQueue.add(() => processDownloadJob(jobId));

            reply.code(202).send({ download_id: jobId, status: 'queued' });

        } catch (error) {
            if (error instanceof z.ZodError) {
                return reply.code(400).send({ message: 'Validation error', issues: error.issues });
            }
            console.error(error);
            reply.code(500).send({ message: 'Internal Server Error' });
        }
    });

    // Get download job status
    const getStatusParamsSchema = z.object({ id: z.string().uuid() });
    server.get('/downloads/:id', async (request, reply) => {
        try {
            const { id } = getStatusParamsSchema.parse(request.params);
            const res = await pool.query(
                'SELECT status, progress_pct, started_at, finished_at, log FROM downloads WHERE id = $1',
                [id]
            );

            if (res.rows.length === 0) {
                return reply.code(404).send({ message: 'Job not found' });
            }

            reply.send(res.rows[0]);
        } catch(error) {
            if (error instanceof z.ZodError) {
                return reply.code(400).send({ message: 'Validation error', issues: error.issues });
            }
            console.error(error);
            reply.code(500).send({ message: 'Internal Server Error' });
        }
    });

    // Retry download job
    const retryParamsSchema = z.object({ id: z.string().uuid() });
    server.post('/downloads/:id/retry', { onRequest: [server.authenticate] }, async (request: FastifyRequest, reply) => {
        try {
            const { id } = retryParamsSchema.parse(request.params);

            // Find the original failed job to get its details
            const originalJobRes = await pool.query('SELECT model_id FROM downloads WHERE id = $1', [id]);
            if (originalJobRes.rows.length === 0) {
                return reply.code(404).send({ message: 'Original job not found' });
            }
            const { model_id } = originalJobRes.rows[0];
            const userId = request.user?.id;
            
            // Re-use the same selection from the original job
            const originalSelectionRes = await pool.query('SELECT selection_json FROM downloads WHERE id = $1', [id]);
            const selection = originalSelectionRes.rows[0].selection_json;

            // Create a new download job record
            const newDownloadRes = await pool.query(
                `INSERT INTO downloads (model_id, user_id, selection_json, status) 
                 VALUES ($1, $2, $3, 'queued')
                 RETURNING id`,
                [model_id, userId, JSON.stringify(selection)]
            );
            const newDownloadId = newDownloadRes.rows[0].id;
            
            // Add the new job to the queue
            downloadQueue.add(() => processDownloadJob(newDownloadId));

            reply.code(202).send({ new_download_id: newDownloadId, status: 'queued' });

        } catch (error) {
            console.error(error);
            reply.code(500).send({ message: 'Internal Server Error' });
        }
    });
};

export default downloadsRoutes;
