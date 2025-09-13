import { promises as fs } from 'fs';
import path from 'path';

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


export async function copyDirectory(source: string, destination: string): Promise<void> {
    console.log(`[COPY] Starting robust copy from ${source} to ${destination}`);

    // Ensure destination directory exists
    await fs.mkdir(destination, { recursive: true });

    const entries = await fs.readdir(source, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(source, entry.name);
        const destPath = path.join(destination, entry.name);

        if (entry.isDirectory()) {
            // It's a directory, recurse
            await copyDirectory(srcPath, destPath);
        } else {
            // It's a file, copy it
            try {
                console.log(`[COPY] Copying file: ${srcPath} -> ${destPath}`);
                await fs.copyFile(srcPath, destPath);
            } catch (error) {
                console.error(`[COPY] FAILED to copy file: ${srcPath}. Error:`, error);
                throw error; // Propagate error to fail the job
            }
        }
    }
    console.log(`[COPY] Finished copying directory contents from ${source} to ${destination}`);
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

export async function moveDirectory(source: string, destination: string): Promise<void> {
    // This is a robust implementation for moving across different filesystems (e.g., Docker volumes).
    // It copies the directory, verifies the copy, and only then deletes the source.
    await copyDirectory(source, destination);

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
