import pool from '../db/pool';
import { copyDirectory, moveDirectory, listDirectoryContents } from '../util/filesystem';

export async function processFsJob(jobId: string) {
    console.log(`Processing filesystem job ${jobId}`);

    const jobRes = await pool.query('SELECT * FROM fs_jobs WHERE id = $1', [jobId]);
    if (jobRes.rows.length === 0) {
        console.error(`Filesystem job ${jobId} not found.`);
        return;
    }
    const job = jobRes.rows[0];

    try {
        // Best-effort: compute total bytes from source to support progress when columns exist
        let totalBytes: number | null = null;
        if (job.type === 'copy' || job.type === 'move') {
            try {
                const files = await listDirectoryContents(job.source_path);
                totalBytes = files.reduce((acc, f) => acc + f.size, 0);
            } catch (e) {
                totalBytes = null;
            }
        }

        // Mark running; if progress columns exist, set total_bytes; otherwise fall back
        try {
            await pool.query(
                "UPDATE fs_jobs SET status = 'running', started_at = now(), total_bytes = COALESCE($2, total_bytes) WHERE id = $1",
                [jobId, totalBytes]
            );
        } catch (e) {
            await pool.query(
                "UPDATE fs_jobs SET status = 'running', started_at = now() WHERE id = $1",
                [jobId]
            );
        }

        if (job.type === 'copy') {
            const updateIntervalMs = 2000;
            let lastUpdate = 0;
            await copyDirectory(job.source_path, job.destination_path, async (bytesCopied: number) => {
                const now = Date.now();
                if (now - lastUpdate > updateIntervalMs) {
                    lastUpdate = now;
                    const pct = totalBytes && totalBytes > 0 ? Math.min(100, Math.floor((bytesCopied / totalBytes) * 100)) : 0;
                    try {
                        await pool.query(
                            "UPDATE fs_jobs SET bytes_downloaded = $1, progress_pct = $2 WHERE id = $3",
                            [bytesCopied, pct, jobId]
                        );
                    } catch (e) {
                        // Progress columns may not exist; ignore
                    }
                }
            });
            await pool.query(
                "UPDATE models SET locations = array_append(locations, $1) WHERE id = $2 AND NOT ($1 = ANY(locations))",
                [job.destination_path, job.model_id]
            );
        } else if (job.type === 'move') {
            const updateIntervalMs = 2000;
            let lastUpdate = 0;
            await moveDirectory(job.source_path, job.destination_path, async (bytesCopied: number) => {
                const now = Date.now();
                if (now - lastUpdate > updateIntervalMs) {
                    lastUpdate = now;
                    const pct = totalBytes && totalBytes > 0 ? Math.min(100, Math.floor((bytesCopied / totalBytes) * 100)) : 0;
                    try {
                        await pool.query(
                            "UPDATE fs_jobs SET bytes_downloaded = $1, progress_pct = $2 WHERE id = $3",
                            [bytesCopied, pct, jobId]
                        );
                    } catch (e) {}
                }
            });
            await pool.query(
                "UPDATE models SET locations = array_replace(locations, $1, $2) WHERE id = $3",
                [job.source_path, job.destination_path, job.model_id]
            );
        }

        try {
            await pool.query(
                "UPDATE fs_jobs SET status = 'succeeded', finished_at = now(), bytes_downloaded = GREATEST(bytes_downloaded, total_bytes), progress_pct = 100 WHERE id = $1",
                [jobId]
            );
        } catch (e) {
            await pool.query("UPDATE fs_jobs SET status = 'succeeded', finished_at = now() WHERE id = $1", [jobId]);
        }
        console.log(`Filesystem job ${jobId} succeeded.`);
    } catch (error: any) {
        const errorMessage = error.message || 'An unknown error occurred.';
        console.error(`Filesystem job ${jobId} failed:`, errorMessage);
        await pool.query("UPDATE fs_jobs SET status = 'failed', finished_at = now(), log = $1 WHERE id = $2", [errorMessage, jobId]);
    }
}
