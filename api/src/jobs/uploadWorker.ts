import pool from '../db/pool';
import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { STORAGE_ROOT } from '../config';

function runCommandWithOutput(cmd: string, args: string[], cwd?: string, onStdoutLine?: (line: string) => void, onStderrLine?: (line: string) => void, extraEnv?: Record<string, string>): Promise<number> {
    return new Promise((resolve, reject) => {
        const env = { ...process.env } as Record<string, string>;
        if (extraEnv) {
            for (const [k, v] of Object.entries(extraEnv)) {
                if (typeof v === 'string' && v.length > 0) env[k] = v;
            }
        }
        const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env });
        let stdoutBuf = '';
        let stderrBuf = '';
        child.stdout.on('data', (chunk) => {
            stdoutBuf += chunk.toString();
            let idx;
            while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
                const line = stdoutBuf.slice(0, idx);
                stdoutBuf = stdoutBuf.slice(idx + 1);
                onStdoutLine && onStdoutLine(line);
            }
        });
        child.stderr.on('data', (chunk) => {
            stderrBuf += chunk.toString();
            let idx;
            while ((idx = stderrBuf.indexOf('\n')) >= 0) {
                const line = stderrBuf.slice(0, idx);
                stderrBuf = stderrBuf.slice(idx + 1);
                onStderrLine && onStderrLine(line);
            }
        });
        child.on('close', (code) => {
            if (stdoutBuf && onStdoutLine) onStdoutLine(stdoutBuf);
            if (stderrBuf && onStderrLine) onStderrLine(stderrBuf);
            resolve(code ?? 0);
        });
        child.on('error', (err) => reject(err));
    });
}

