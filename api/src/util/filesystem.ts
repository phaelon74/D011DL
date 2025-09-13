import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execPromise = promisify(exec);

export async function checkExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
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
    await fs.cp(source, destination, { recursive: true });
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
    await execPromise(`rm -rf "${dirPath}"`);
}
