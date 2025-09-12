import got from 'got';

interface HfFile {
    type: 'file' | 'dir';
    path: string;
    size: number;
}

export async function listHfTree(author: string, repo: string, revision: string = 'main', recursive: boolean = true): Promise<HfFile[]> {
    const url = `https://huggingface.co/api/models/${author}/${repo}/tree/${revision}${recursive ? '?recursive=true' : ''}`;
    
    try {
        const files: HfFile[] = await got(url).json();
        return files;
    } catch (error) {
        console.error(`Failed to list tree for ${author}/${repo} at revision ${revision}`, error);
        throw new Error('Could not fetch repository tree from Hugging Face.');
    }
}
