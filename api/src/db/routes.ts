import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getModels } from '../db/modelsRepo';
import { getModelFiles } from '../db/filesRepo';

const dbRoutes = async (server: FastifyInstance) => {

    // All routes in this plugin are protected
    server.addHook('onRequest', server.authenticate);
    
    // DB routes
    server.get('/db/models', async (request, reply) => {
        try {
            const models = await getModels();
            reply.send(models);
        } catch (error: any) {
            request.log.error(error, 'Failed to load models');
            reply.code(503).send({ message: 'Service temporarily unavailable' });
        }
    });

    const modelFilesParamsSchema = z.object({ id: z.string().uuid() });
    server.get('/db/models/:id/files', async (request, reply) => {
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

export default dbRoutes;
