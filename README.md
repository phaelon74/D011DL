# D011DL

A two-container app suite that lets authenticated users browse Hugging Face repos, select whole repos or individual files/branches to download, and store them on a NAS mounted at `/media/models`. The system records model/file metadata in PostgreSQL and exposes the same capabilities via a lightweight Android client that talks to the API.
