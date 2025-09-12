import pool from '../db/pool';
import { downloadRepo } from '../hf/download';
import path from 'path';

const STORAGE_ROOT = process.env.STORAGE_ROOT || '/media/models/models';

export async function processDownloadJob(jobId: string) {
    console.log(`Processing download job ${jobId}`);

    const jobRes = await pool.query('SELECT * FROM downloads WHERE id = $1', [jobId]);
    if (jobRes.rows.length === 0) {
        console.error(`Job ${jobId} not found.`);
        return;
    }
    const job = jobRes.rows[0];
    const { model_id } = job;

    const modelRes = await pool.query('SELECT * FROM models WHERE id = $1', [model_id]);
    if (modelRes.rows.length === 0) {
        console.error(`Model ${model_id} for job ${jobId} not found.`);
        await pool.query('UPDATE downloads SET status = $1, log = $2 WHERE id = $3', ['failed', 'Model not found', jobId]);
        return;
    }
    const model = modelRes.rows[0];
    const { author, repo, revision } = model;

    try {
        await pool.query('UPDATE downloads SET status = $1, started_at = now() WHERE id = $2', ['running', jobId]);

        // Call the new whole-repo download function
        await downloadRepo(author, repo, revision, STORAGE_ROOT);

        // On success, finalize the job
        await pool.query("UPDATE downloads SET status = 'succeeded', finished_at = now(), progress_pct = 100 WHERE id = $1", [jobId]);
        await pool.query("UPDATE models SET is_downloaded = true, updated_at = now() WHERE id = $1", [model_id]);

    } catch (error) {
        console.error(`Job ${jobId} failed`, error);
        await pool.query("UPDATE downloads SET status = 'failed', finished_at = now(), log = $1 WHERE id = $2", [(error as Error).message, jobId]);
    }
}
