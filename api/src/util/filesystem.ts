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

export async function copyDirectory(source: string, destination: string): Promise<void> {
    await execPromise(`cp -r "${source}" "${destination}"`);
}

export async function moveDirectory(source: string, destination: string): Promise<void> {
    await execPromise(`mv "${source}" "${destination}"`);
}

export async function deleteDirectory(directoryPath: string): Promise<void> {
    await execPromise(`rm -rf "${directoryPath}"`);
}
