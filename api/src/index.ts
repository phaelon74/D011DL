import fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import dotenv from 'dotenv';

import authRoutes from './auth/routes';
import hfRoutes from './hf/routes';
import downloadsRoutes from './jobs/routes';

dotenv.config({ path: '../.env' });

const server = fastify({ logger: true });

server.register(fastifyJwt, {
    secret: process.env.JWT_SECRET || 'supersecret',
});

server.register(authRoutes);
server.register(hfRoutes);
server.register(downloadsRoutes);

const start = async () => {
    try {
        const port = process.env.PORT_API ? parseInt(process.env.PORT_API, 10) : 32002;
        await server.listen({ port, host: '0.0.0.0' });
        console.log(`API server listening on port ${port}`);
    } catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};

start();
