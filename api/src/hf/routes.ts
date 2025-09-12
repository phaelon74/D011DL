import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parseHfUrl } from './parse';
import { listHfTree } from './listTree';
import { downloadFile } from './download';
import { getModels } from '../db/modelsRepo';
import { getModelFiles } from '../db/filesRepo';

const hfRoutes = async (server: FastifyInstance) => {

    // Middleware to check for JWT on protected routes
    const checkJwt = async (request: FastifyRequest, reply: any) => {
        try {
            const authHeader = request.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return reply.code(401).send({ message: 'Unauthorized' });
            }
            const token = authHeader.substring(7);
            const decoded = server.jwt.verify(token);
            request.user = decoded as any;
        } catch (err) {
            reply.code(401).send({ message: 'Unauthorized' });
        }
    };

    // Parse URL
    const parseUrlBodySchema = z.object({ url: z.string().url() });
    server.post('/hf/parse-url', { onRequest: [checkJwt] }, async (request, reply) => {
        try {
            const { url } = parseUrlBodySchema.parse(request.body);
            const parsed = parseHfUrl(url);
            reply.send(parsed);
        } catch (error) {
            if (error instanceof z.ZodError) {
                return reply.code(400).send({ message: 'Validation error', issues: error.issues });
            }
            reply.code(400).send({ message: (error as Error).message });
        }
    });

    // Get Refs (Branches/Tags) - Mock for now from tree
    const refsQuerySchema = z.object({ author: z.string(), repo: z.string() });
     server.get('/hf/refs', { onRequest: [checkJwt] }, async (request, reply) => {
        try {
            const { author, repo } = refsQuerySchema.parse(request.query);
            // This is a simplified version. A full implementation would use the HF API to get refs.
            // For now, we just list the default branch.
            reply.send({ branches: ['main'], tags: [] });
        } catch (error) {
             if (error instanceof z.ZodError) {
                return reply.code(400).send({ message: 'Validation error', issues: error.issues });
            }
            reply.code(500).send({ message: 'Internal Server Error' });
        }
    });

    // Get Tree
    const treeQuerySchema = z.object({
        author: z.string(),
        repo: z.string(),
        revision: z.string().optional().default('main'),
    });
    server.get('/hf/tree', { onRequest: [checkJwt] }, async (request, reply) => {
        try {
            const { author, repo, revision } = treeQuerySchema.parse(request.query);
            const files = await listHfTree(author, repo, revision);
            reply.send({ files });
        } catch (error) {
            if (error instanceof z.ZodError) {
                return reply.code(400).send({ message: 'Validation error', issues: error.issues });
            }
            reply.code(500).send({ message: (error as Error).message });
        }
    });
    
    // DB routes
    server.get('/db/models', { onRequest: [checkJwt] }, async (request, reply) => {
        const models = await getModels();
        reply.send(models);
    });

    const modelFilesParamsSchema = z.object({ id: z.string().uuid() });
    server.get('/db/models/:id/files', { onRequest: [checkJwt] }, async (request, reply) => {
        try {
            const { id } = modelFilesParamsSchema.parse(request.params);
            const files = await getModelFiles(id);
            reply.send(files);
        } catch (error) {
             if (error instanceof z.ZodError) {
                return reply.code(400).send({ message: 'Validation error', issues: error.issues });
            }
            reply.code(500).send({ message: 'Internal Server Error' });
        }
    });

};

export default hfRoutes;