export async function processHfUploadJob(jobId: string) {
    const jobRes = await pool.query('SELECT * FROM hf_uploads WHERE id = $1', [jobId]);
    if (jobRes.rows.length === 0) {
        console.error(`HF upload job ${jobId} not found`);
        return;
    }
    const job = jobRes.rows[0];

    const modelRes = await pool.query('SELECT * FROM models WHERE id = $1', [job.model_id]);
    if (modelRes.rows.length === 0) {
        await pool.query("UPDATE hf_uploads SET status = 'failed', log = $1 WHERE id = $2", ['Model not found', jobId]);
        return;
    }
    const model = modelRes.rows[0];

    const author: string = model.author;
    const repo: string = model.repo;
    const revision: string = job.revision || model.revision || 'main';
    const localRoot: string = model.root_path || path.join(STORAGE_ROOT, author, repo, revision);

    if (author !== 'TheHouseOfTheDude') {
        await pool.query("UPDATE hf_uploads SET status = 'failed', log = $1 WHERE id = $2", ['Uploads only allowed for TheHouseOfTheDude', jobId]);
        return;
    }

    try {
        await pool.query('UPDATE hf_uploads SET status = $1, started_at = now() WHERE id = $2', ['running', jobId]);

        // Throttle DB writes to avoid overwhelming the pool during long CLI output
        let logBuffer: string[] = [];
        let isFlushing = false;
        const LOG_FLUSH_INTERVAL_MS = 2000;
        const flushLogs = async () => {
            if (isFlushing) return;
            if (logBuffer.length === 0) return;
            isFlushing = true;
            const chunk = logBuffer.join('\n');
            logBuffer = [];
            try {
                await pool.query("UPDATE hf_uploads SET log = COALESCE(log, '') || $1 || E'\\n' WHERE id = $2", [chunk, jobId]);
            } catch (e) {
                // Swallow errors to keep upload running; next flush may succeed
            } finally {
                isFlushing = false;
            }
        };
        const logTimer = setInterval(() => { flushLogs(); }, LOG_FLUSH_INTERVAL_MS);

        const repoId = `${author}/${repo}`;
        // Ensure hf uses the same token/setup as download env; prefer env var if present
        const hfEnv: Record<string, string> = {};
        if (process.env.HF_TOKEN && !process.env.HF_HOME) {
            hfEnv['HF_TOKEN'] = process.env.HF_TOKEN as string;
        }
        const hfToken = process.env.HF_TOKEN || '';

        // Helper to update log progressively
        const appendLog = async (line: string) => {
            if (!line) return;
            logBuffer.push(line);
            // If buffer grows large, flush early
            if (logBuffer.length >= 100) {
                await flushLogs();
            }
        };

        // 1) Detect if branch exists and has only init files; if missing, create with init file; if exists, skip init
        let branchExists = false;
        let branchEmpty = false;
        let initOverride: boolean | null = null; // null = auto by branch existence
        try {
            const jobRow = await pool.query('SELECT init_required FROM hf_uploads WHERE id = $1', [jobId]);
            if (jobRow.rows.length > 0 && typeof jobRow.rows[0].init_required === 'boolean') {
                initOverride = jobRow.rows[0].init_required;
            }
        } catch {}
        try {
            const res = await fetch(`https://huggingface.co/api/models/${author}/${repo}/tree/${encodeURIComponent(revision)}`);
            if (res.ok) {
                branchExists = true;
                const list: any[] = await res.json();
                const files = Array.isArray(list) ? list.filter((f: any) => f && f.type === 'file') : [];
                const ignored = new Set([`.gitattributes`, `.init-${revision}`]);
                const nonInit = files.filter((f: any) => !ignored.has(f.path));
                branchEmpty = nonInit.length === 0;
            }
        } catch {}

        const shouldInit = initOverride !== null ? initOverride : (!branchExists);

        if (shouldInit) {
            // Create .init and upload to create repo/branch (or ensure repo exists)
            const initFileName = `.init-${revision}`;
            const initFilePath = path.join(localRoot, initFileName);
            await fs.mkdir(localRoot, { recursive: true });
            await fs.writeFile(initFilePath, 'init\n');
            await appendLog(`[HF] Creating repo ${repoId} and branch ${revision} via init upload`);
            // Match user's working example: destination path with leading slash
            const args = ['upload', repoId, initFilePath, `/.init-${revision}`, '--repo-type=model', '--revision', revision, '--commit-message', `Init ${revision} branch`].concat(hfToken ? ['--token', hfToken] : []);
            await appendLog(`[HF] Running: hf ${args.map(a => a === hfToken ? '***TOKEN***' : a).join(' ')}`);
            const initCode = await runCommandWithOutput('hf', args, undefined, async (line) => { await appendLog(line); }, async (line) => { await appendLog(line); }, hfEnv);
            if (initCode !== 0) {
                await appendLog(`[HF] Init upload exited with code ${initCode}`);
                throw new Error(`hf upload init failed with code ${initCode}`);
            }
        } else {
            if (branchEmpty) {
                await appendLog(`[HF] Branch ${revision} exists and is effectively empty; skipping init`);
            } else {
                // Disallowed by route guard, but keep defensive check
                await appendLog(`[HF] Branch ${revision} has existing files; upload is not permitted by policy.`);
                await pool.query("UPDATE hf_uploads SET status = 'failed', finished_at = now(), log = COALESCE(log,'') || $1 WHERE id = $2", ['Branch has existing files; aborting.', jobId]);
                return;
            }
        }

        // 3) Compute total size for progress baseline
        const recursiveList = async (dir: string): Promise<number> => {
            let total = 0;
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const ent of entries) {
                const full = path.join(dir, ent.name);
                if (ent.isDirectory()) {
                    total += await recursiveList(full);
                } else if (ent.isFile()) {
                    const stat = await fs.stat(full);
                    total += stat.size;
                }
            }
            return total;
        };
        let totalBytes = 0;
        try {
            totalBytes = await recursiveList(localRoot);
        } catch {
            totalBytes = 0;
        }
        try {
            await pool.query('UPDATE hf_uploads SET total_bytes = $1 WHERE id = $2', [totalBytes, jobId]);
        } catch {}

        // 4) Upload large folder and parse progress lines
        await appendLog(`[HF] Starting upload-large-folder from ${localRoot}`);
        const args = ['upload-large-folder', repoId, '--repo-type=model', localRoot, '--revision', revision].concat(hfToken ? ['--token', hfToken] : []);
        await appendLog(`[HF] Running: hf ${args.map(a => a === hfToken ? '***TOKEN***' : a).join(' ')}`);
        let uploadedSoFar = 0;
        const progressRegex = /(\d+)%/; // hf prints percents; may be per-file; do not trust for totals
        const summaryPreRegex = /pre-uploaded:\s*\d+\/\d+\s*\((\d+(?:\.\d+)?)\s*([KMG])B?\/(\d+(?:\.\d+)?)\s*([KMG])B?\)/i;
        const summaryCommitRegex = /committed:\s*\d+\/\d+\s*\((\d+(?:\.\d+)?)\s*([KMG])B?\/(\d+(?:\.\d+)?)\s*([KMG])B?\)/i;
        const fracRegex = /(\d+(?:\.\d+)?)\s*([KMG])B?\s*\/\s*(\d+(?:\.\d+)?)\s*([KMG])B?/i; // e.g., 1.64GB / 4.56GB
        let lastProgressUpdate = 0;
        const PROGRESS_INTERVAL_MS = 2000;
        const jobTotalBytes = totalBytes > 0 ? totalBytes : undefined;
        const updateProgress = async (fields: { pct?: number; bytes?: number }) => {
            const now = Date.now();
            if (now - lastProgressUpdate < PROGRESS_INTERVAL_MS) return;
            lastProgressUpdate = now;
            try {
                if (fields.bytes !== undefined) {
                    const clamped = jobTotalBytes ? Math.min(fields.bytes, jobTotalBytes) : fields.bytes;
                    await pool.query('UPDATE hf_uploads SET bytes_uploaded = $1 WHERE id = $2', [clamped, jobId]);
                    if (jobTotalBytes) {
                        const pct = Math.min(100, Math.max(0, Math.floor((clamped / jobTotalBytes) * 100)));
                        await pool.query('UPDATE hf_uploads SET progress_pct = $1 WHERE id = $2', [pct, jobId]);
                    }
                } else if (fields.pct !== undefined && jobTotalBytes) {
                    const estBytes = Math.floor((fields.pct / 100) * jobTotalBytes);
                    await pool.query('UPDATE hf_uploads SET bytes_uploaded = $1, progress_pct = $2 WHERE id = $3', [estBytes, fields.pct, jobId]);
                }
            } catch {}
        };
        const folderCode = await runCommandWithOutput('hf', args, undefined, async (line) => {
            // stdout
            await appendLog(line);
            // Prefer summary lines for overall progress
            let m;
            if ((m = line.match(summaryPreRegex)) || (m = line.match(summaryCommitRegex))) {
                const toBytes = (val: string, unit: string) => {
                    const n = parseFloat(val);
                    const u = unit.toUpperCase();
                    const mult = u === 'G' ? 1024*1024*1024 : u === 'M' ? 1024*1024 : u === 'K' ? 1024 : 1;
                    return Math.round(n * mult);
                };
                const cur = toBytes(m[1], m[2]);
                await updateProgress({ bytes: cur });
            } else {
                const pm = line.match(progressRegex);
                if (pm) {
                    const pct = parseInt(pm[1], 10);
                    if (!Number.isNaN(pct)) {
                        await updateProgress({ pct });
                    }
                }
            }
        }, async (line) => {
            // stderr: also log and try to parse byte counters like 'Uploaded X/Y'
            await appendLog(line);
            // Prefer summary lines for overall progress on stderr as well
            let m2;
            if ((m2 = line.match(summaryPreRegex)) || (m2 = line.match(summaryCommitRegex))) {
                const toBytes = (val: string, unit: string) => {
                    const n = parseFloat(val);
                    const u = unit.toUpperCase();
                    const mult = u === 'G' ? 1024*1024*1024 : u === 'M' ? 1024*1024 : u === 'K' ? 1024 : 1;
                    return Math.round(n * mult);
                };
                const cur = toBytes(m2[1], m2[2]);
                await updateProgress({ bytes: cur });
            }
        }, hfEnv);
        if (folderCode !== 0) {
            await appendLog(`[HF] upload-large-folder exited with code ${folderCode}`);
            throw new Error(`hf upload-large-folder failed with code ${folderCode}`);
        }

        // 5) Final validation: compare HF tree vs local (ignore HF-generated metadata files)
        try {
            await appendLog('[HF] Validating uploaded content');
            // Use huggingface API to list tree
            const res = await fetch(`https://huggingface.co/api/models/${author}/${repo}/tree/${encodeURIComponent(revision)}`);
            const hfList: any[] = res.ok ? await res.json() : [];
            const metaNames = new Set([`.gitattributes`, `README.md`]);
            const hfCoreFiles = hfList.filter((f: any) => f.type === 'file' && !metaNames.has(f.path));
            const hfTotal = hfCoreFiles.reduce((acc, f) => acc + (f.size || 0), 0);

            // compute local total again
            const localTotal = totalBytes || await recursiveList(localRoot);
            const diff = Math.abs(localTotal - hfTotal);
            // Allow a small tolerance (e.g., metadata padding), 64 KiB max
            const isMatch = hfTotal > 0 && diff <= 64 * 1024;
            if (!isMatch) {
                await pool.query("UPDATE hf_uploads SET status = 'failed', finished_at = now(), log = COALESCE(log,'') || $1 WHERE id = $2", [`Validation mismatch: local ${localTotal} vs HF ${hfTotal}`, jobId]);
                return;
            }
        } catch (e: any) {
            await appendLog(`[HF] Validation error: ${e?.message || e}`);
            await pool.query("UPDATE hf_uploads SET status = 'failed', finished_at = now() WHERE id = $1", [jobId]);
            return;
        }

        await flushLogs();
        await pool.query("UPDATE hf_uploads SET status = 'succeeded', finished_at = now(), progress_pct = 100 WHERE id = $1", [jobId]);
    } catch (error: any) {
        const message = error?.message || 'Unknown upload error';
        try { await pool.query("UPDATE hf_uploads SET status = 'failed', finished_at = now(), log = COALESCE(log,'') || $1 WHERE id = $2", [message, jobId]); } catch {}
        // Surface failure in container logs
        console.error(`[HF] Upload job ${jobId} failed: ${message}`);
    } finally {
        // Ensure any buffered logs are flushed
        try { await (async () => {})(); } catch {}
    }
}


