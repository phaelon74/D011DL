import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execPromise = promisify(exec);

export async function downloadRepo(
    author: string,
    repo: string,
    revision: string,
    destinationRoot: string
): Promise<{ stdout: string; stderr: string }> {
    const repoId = `${author}/${repo}`;
    const destinationDir = path.join(destinationRoot, author, repo, revision);
    
    // Using the user-provided command structure
    const command = [
        'hf',
        'download',
        repoId,
        '--revision', revision,
        '--local-dir', `"${destinationDir}"`,
        '--local-dir-use-symlinks', 'False',
        '--resume-download'
    ].join(' ');

    try {
        console.log(`Executing download: ${command}`);
        const result = await execPromise(command, { env: process.env });
        return result;
    } catch (error) {
        console.error(`Error downloading repo ${repoId}:`, error);
        throw error;
    }
}
