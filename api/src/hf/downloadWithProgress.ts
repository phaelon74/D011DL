import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import stream from 'stream';
import got from 'got';
import pool from '../db/pool';

const pipeline = promisify(stream.pipeline);

export async function downloadFileWithProgress(
    url: string,
    destinationPath: string,
    downloadId: string,
    totalSize: number
): Promise<void> {
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    
    const downloadStream = got.stream(url);
    const fileWriteStream = fs.createWriteStream(destinationPath + '.partial');

    downloadStream.on('downloadProgress', (progress) => {
        pool.query(
            'UPDATE downloads SET bytes_downloaded = $1 WHERE id = $2',
            [progress.transferred, downloadId]
        );
    });

    await pipeline(downloadStream, fileWriteStream);
    await fs.rename(destinationPath + '.partial', destinationPath);
}
