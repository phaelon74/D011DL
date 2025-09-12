import pool from './pool';

export async function getModelFiles(modelId: string) {
    const res = await pool.query('SELECT * FROM model_files WHERE model_id = $1', [modelId]);
    return res.rows;
}
