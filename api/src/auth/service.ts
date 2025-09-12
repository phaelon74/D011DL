import bcrypt from 'bcrypt';
import pool from '../db/pool';
import { z } from 'zod';

const UserSchema = z.object({
    id: z.string().uuid(),
    username: z.string(),
    created_at: z.date(),
    last_login_at: z.date().nullable(),
    is_admin: z.boolean()
});

export type User = z.infer<typeof UserSchema>;

const CreateUserSchema = z.object({
    username: z.string().min(3),
    password: z.string().min(8)
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;

const BCRYPT_ROUNDS = process.env.BCRYPT_ROUNDS ? parseInt(process.env.BCRYPT_ROUNDS, 10) : 12;

export async function createUser(userData: CreateUserInput): Promise<Omit<User, 'password_hash'>> {
    const { username, password } = CreateUserSchema.parse(userData);

    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const res = await pool.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at, last_login_at, is_admin',
        [username, password_hash]
    );

    return UserSchema.omit({ id: true }).extend({ id: z.string() }).parse(res.rows[0]);
}

export async function findUserByUsername(username: string): Promise<(User & { password_hash: string }) | null> {
    const res = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (res.rows.length === 0) {
        return null;
    }
    return res.rows[0];
}
