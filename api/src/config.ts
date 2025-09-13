import path from 'path';

// This file provides a single source of truth for storage paths.
// Using path.normalize ensures that inconsistencies like trailing slashes are removed.

export const STORAGE_ROOT = path.normalize(process.env.STORAGE_ROOT || '/media/models');
export const NET_STORAGE_ROOT = path.normalize(process.env.NET_STORAGE_ROOT || '/media/netmodels');
