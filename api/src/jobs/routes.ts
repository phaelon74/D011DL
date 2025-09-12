import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import pool from '../db/pool';
import queue from './queue';
import { processDownloadJob } from './worker';

const downloadsRoutes = async (server: FastifyInstance) => {
    // All routes in this plugin are protected
    server.addHook('onRequest', server.authenticate);
    
    // Create download job
    const createDownloadBodySchema = z.object({
        author: z.string(),
        repo: z.string(),
        revision: z.string().default('main'),
        selection: z.array(z.object({
            path: z.string(),
            type: z.enum(['file', 'dir'])
        }))
    });

    server.post('/downloads', async (request: FastifyRequest, reply) => {
        try {
            const { author, repo, revision, selection } = createDownloadBodySchema.parse(request.body);
            const userId = request.user?.id;
            const rootPath = `${process.env.STORAGE_ROOT}/${author}/${repo}/${revision}`;

            // 1. Upsert model
            const modelRes = await pool.query(
                `INSERT INTO models (author, repo, revision, root_path) 
                 VALUES ($1, $2, $3, $4) 
                 ON CONFLICT (author, repo, revision) DO UPDATE SET updated_at = now()
                 RETURNING id`,
                [author, repo, revision, rootPath]
            );
            const modelId = modelRes.rows[0].id;

            // 2. Create download job record
            const downloadRes = await pool.query(
                `INSERT INTO downloads (model_id, user_id, selection_json, status) 
                 VALUES ($1, $2, $3, 'queued')
                 RETURNING id`,
                [modelId, userId, JSON.stringify(selection)]
            );
            const downloadId = downloadRes.rows[0].id;
            
            // 3. Add to queue
            queue.add(() => processDownloadJob(downloadId));

            reply.code(202).send({ download_id: downloadId, status: 'queued' });

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
};

export default downloadsRoutes;
