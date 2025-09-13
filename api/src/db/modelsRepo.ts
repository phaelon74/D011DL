import pool from './pool';

export async function getModels() {
    const query = `
        SELECT
            m.*,
            j.job_id,
            j.job_type,
            j.job_status,
            j.job_log,
            j.bytes_downloaded,
            j.total_bytes
        FROM
            models m
        LEFT JOIN LATERAL (
            SELECT
                id as job_id,
                'download' as job_type,
                status as job_status,
                log as job_log,
                bytes_downloaded,
                total_bytes,
                created_at
            FROM downloads
            WHERE model_id = m.id
            UNION ALL
            SELECT
                id as job_id,
                type as job_type,
                status as job_status,
                log as job_log,
                NULL as bytes_downloaded,
                NULL as total_bytes,
                created_at
            FROM fs_jobs
            WHERE model_id = m.id
            ORDER BY created_at DESC
            LIMIT 1
        ) j ON true
        ORDER BY
            m.created_at DESC;
    `;
    const res = await pool.query(query);

    // Ensure locations is always an array
    res.rows.forEach(row => {
        if (!row.locations) {
            row.locations = [];
        }
    });
    
    return res.rows;
}
