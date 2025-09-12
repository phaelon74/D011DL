import pool from './pool';

export async function getModels() {
    const query = `
        SELECT DISTINCT ON (m.id)
            m.id,
            m.author,
            m.repo,
            m.revision,
            m.is_downloaded,
            d.status,
            d.log,
            d.id as download_id
        FROM models m
        LEFT JOIN downloads d ON m.id = d.model_id
        ORDER BY m.id, d.started_at DESC
    `;
    const res = await pool.query(query);
    return res.rows;
}
