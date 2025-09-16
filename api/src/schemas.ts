import { z } from 'zod';

export const createDownloadBodySchema = z.object({
    author: z.string(),
    repo: z.string(),
    revision: z.string().default('main'),
    selection: z.array(z.object({
        path: z.string(),
        type: z.enum(['file', 'dir'])
    })).optional()
});

export const createUploadBodySchema = z.object({
    revision: z.string().optional(),
});