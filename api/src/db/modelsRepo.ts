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
            d.id as download_id,
            d.bytes_downloaded,
            d.total_bytes
        FROM models m
        LEFT JOIN downloads d ON m.id = d.model_id
        ORDER BY m.id, d.started_at DESC NULLS LAST
    `;
    const res = await pool.query(query);
    // Manually ensure locations is always an array
    res.rows.forEach(row => {
        if (!row.locations) {
            row.locations = [];
        }
    });
    return res.rows;
}
