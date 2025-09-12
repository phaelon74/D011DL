import pool from './pool';

export async function getModels() {
    const res = await pool.query('SELECT * FROM models');
    return res.rows;
}
