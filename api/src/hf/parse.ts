import { z } from 'zod';

const HFUrlSchema = z.string().url().regex(/^https:\/\/huggingface\.co\/[^\/]+\/[^\/]+(\/tree\/[^\/]+)?(\/resolve\/[^\/]+\/.*)?$/);

const AuthorRepoSchema = z.object({
    author: z.string().regex(/^[A-Za-z0-9_.-]+$/),
    repo: z.string().regex(/^[A-Za-z0-9_.-]+$/),
    revision: z.string().regex(/^[A-Za-z0-9_.-]+$/).optional()
});

export function parseHfUrl(url: string): z.infer<typeof AuthorRepoSchema> {
    HFUrlSchema.parse(url);

    const parts = new URL(url).pathname.split('/').filter(p => p);
    
    if (parts.length < 2) {
        throw new Error('Invalid Hugging Face URL');
    }

    const author = parts[0];
    const repo = parts[1];
    let revision: string | undefined = undefined;

    const treeIndex = parts.indexOf('tree');
    if (treeIndex !== -1 && parts.length > treeIndex + 1) {
        revision = parts[treeIndex + 1];
    }
    
    const resolveIndex = parts.indexOf('resolve');
    if (resolveIndex !== -1 && parts.length > resolveIndex + 1) {
        revision = parts[resolveIndex + 1];
    }

    const result = { author, repo, revision };
    AuthorRepoSchema.parse(result);
    return result;
}
