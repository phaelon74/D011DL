# D011DL

A two-container app suite that lets authenticated users browse Hugging Face repos, select whole repos or individual files/branches to download, and store them on a NAS mounted at `/media/models`. The system records model/file metadata in PostgreSQL and exposes the same capabilities via a lightweight Android client that talks to the API.

## Database

Bootstrap SQL is under `db/bootstrap.sql`.

### Migration for copy progress (fs_jobs)

If your database was created before copy-progress support, run the following to add the needed columns:

```sql
ALTER TABLE fs_jobs ADD COLUMN IF NOT EXISTS progress_pct INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fs_jobs ADD COLUMN IF NOT EXISTS bytes_downloaded BIGINT NOT NULL DEFAULT 0;
ALTER TABLE fs_jobs ADD COLUMN IF NOT EXISTS total_bytes BIGINT NOT NULL DEFAULT 0;
```

These fields enable progress reporting for copy/move jobs in the dashboard.
