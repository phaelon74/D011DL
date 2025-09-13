import pool from './pool';

export async function getModels() {
    const query = `
        SELECT
            m.id,
            m.author,
            m.repo,
            m.revision,
            m.root_path,
            m.is_downloaded,
            m.locations,
            d.status,
            d.log,
            d.id as download_id,
            d.bytes_downloaded,
            d.total_bytes
        FROM models m
        LEFT JOIN LATERAL (
            SELECT *
            FROM downloads
            WHERE model_id = m.id
            ORDER BY created_at DESC
            LIMIT 1
        ) d ON true
        ORDER BY m.created_at DESC
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
