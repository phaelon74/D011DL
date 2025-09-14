import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import pool from '../db/pool';
import { checkExists, copyDirectory, moveDirectory, deleteDirectory, listDirectoryContents } from '../util/filesystem';
import fsQueue from '../jobs/fsQueue';
import { processFsJob } from '../jobs/fsWorker';
import path from 'path';
import got from 'got';
import { STORAGE_ROOT, NET_STORAGE_ROOT } from '../config';

const modelRoutes = async (server: FastifyInstance) => {
    server.addHook('onRequest', server.authenticate);

    const modelParamsSchema = z.object({ id: z.string().uuid() });

    // Helper to get a model and its paths
    async function getModelAndPaths(id: string) {
        const modelRes = await pool.query('SELECT * FROM models WHERE id = $1', [id]);
        if (modelRes.rows.length === 0) return null;
        
        const model = modelRes.rows[0];
        const sourcePath = model.root_path;
        const netPath = sourcePath.replace('/media/models', '/media/netmodels');
        return { model, sourcePath, netPath };
    }

    // Copy model (between /media/models and /media/netmodels depending on current location)
    server.post('/models/:id/copy', { preHandler: [server.authenticate] }, async (request, reply) => {
        try {
            const { id: modelId } = request.params as { id: string };

            const modelRes = await pool.query('SELECT * FROM models WHERE id = $1', [modelId]);
            if (modelRes.rows.length === 0) {
                return reply.code(404).send({ message: 'Model not found' });
            }
            const model = modelRes.rows[0];

            const hasPrimary = model.locations.some((loc: string) => loc.startsWith(STORAGE_ROOT));
            const hasNet = model.locations.some((loc: string) => loc.startsWith(NET_STORAGE_ROOT));

            if (hasPrimary && hasNet) {
                return reply.code(409).send({ message: 'Model already exists at both locations.' });
            }

            let sourcePath: string | null = null;
            let destPath: string | null = null;
            if (hasPrimary) {
                sourcePath = model.locations.find((loc: string) => loc.startsWith(STORAGE_ROOT));
                destPath = path.join(NET_STORAGE_ROOT, model.author, model.repo, model.revision);
            } else if (hasNet) {
                sourcePath = model.locations.find((loc: string) => loc.startsWith(NET_STORAGE_ROOT));
                destPath = path.join(STORAGE_ROOT, model.author, model.repo, model.revision);
            } else {
                return reply.code(400).send({ message: 'Model has no known on-disk location to copy from.' });
            }

            if (!sourcePath || !await checkExists(sourcePath)) {
                return reply.code(400).send({ message: 'Source model not found on disk.' });
            }
            
            // --- START DEBUG LOGGING for COPY ---
            console.log('[DEBUG] Initiating COPY operation for model ID:', modelId);
            console.log('[DEBUG] Destination path being checked:', destPath);
            // --- END DEBUG LOGGING for COPY ---

            if (await checkExists(destPath)) {
                console.error(`[ERROR] Copy failed: Destination path ${destPath} already exists.`);
                return reply.code(409).send({ message: 'Model already exists at the destination.' });
            }

            const jobRes = await pool.query(
                'INSERT INTO fs_jobs (model_id, type, source_path, destination_path, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                [modelId, 'copy', sourcePath, destPath, 'queued']
            );
            const jobId = jobRes.rows[0].id;
        
            fsQueue.add(() => processFsJob(jobId));
        
            reply.code(202).send({ message: 'Copy job started', jobId });
        } catch (error) {
            console.error('Error starting copy job:', error);
            reply.code(500).send({ message: 'Failed to start copy job.' });
        }
    });

    // Rescan model directory
    server.post('/models/:id/rescan', async (request, reply) => {
        try {
            const { id } = modelParamsSchema.parse(request.params);
            const modelRes = await pool.query('SELECT * FROM models WHERE id = $1', [id]);
            if (modelRes.rows.length === 0) return reply.code(404).send({ message: 'Model not found in DB' });

            const model = modelRes.rows[0];
            const { author, repo, revision, root_path } = model;

            // 1. Get official file list from Hugging Face
            const treeUrl = `https://huggingface.co/api/models/${author}/${repo}/tree/${revision}`;
            const hfFileList: { path: string; size: number; type: string }[] = await got(treeUrl, { responseType: 'json' }).json();
            const officialFiles = hfFileList.filter(f => f.type === 'file');
            const officialTotalSize = officialFiles.reduce((acc, file) => acc + file.size, 0);

            // 2. Get local file list
            const localFiles = await listDirectoryContents(root_path);
            const localTotalSize = localFiles.reduce((acc, file) => acc + file.size, 0);

            // 3. Compare and update database
            if (localTotalSize >= officialTotalSize && officialTotalSize > 0) {
                const latestDownloadRes = await pool.query('SELECT id FROM downloads WHERE model_id = $1 ORDER BY created_at DESC LIMIT 1', [id]);
                if (latestDownloadRes.rows.length > 0) {
                    const downloadId = latestDownloadRes.rows[0].id;
                    await pool.query("UPDATE downloads SET status = 'succeeded', finished_at = now(), progress_pct = 100, bytes_downloaded = $1, total_bytes = $1 WHERE id = $2", [officialTotalSize, downloadId]);
                }
                await pool.query("UPDATE models SET is_downloaded = true, updated_at = now(), locations = ARRAY[$1] WHERE id = $2", [root_path, id]);
                return reply.send({ message: 'Rescan complete. Model status updated to succeeded.' });
            } else {
                return reply.code(409).send({ message: `Rescan complete. Model is incomplete. On disk: ${localTotalSize} bytes, Expected: ${officialTotalSize} bytes.` });
            }

        } catch (error) {
            console.error(error);
            reply.code(500).send({ message: 'Internal Server Error during rescan' });
        }
    });

    // Move model: allowed only from /media/models -> /media/netmodels; copy, verify, then delete source
    server.post('/models/:id/move', { preHandler: [server.authenticate] }, async (request, reply) => {
        try {
            const { id: modelId } = request.params as { id: string };
            const modelRes = await pool.query('SELECT * FROM models WHERE id = $1', [modelId]);
            if (modelRes.rows.length === 0) {
                return reply.code(404).send({ message: 'Model not found' });
            }
            const model = modelRes.rows[0];

            const hasPrimary = model.locations.some((loc: string) => loc.startsWith(STORAGE_ROOT));
            const hasNet = model.locations.some((loc: string) => loc.startsWith(NET_STORAGE_ROOT));

            // Only allow moving when it exists only in primary
            if (hasPrimary && !hasNet) {
                // move from primary to netmodels
                const sourcePath = model.locations.find((loc: string) => loc.startsWith(STORAGE_ROOT));
                const destPath = path.join(NET_STORAGE_ROOT, model.author, model.repo, model.revision);
                const jobRes = await pool.query(
                    'INSERT INTO fs_jobs (model_id, type, source_path, destination_path, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                    [modelId, 'move', sourcePath, destPath, 'queued']
                );
                const jobId = jobRes.rows[0].id;
                fsQueue.add(() => processFsJob(jobId));
                return reply.code(202).send({ message: 'Move job started', jobId });
            } else {
                return reply.code(409).send({ message: 'Move is only enabled when the model exists only in /media/models.' });
            }
        } catch (error) {
            console.error('Error starting move job:', error);
            reply.code(500).send({ message: 'Failed to start move job.' });
        }
    });

    // Delete model
    const deleteBodySchema = z.object({
        locationsToDelete: z.array(z.string())
    });
    server.post('/models/:id/delete', { preHandler: [server.authenticate] }, async (request, reply) => {
        try {
            const { id: modelId } = request.params as { id: string };
            const { locationsToDelete } = deleteBodySchema.parse(request.body);
            const modelRes = await pool.query('SELECT locations FROM models WHERE id = $1', [modelId]);
            if (modelRes.rows.length === 0) return reply.code(404).send({ message: 'Model not found' });
            
            // Delete the files from the filesystem
            for (const loc of locationsToDelete) {
                await deleteDirectory(loc);
            }
            
            const currentLocations = modelRes.rows[0].locations;
            const newLocations = currentLocations.filter((loc: string) => !locationsToDelete.includes(loc));

            if (newLocations.length === 0) {
                // If all locations are deleted, purge the model record entirely.
                await pool.query('DELETE FROM models WHERE id = $1', [modelId]);
            } else {
                // Otherwise, just update the locations array.
                await pool.query('UPDATE models SET locations = $1 WHERE id = $2', [newLocations, modelId]);
            }

            reply.send({ message: 'Model deleted successfully from specified locations' });
        } catch (error) {
            console.error(error);
            reply.code(500).send({ message: 'Internal Server Error' });
        }
    });
};

export default modelRoutes;
