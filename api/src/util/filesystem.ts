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
    await fs.mkdir(path.dirname(destination), { recursive: true });
    console.log(`Attempting to copy from "${source}" to "${destination}"`);
    try {
        await fs.cp(source, destination, { recursive: true });
        console.log(`Successfully copied from "${source}" to "${destination}"`);
    } catch (error) {
        console.error(`ERROR during copy from "${source}" to "${destination}":`, error);
        // Re-throw the error to ensure the job worker catches it and marks the job as failed.
        throw error;
    }
}

export async function moveDirectory(source: string, destination: string): Promise<void> {
    // This is a robust implementation for moving across different filesystems (e.g., Docker volumes).
    // It copies the directory first, and only then deletes the source.
    await copyDirectory(source, destination);
    await deleteDirectory(source);
}

export async function deleteDirectory(dirPath: string): Promise<void> {
    if (!await checkExists(dirPath)) {
        return;
    }
    // Use Node's native, robust rm function instead of exec('rm')
    await fs.rm(dirPath, { recursive: true, force: true });
}
