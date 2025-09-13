import fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import authRoutes from './auth/routes';
import dbRoutes from './db/routes';
import downloadsRoutes from './jobs/routes';
import modelRoutes from './models/routes';
import { findAndVerifyUser } from './auth/service';
import pool from './db/pool';

async function reconcileStaleJobs() {
    try {
        const result = await pool.query(
            "UPDATE downloads SET status = 'failed', log = 'Job marked as failed due to server restart.' WHERE status = 'running'"
        );
        if (result.rowCount > 0) {
            console.log(`Reconciled ${result.rowCount} stale running jobs.`);
        }
    } catch (error) {
        console.error('Error reconciling stale jobs:', error);
    }
}

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
server.register(modelRoutes);

const start = async () => {
    try {
        await server.listen({ port: 32002, host: '0.0.0.0' });
        console.log(`API server listening on port 32002`);
        await reconcileStaleJobs();
    } catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};

start();
