import { FastifyInstance, FastifyRequest } from 'fastify';
import { createUser, findUserByUsername } from './service';
import bcrypt from 'bcrypt';
import { z } from 'zod';

const authRoutes = async (server: FastifyInstance) => {
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

            const token = server.jwt.sign({ id: user.id, username: user.username });
            
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
        onRequest: [server.authenticate]
    }, async (request: FastifyRequest, reply) => {
        reply.send(request.user);
    });
};

export default authRoutes;
