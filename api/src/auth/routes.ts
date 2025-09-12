import { FastifyInstance, FastifyRequest } from 'fastify';
import { createUser, findUserByUsername } from './service';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

const JWT_SECRET = process.env.JWT_SECRET || 'replace_me';

const authRoutes = async (server: FastifyInstance) => {
    // Register
    const registerBodySchema = z.object({
        username: z.string(),
        password: z.string(),
    });
    server.post('/auth/register', async (request, reply) => {
        try {
            const { username, password } = registerBodySchema.parse(request.body);
            const user = await createUser({ username, password });
            reply.code(201).send(user);
        } catch (error) {
            if (error instanceof z.ZodError) {
                return reply.code(400).send({ message: 'Validation error', issues: error.issues });
            }
            console.error(error);
            reply.code(500).send({ message: 'Internal Server Error' });
        }
    });

    // Login
    const loginBodySchema = z.object({
        username: z.string(),
        password: z.string(),
    });
    server.post('/auth/login', async (request, reply) => {
        try {
            const { username, password } = loginBodySchema.parse(request.body);
            const user = await findUserByUsername(username);

            if (!user) {
                return reply.code(401).send({ message: 'Invalid credentials' });
            }

            const isPasswordCorrect = await bcrypt.compare(password, user.password_hash);

            if (!isPasswordCorrect) {
                return reply.code(401).send({ message: 'Invalid credentials' });
            }

            const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, {
                expiresIn: '1h',
            });
            
            const { password_hash, ...userWithoutPassword } = user;

            reply.send({ token, user: userWithoutPassword });
        } catch (error) {
             if (error instanceof z.ZodError) {
                return reply.code(400).send({ message: 'Validation error', issues: error.issues });
            }
            console.error(error);
            reply.code(500).send({ message: 'Internal Server Error' });
        }
    });

    // Me (Protected)
    server.get('/auth/me', {
        onRequest: [async (request, reply) => {
            try {
                const authHeader = request.headers.authorization;
                if (!authHeader || !authHeader.startsWith('Bearer ')) {
                    return reply.code(401).send({ message: 'Unauthorized' });
                }
                const token = authHeader.substring(7);
                const decoded = jwt.verify(token, JWT_SECRET);
                request.user = decoded as any;
            } catch (err) {
                reply.code(401).send({ message: 'Unauthorized' });
            }
        }]
    }, async (request: FastifyRequest, reply) => {
        reply.send(request.user);
    });
};

export default authRoutes;
