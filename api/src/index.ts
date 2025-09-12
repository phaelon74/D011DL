import fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import authRoutes from './auth/routes';
import dbRoutes from './db/routes';
import downloadsRoutes from './jobs/routes';

const server = fastify({ logger: true });

server.register(fastifyJwt, {
    secret: process.env.JWT_SECRET || 'supersecret',
});

server.decorate("authenticate", async function(request: any, reply: any) {
    try {
      await request.jwtVerify()
    } catch (err) {
      reply.send(err)
    }
});

server.register(authRoutes);
server.register(dbRoutes);
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
