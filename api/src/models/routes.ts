import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import pool from '../db/pool';
import { copyDirectory, moveDirectory, deleteDirectory, checkExists, listDirectoryContents } from '../util/filesystem';
import path from 'path';
import got from 'got';

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

    // Copy model
    server.post('/models/:id/copy', async (request, reply) => {
        try {
            const { id } = modelParamsSchema.parse(request.params);
            const data = await getModelAndPaths(id);
            if (!data) return reply.code(404).send({ message: 'Model not found' });
            
            const { model, sourcePath, netPath } = data;
            
            if (!await checkExists(sourcePath)) return reply.code(404).send({ message: 'Source model not found on disk' });
            if (await checkExists(netPath)) return reply.code(409).send({ message: 'Model already exists in /media/netmodels' });
            
            await copyDirectory(sourcePath, netPath);
            
            const newLocations = [...new Set([...model.locations, netPath])];
            await pool.query('UPDATE models SET locations = $1 WHERE id = $2', [newLocations, id]);
            
            reply.send({ message: 'Model copied successfully' });
        } catch (error) {
            console.error(error);
            reply.code(500).send({ message: 'Internal Server Error' });
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

    // Move model
    server.post('/models/:id/move', async (request, reply) => {
         try {
            const { id } = modelParamsSchema.parse(request.params);
            const data = await getModelAndPaths(id);
            if (!data) return reply.code(404).send({ message: 'Model not found' });
            
            const { model, sourcePath, netPath } = data;
            
            if (!await checkExists(sourcePath)) return reply.code(404).send({ message: 'Source model not found on disk' });
            if (await checkExists(netPath)) return reply.code(409).send({ message: 'Model already exists in /media/netmodels' });

            await moveDirectory(sourcePath, netPath);
            
            const newLocations = model.locations.filter((loc: string) => loc !== sourcePath).concat(netPath);
            await pool.query('UPDATE models SET locations = $1 WHERE id = $2', [newLocations, id]);

            reply.send({ message: 'Model moved successfully' });
        } catch (error) {
            console.error(error);
            reply.code(500).send({ message: 'Internal Server Error' });
        }
    });

    // Delete model
    const deleteBodySchema = z.object({
        locationsToDelete: z.array(z.string())
    });
    server.post('/models/:id/delete', async (request, reply) => {
        try {
            const { id } = modelParamsSchema.parse(request.params);
            const { locationsToDelete } = deleteBodySchema.parse(request.body);
            const modelRes = await pool.query('SELECT locations FROM models WHERE id = $1', [id]);
            if (modelRes.rows.length === 0) return reply.code(404).send({ message: 'Model not found' });
            
            for (const loc of locationsToDelete) {
                if (await checkExists(loc)) {
                    await deleteDirectory(loc);
                }
            }

            const currentLocations = modelRes.rows[0].locations;
            const newLocations = currentLocations.filter((loc: string) => !locationsToDelete.includes(loc));
            await pool.query('UPDATE models SET locations = $1 WHERE id = $2', [newLocations, id]);

            reply.send({ message: 'Model deleted successfully from specified locations' });
        } catch (error) {
            console.error(error);
            reply.code(500).send({ message: 'Internal Server Error' });
        }
    });
};

export default modelRoutes;
