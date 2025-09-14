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
        // Ensure progress columns exist (idempotent)
        await pool.query("ALTER TABLE fs_jobs ADD COLUMN IF NOT EXISTS bytes_downloaded BIGINT NOT NULL DEFAULT 0");
        await pool.query("ALTER TABLE fs_jobs ADD COLUMN IF NOT EXISTS total_bytes BIGINT NOT NULL DEFAULT 0");
        await pool.query("ALTER TABLE fs_jobs ADD COLUMN IF NOT EXISTS progress_pct INTEGER NOT NULL DEFAULT 0");

        // If it's a copy or move, we can compute total bytes from the source
        let totalBytes: number | null = null;
        if (job.type === 'copy' || job.type === 'move') {
            const files = await listDirectoryContents(job.source_path);
            totalBytes = files.reduce((acc, f) => acc + f.size, 0);
        }

        await pool.query(
            "UPDATE fs_jobs SET status = 'running', started_at = now(), total_bytes = COALESCE($2, total_bytes) WHERE id = $1",
            [jobId, totalBytes]
        );

        if (job.type === 'copy') {
            // Wrap copy to periodically update bytes_downloaded based on destination size
            const updateIntervalMs = 2000;
            let lastUpdate = 0;
            await copyDirectory(job.source_path, job.destination_path, async (bytesCopied: number) => {
                const now = Date.now();
                if (now - lastUpdate > updateIntervalMs) {
                    lastUpdate = now;
                    const pct = totalBytes && totalBytes > 0 ? Math.min(100, Math.floor((bytesCopied / totalBytes) * 100)) : 0;
                    await pool.query(
                        "UPDATE fs_jobs SET bytes_downloaded = $1, progress_pct = $2 WHERE id = $3",
                        [bytesCopied, pct, jobId]
                    );
                }
            });
            await pool.query(
                "UPDATE models SET locations = array_append(locations, $1) WHERE id = $2 AND NOT ($1 = ANY(locations))",
                [job.destination_path, job.model_id]
            );
        } else if (job.type === 'move') {
            await moveDirectory(job.source_path, job.destination_path);
            await pool.query(
                "UPDATE models SET locations = array_replace(locations, $1, $2) WHERE id = $3",
                [job.source_path, job.destination_path, job.model_id]
            );
        }

        await pool.query(
            "UPDATE fs_jobs SET status = 'succeeded', finished_at = now(), bytes_downloaded = GREATEST(bytes_downloaded, total_bytes), progress_pct = 100 WHERE id = $1",
            [jobId]
        );
        console.log(`Filesystem job ${jobId} succeeded.`);
    } catch (error: any) {
        const errorMessage = error.message || 'An unknown error occurred.';
        console.error(`Filesystem job ${jobId} failed:`, errorMessage);
        await pool.query("UPDATE fs_jobs SET status = 'failed', finished_at = now(), log = $1 WHERE id = $2", [errorMessage, jobId]);
    }
}
