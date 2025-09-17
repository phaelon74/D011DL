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
    let startAt = 0;
    try {
        const pstat = await fsPromises.stat(partialPath);
        startAt = pstat.size;
    } catch {}

    const headers: Record<string, string> = { 'accept-encoding': 'identity' };
    if (startAt > 0) {
        headers['range'] = `bytes=${startAt}-`;
    }

    const downloadStream = got.stream(url, { headers, retry: { limit: 2 } });
    const fileWriteStream = fs.createWriteStream(partialPath, { flags: startAt > 0 ? 'a' : 'w' });

    downloadStream.on('downloadProgress', (progress) => {
        const transferred = startAt + progress.transferred;
        onProgress(transferred);
    });

    await pipeline(downloadStream, fileWriteStream);

    // Validate final size if provided
    if (typeof expectedSize === 'number' && expectedSize > 0) {
        try {
            const pst = await fsPromises.stat(partialPath);
            if (pst.size !== expectedSize) {
                // Leave partial for next retry; do not overwrite destination
                return;
            }
        } catch {}
    }
    await fsPromises.rename(partialPath, destinationPath);
}
