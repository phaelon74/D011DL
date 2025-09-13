import pool from '../db/pool';
import { copyDirectory, moveDirectory } from '../util/filesystem';

export async function processFsJob(jobId: string) {
    console.log(`Processing filesystem job ${jobId}`);

    const jobRes = await pool.query('SELECT * FROM fs_jobs WHERE id = $1', [jobId]);
    if (jobRes.rows.length === 0) {
        console.error(`Filesystem job ${jobId} not found.`);
        return;
    }
    const job = jobRes.rows[0];

    try {
        await pool.query("UPDATE fs_jobs SET status = 'running', started_at = now() WHERE id = $1", [jobId]);

        if (job.type === 'copy') {
            await copyDirectory(job.source_path, job.destination_path);
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

        await pool.query("UPDATE fs_jobs SET status = 'succeeded', finished_at = now() WHERE id = $1", [jobId]);
        console.log(`Filesystem job ${jobId} succeeded.`);
    } catch (error: any) {
        const errorMessage = error.message || 'An unknown error occurred.';
        console.error(`Filesystem job ${jobId} failed:`, errorMessage);
        await pool.query("UPDATE fs_jobs SET status = 'failed', finished_at = now(), log = $1 WHERE id = $2", [errorMessage, jobId]);
    }
}
