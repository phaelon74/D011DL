import pool from './pool';

export async function getDownloads() {
    const res = await pool.query('SELECT * FROM downloads');
    return res.rows;
}
