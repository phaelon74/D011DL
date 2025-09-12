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

export async function findAndVerifyUser(username: string, password: string): Promise<User | null> {
    const query = `
        SELECT id, username, created_at, last_login_at, is_admin 
        FROM users 
        WHERE username = $1 AND password_hash = crypt($2, password_hash)
    `;
    
    const res = await pool.query(query, [username, password]);

    if (res.rows.length === 0) {
        return null;
    }
    
    return UserSchema.parse(res.rows[0]);
}
