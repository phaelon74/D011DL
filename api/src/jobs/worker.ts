import pool from '../db/pool';
import { downloadFile } from '../hf/download';
import { listHfTree } from '../hf/listTree';
import path from 'path';

const STORAGE_ROOT = process.env.STORAGE_ROOT || '/media/models/models';

interface SelectionItem {
    path: string;
    type: 'file' | 'dir';
}

export async function processDownloadJob(jobId: string) {
    console.log(`Processing download job ${jobId}`);

    // 1. Get job details from DB
    const jobRes = await pool.query('SELECT * FROM downloads WHERE id = $1', [jobId]);
    if (jobRes.rows.length === 0) {
        console.error(`Job ${jobId} not found.`);
        return;
    }
    const job = jobRes.rows[0];
    const { model_id, selection_json, user_id } = job;

    const modelRes = await pool.query('SELECT * FROM models WHERE id = $1', [model_id]);
    if (modelRes.rows.length === 0) {
        console.error(`Model ${model_id} for job ${jobId} not found.`);
        await pool.query('UPDATE downloads SET status = $1, log = $2 WHERE id = $3', ['failed', 'Model not found', jobId]);
        return;
    }
    const model = modelRes.rows[0];
    const { author, repo, revision } = model;

    try {
        // 2. Update job status to running
        await pool.query('UPDATE downloads SET status = $1, started_at = now() WHERE id = $2', ['running', jobId]);

        // 3. Expand selection (especially directories)
        const selection: SelectionItem[] = selection_json;
        const allFilesToDownload: string[] = [];
        const hfTree = await listHfTree(author, repo, revision);

        for (const item of selection) {
            if (item.type === 'file') {
                allFilesToDownload.push(item.path);
            } else { // dir
                const dirFiles = hfTree
                    .filter(f => f.path.startsWith(item.path) && f.type === 'file')
                    .map(f => f.path);
                allFilesToDownload.push(...dirFiles);
            }
        }
        
        const uniqueFiles = [...new Set(allFilesToDownload)];

        // 4. Upsert model_files entries for all target files
        let totalFiles = uniqueFiles.length;
        for (const filePath of uniqueFiles) {
            const fileInfo = hfTree.find(f => f.path === filePath);
            await pool.query(
                `INSERT INTO model_files (model_id, path, size_bytes, status) 
                 VALUES ($1, $2, $3, 'pending') 
                 ON CONFLICT (model_id, path) DO NOTHING`,
                [model_id, filePath, fileInfo?.size || 0]
            );
        }
        await pool.query('UPDATE models SET file_count = $1 WHERE id = $2', [totalFiles, model_id]);


        // 5. Download files sequentially
        let downloadedCount = 0;
        for (const filePath of uniqueFiles) {
             await pool.query(
                "UPDATE model_files SET status = 'downloading' WHERE model_id = $1 AND path = $2",
                [model_id, filePath]
            );
            
            try {
                await downloadFile(author, repo, revision, filePath, STORAGE_ROOT);
                await pool.query(
                    "UPDATE model_files SET status = 'done', downloaded_at = now() WHERE model_id = $1 AND path = $2",
                    [model_id, filePath]
                );
                downloadedCount++;

                // Update progress
                const progress = (downloadedCount / totalFiles) * 100;
                await pool.query('UPDATE downloads SET progress_pct = $1 WHERE id = $2', [progress.toFixed(2), jobId]);

            } catch (error) {
                 await pool.query(
                    "UPDATE model_files SET status = 'failed', error = $1 WHERE model_id = $2 AND path = $3",
                    [(error as Error).message, model_id, filePath]
                );
            }
        }

        // 6. Finalize job status
        const failedFilesRes = await pool.query("SELECT COUNT(*) FROM model_files WHERE model_id = $1 AND status = 'failed'", [model_id]);
        const hasFailures = parseInt(failedFilesRes.rows[0].count, 10) > 0;

        if (hasFailures) {
            await pool.query("UPDATE downloads SET status = 'failed', finished_at = now() WHERE id = $1", [jobId]);
        } else {
            await pool.query("UPDATE downloads SET status = 'succeeded', finished_at = now(), progress_pct = 100 WHERE id = $1", [jobId]);
            await pool.query("UPDATE models SET is_downloaded = true, updated_at = now() WHERE id = $1", [model_id]);
        }

    } catch (error) {
        console.error(`Job ${jobId} failed`, error);
        await pool.query("UPDATE downloads SET status = 'failed', finished_at = now(), log = $1 WHERE id = $2", [(error as Error).message, jobId]);
    }
}
