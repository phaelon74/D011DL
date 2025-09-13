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
    onProgress: (bytesTransferred: number) => void
): Promise<void> {
    await fsPromises.mkdir(path.dirname(destinationPath), { recursive: true });
    
    const downloadStream = got.stream(url);
    const fileWriteStream = fs.createWriteStream(destinationPath + '.partial');

    downloadStream.on('downloadProgress', (progress) => {
        onProgress(progress.transferred);
    });

    await pipeline(downloadStream, fileWriteStream);
    await fsPromises.rename(destinationPath + '.partial', destinationPath);
}
