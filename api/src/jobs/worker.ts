import pool from '../db/pool';
import { downloadFileWithProgress } from '../hf/downloadWithProgress';
import got from 'got';
import path from 'path';

const STORAGE_ROOT = process.env.STORAGE_ROOT || '/media/models/models';

interface HfFile {
    path: string;
    size: number;
    type: 'file' | 'directory';
}

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

        const treeUrl = `https://huggingface.co/api/models/${author}/${repo}/tree/${revision}`;
        const fileList: HfFile[] = await got(treeUrl, { responseType: 'json' }).json();
        const filesToDownload = fileList.filter(f => f.type === 'file');
        const totalSize = filesToDownload.reduce((acc, file) => acc + file.size, 0);

        await pool.query('UPDATE downloads SET total_bytes = $1 WHERE id = $2', [totalSize, jobId]);

        let cumulativeBytesDownloaded = 0;
        let lastUpdateTime = 0;
        const UPDATE_INTERVAL = 2000; // 2 seconds

        const progressCallback = (bytesForCurrentFile: number) => {
            const now = Date.now();
            if (now - lastUpdateTime > UPDATE_INTERVAL) {
                lastUpdateTime = now;
                const totalJobBytes = cumulativeBytesDownloaded + bytesForCurrentFile;
                pool.query(
                    'UPDATE downloads SET bytes_downloaded = $1 WHERE id = $2',
                    [totalJobBytes, jobId]
                );
            }
        };
        
        for (const file of filesToDownload) {
            const fileUrl = `https://huggingface.co/${author}/${repo}/resolve/${revision}/${file.path}`;
            const destinationPath = path.join(STORAGE_ROOT, author, repo, revision, file.path);
            await downloadFileWithProgress(fileUrl, destinationPath, progressCallback);
            
            cumulativeBytesDownloaded += file.size;
            await pool.query(
                'UPDATE downloads SET bytes_downloaded = $1 WHERE id = $2',
                [cumulativeBytesDownloaded, jobId]
            );
        }

        await pool.query("UPDATE downloads SET status = 'succeeded', finished_at = now(), progress_pct = 100 WHERE id = $1", [jobId]);
        await pool.query("UPDATE models SET is_downloaded = true, updated_at = now(), locations = array_append(locations, $1) WHERE id = $2", [model.root_path, model_id]);

    } catch (error: any) {
        console.error(`Job ${jobId} failed`, error);
        const errorMessage = error.stderr || error.message || 'An unknown error occurred.';
        await pool.query("UPDATE downloads SET status = 'failed', finished_at = now(), log = $1 WHERE id = $2", [errorMessage, jobId]);
    }
}
