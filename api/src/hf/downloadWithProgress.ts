import { promises as fsPromises } from 'fs';
import fs from 'fs';
import { promisify } from 'util';
import path from 'path';
import stream from 'stream';
import got from 'got';

const pipeline = promisify(stream.pipeline);

export async function downloadFileWithProgress(
    url: string,
    destinationPath: string,
    onProgress: (bytesTransferred: number) => void,
    expectedSize?: number
): Promise<void> {
    await fsPromises.mkdir(path.dirname(destinationPath), { recursive: true });

    // If full file already present and matches expected size, skip
    try {
        const stat = await fsPromises.stat(destinationPath);
        if (typeof expectedSize === 'number' && expectedSize > 0 && stat.size === expectedSize) {
            onProgress(expectedSize);
            return;
        }
    } catch {}

    const partialPath = destinationPath + '.partial';
    const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

    let attempts = 0;
    const maxAttempts = 8;

    while (true) {
        let startAt = 0;
        try {
            const pstat = await fsPromises.stat(partialPath);
            startAt = pstat.size;
        } catch {}

        if (typeof expectedSize === 'number' && expectedSize > 0 && startAt >= expectedSize) {
            await fsPromises.rename(partialPath, destinationPath).catch(async () => {
                // If already renamed, ignore
                try { const st = await fsPromises.stat(destinationPath); if (st.size === startAt) return; } catch {}
            });
            return;
        }

        const headers: Record<string, string> = { 'accept-encoding': 'identity' };
        if (startAt > 0) headers['range'] = `bytes=${startAt}-`;

        try {
            const downloadStream = got.stream(url, {
                headers,
                retry: { limit: 0 }, // we implement our own resume-aware retry
                timeout: { request: 30000, response: 300000 },
                throwHttpErrors: true,
            });
            const fileWriteStream = fs.createWriteStream(partialPath, { flags: startAt > 0 ? 'a' : 'w' });
            downloadStream.on('downloadProgress', (progress) => {
                const transferred = startAt + progress.transferred;
                onProgress(transferred);
            });
            await pipeline(downloadStream, fileWriteStream);

            // After a successful stream, re-check size
            const pst = await fsPromises.stat(partialPath).catch(() => null as any);
            if (pst && typeof expectedSize === 'number' && expectedSize > 0 && pst.size >= expectedSize) {
                await fsPromises.rename(partialPath, destinationPath);
                return;
            }
            // If we don't have expectedSize or still short, loop to fetch remainder
            attempts = 0; // reset attempts after forward progress
        } catch (err) {
            attempts += 1;
            if (attempts >= maxAttempts) throw err;
            // Exponential backoff up to 30s
            const backoff = Math.min(30000, 1000 * Math.pow(2, attempts - 1));
            await sleep(backoff);
            // Continue loop; we'll resume from current partial size
        }
    }
}
