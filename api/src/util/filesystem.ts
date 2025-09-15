import { promises as fs } from 'fs';
import path from 'path';
import { exec, spawn } from 'child_process';

export async function checkExists(filePath: string): Promise<boolean> {
    try {
        await fs.stat(filePath);
        return true;
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

export async function listDirectoryContents(dirPath: string): Promise<{ path: string; size: number }[]> {
    if (!await checkExists(dirPath)) {
        return [];
    }
    // Note: The 'recursive' option requires Node.js v20.1.0 or later.
    const dirents = await fs.readdir(dirPath, { withFileTypes: true, recursive: true });
    const files = await Promise.all(dirents.map(async (dirent) => {
        const fullPath = path.join(dirent.path, dirent.name);
        if (dirent.isFile()) {
            const stats = await fs.stat(fullPath);
            return { path: path.relative(dirPath, fullPath), size: stats.size };
        }
        return null;
    }));
    return files.filter(file => file !== null) as { path: string; size: number }[];
}


export async function getDirectorySize(dirPath: string): Promise<number> {
    const files = await listDirectoryContents(dirPath);
    return files.reduce((acc, file) => acc + file.size, 0);
}

async function getDirectorySizeFast(dirPath: string): Promise<number> {
    return new Promise((resolve) => {
        const cmd = `du -sb "${dirPath}" | cut -f1`;
        exec(cmd, (err, stdout) => {
            if (err) {
                // Fallback to Node-based walk on failure
                getDirectorySize(dirPath).then(resolve).catch(() => resolve(0));
                return;
            }
            const n = parseInt(stdout.trim(), 10);
            resolve(Number.isFinite(n) ? n : 0);
        });
    });
}


export async function copyDirectory(source: string, destination: string, onProgress?: (bytesCopied: number) => void | Promise<void>): Promise<void> {
    console.log(`[COPY] Starting verbose shell copy from ${source} to ${destination}`);

    return new Promise((resolve, reject) => {
        // First, ensure the destination's parent directory exists.
        const mkdirCommand = `mkdir -p "${destination}"`;
        console.log(`[COPY] Executing command: ${mkdirCommand}`);

        exec(mkdirCommand, (mkdirError, mkdirStdout, mkdirStderr) => {
            if (mkdirError) {
                console.error(`[COPY] FAILED to create parent directory:`, mkdirError);
                console.error(`[COPY] MKDIR STDERR: ${mkdirStderr}`);
                return reject(mkdirError);
            }

            console.log(`[COPY] Successfully created parent directory.`);
            const cpArgs = ['-rv', `${source}/.`, `${destination}/`];
            console.log(`[COPY] Executing command: cp ${cpArgs.join(' ')}`);

            // Periodically report destination size if a progress callback is provided (cheaper via du -sb every 5s)
            let progressTimer: NodeJS.Timeout | null = null;
            if (onProgress) {
                progressTimer = setInterval(async () => {
                    try {
                        const bytesCopied = await getDirectorySizeFast(destination);
                        await onProgress(bytesCopied);
                    } catch {
                        // ignore
                    }
                }, 5000);
            }

            const child = spawn('cp', cpArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
            let stdoutBuf = '';
            let stderrBuf = '';
            child.stdout.on('data', (chunk) => { stdoutBuf += chunk.toString(); });
            child.stderr.on('data', (chunk) => { stderrBuf += chunk.toString(); });
            child.on('close', async (code) => {
                console.log(`[COPY] STDOUT: ${stdoutBuf}`);
                if (stderrBuf) console.error(`[COPY] STDERR: ${stderrBuf}`);
                if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
                if (onProgress) {
                    try {
                        const finalSize = await getDirectorySizeFast(destination);
                        await onProgress(finalSize);
                    } catch {}
                }
                if (code === 0) {
                    console.log(`[COPY] Shell command finished successfully.`);
                    resolve();
                } else {
                    const err = new Error(`cp exited with code ${code}`);
                    console.error(`[COPY] FAILED with error:`, err);
                    reject(err);
                }
            });
        });
    });
}


async function verifyCopy(source: string, destination: string): Promise<boolean> {
    try {
        console.log(`Verifying copy from ${source} to ${destination}`);
        const sourceFiles = await listDirectoryContents(source);
        const destFiles = await listDirectoryContents(destination);

        if (sourceFiles.length === 0 && destFiles.length === 0) {
            console.error(`Verification failed: Both source and destination are empty or do not exist.`);
            return false;
        }

        if (sourceFiles.length !== destFiles.length) {
            console.error(`Verification failed: File count mismatch. Source: ${sourceFiles.length}, Destination: ${destFiles.length}`);
            return false;
        }

        const sourceTotalSize = sourceFiles.reduce((acc, file) => acc + file.size, 0);
        const destTotalSize = destFiles.reduce((acc, file) => acc + file.size, 0);

        if (sourceTotalSize !== destTotalSize) {
            console.error(`Verification failed: Total size mismatch. Source: ${sourceTotalSize}, Destination: ${destTotalSize}`);
            return false;
        }
        
        console.log(`Verification successful. Source and destination are identical.`);
        return true;
    } catch (error) {
        console.error('Error during copy verification:', error);
        return false;
    }
}

export async function moveDirectory(source: string, destination: string, onProgress?: (bytesCopied: number) => void | Promise<void>): Promise<void> {
    // This is a robust implementation for moving across different filesystems (e.g., Docker volumes).
    // It copies the directory, verifies the copy, and only then deletes the source.
    await copyDirectory(source, destination, onProgress);

    const isVerified = await verifyCopy(source, destination);

    if (isVerified) {
        await deleteDirectory(source);
        console.log(`Move complete: Source ${source} deleted after successful verification.`);
    } else {
        // The copy failed, but we leave the source intact. 
        // We should also clean up the failed partial copy at the destination.
        console.error(`Move failed: Verification check failed. Source directory at ${source} has been preserved.`);
        await deleteDirectory(destination); // Clean up failed copy attempt
        throw new Error(`Copy verification failed. Source: ${source}, Destination: ${destination}. Check logs for details.`);
    }
}

export async function deleteDirectory(dirPath: string): Promise<void> {
    if (!await checkExists(dirPath)) {
        return;
    }
    // Use Node's native, robust rm function instead of exec('rm')
    await fs.rm(dirPath, { recursive: true, force: true });
}
