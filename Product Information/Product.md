# D011DL — Product & Build Spec
**Goal:** A two-container app suite that lets authenticated users browse Hugging Face repos, select whole repos or individual files/branches to download, and store them on a NAS mounted at `/media/models`. The system records model/file metadata in PostgreSQL and exposes the same capabilities via a lightweight Android client that talks to the API.

---

## 0) High-level requirements (from you, made explicit)

- NAS share is already mounted on the Linux host at `/media/models`.
- Persist **all models** under:  
  `/media/models/<Author>/<Repo>/<Revision if applicable>/<file path from HF>`
- Two Dockerized apps on the same Docker network:
  - **#1 API server** — port **32002**, multiple endpoints (HF list tree, download selections, DB lookups, status).
  - **#2 Web Portal** — Node.js app, runs under **PM2** inside its container, port **32001**. Talks to API over the **internal** Docker network name (not the host IP/port).
- **#3 Android app** — thin client that calls the API (login, paste HF link, browse files/branches, start downloads, watch progress).
- **#4 PostgreSQL** — external service (not containerized here). Provide **one script** that creates DB, user, tables, and fields.  
  - Tables at minimum: `users` (bcrypt password hashes) and `models`/`model_files` download metadata.
- Containers get DB connection details from an **`.env`** file.
- Authentication for web & Android: username/password (bcrypt), session via JWT.

---

## 1) System architecture

**Host**  
- Linux box with Docker, docker-compose, and NAS mounted at `/media/models`.

**Docker network**  
- Single user-defined network `D011DLnet`.

**Containers**  
- `api` (#1): Node 20 + Fastify (or Express) + `got` for HTTP + `pg` for Postgres + optional `multer`(future). Handles all business logic, Hugging Face queries and download jobs. Exposes 32002.
- `web` (#2): Node 20 + Express + EJS (or small React build served statically). Runs via PM2 inside container. Exposes 32001. Calls `http://api:32002/...` on the **internal** network.
- (Android app #3 is not containerized; it targets the same API base URL as `web`, but via the **host’s published API port** or an ingress/LB you configure.)

**Storage**  
- Bind-mount host `/media/models` → container `/media/models` (read/write in `api`, read-only in `web`).  
- Final layout when downloading:  
  `/media/models/<Author>/<Repo>/<Revision if applicable>/<file path from HF>`

**Security**  
- Bcrypt for password hashing (`10–12` rounds).  
- JWT (HS256) for sessions (short expiry, refresh route optional).  
- API token for private Hugging Face repos (optional) via `HF_TOKEN` env.  
- Validate HF URLs and sanitize pathing before any filesystem write.

---

## 2) Data model (PostgreSQL)

### 2.1 Tables

#### `users`
- `id` UUID PK (default `gen_random_uuid()` if available)
- `username` TEXT UNIQUE NOT NULL
- `password_hash` TEXT NOT NULL  — bcrypt
- `created_at` TIMESTAMPTZ DEFAULT now()
- `last_login_at` TIMESTAMPTZ NULL
- `is_admin` BOOLEAN DEFAULT FALSE

#### `models`
Records a repo+revision and its aggregate state.

- `id` UUID PK
- `author` TEXT NOT NULL
- `repo` TEXT NOT NULL
- `revision` TEXT NOT NULL DEFAULT 'main'   — branch/tag/commit
- `root_path` TEXT NOT NULL                 — absolute FS path
- `is_downloaded` BOOLEAN NOT NULL DEFAULT FALSE
- `file_count` INTEGER NOT NULL DEFAULT 0
- `total_size_bytes` BIGINT NOT NULL DEFAULT 0
- `created_at` TIMESTAMPTZ DEFAULT now()
- `updated_at` TIMESTAMPTZ DEFAULT now()
- UNIQUE (`author`, `repo`, `revision`)

#### `model_files`
One row per file tracked under a repo+revision.

- `id` UUID PK
- `model_id` UUID NOT NULL REFERENCES `models`(id) ON DELETE CASCADE
- `path` TEXT NOT NULL             — path relative to repo root
- `size_bytes` BIGINT
- `sha256` TEXT NULL               — if computed/available
- `status` TEXT NOT NULL DEFAULT 'pending'  — `pending|downloading|done|failed`
- `error` TEXT NULL
- `downloaded_at` TIMESTAMPTZ NULL
- UNIQUE (`model_id`, `path`)

#### `downloads`
Jobs initiated by a user (whole repo or subset).

- `id` UUID PK
- `model_id` UUID NOT NULL REFERENCES `models`(id) ON DELETE CASCADE
- `user_id` UUID NULL REFERENCES `users`(id)
- `selection_json` JSONB NOT NULL  — list of files/dirs requested
- `status` TEXT NOT NULL DEFAULT 'queued'  — `queued|running|succeeded|failed|canceled`
- `progress_pct` NUMERIC(5,2) DEFAULT 0
- `started_at` TIMESTAMPTZ NULL
- `finished_at` TIMESTAMPTZ NULL
- `log` TEXT NULL

> _Note:_ This schema supports partial downloads per revision, multiple jobs per model, and idempotent re-runs.

### 2.2 SQL bootstrap script (Number 4 deliverable)

Create **DB**, **app user**, and tables. Cursor should emit a runnable script like:

```sql
-- bootstrap.sql
-- Adjust placeholders before running:
-- :DB_NAME, :DB_USER, :DB_PASS

CREATE DATABASE ":D011DL";
\c :DB_NAME;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = ':D011DLUSER') THEN
      CREATE ROLE ":D011DLUSER" LOGIN PASSWORD ':Skeetles@AreFore@Beeatles@2025';
   END IF;
END$$;

GRANT CONNECT ON DATABASE ":D011DL" TO ":D011DLUSER";
GRANT USAGE ON SCHEMA public TO ":D011DLUSERR";

-- Tables
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  is_admin BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author TEXT NOT NULL,
  repo TEXT NOT NULL,
  revision TEXT NOT NULL DEFAULT 'main',
  root_path TEXT NOT NULL,
  is_downloaded BOOLEAN NOT NULL DEFAULT FALSE,
  file_count INTEGER NOT NULL DEFAULT 0,
  total_size_bytes BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (author, repo, revision)
);

CREATE TABLE IF NOT EXISTS model_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  size_bytes BIGINT,
  sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  downloaded_at TIMESTAMPTZ,
  UNIQUE (model_id, path)
);

CREATE TABLE IF NOT EXISTS downloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  selection_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress_pct NUMERIC(5,2) DEFAULT 0,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  log TEXT
);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ":D011DLUSER";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ":D011DLUSER";
```

---

## 3) API server (#1) — detailed spec

**Tech:** Node 20 + Fastify (or Express), `pg`, `jsonwebtoken`, `bcrypt`, `got` (HTTP), `p-limit` (concurrency), `zod` (payload validation), `mime`, optional `ws` for realtime.  
**Port:** 32002.  
**FS root env:** `STORAGE_ROOT=/media/models/models`.

### 3.1 Hugging Face integration approach

- Parse URLs like:
  - `https://huggingface.co/<Author>/<Repo>`
  - `https://huggingface.co/<Author>/<Repo>/tree/<Revision>`
  - `https://huggingface.co/<Author>/<Repo>/resolve/<Revision>/<path>`
- Use Hugging Face public API endpoints to list trees and refs:
  - `GET https://huggingface.co/api/models/<Author>/<Repo>`
  - `GET https://huggingface.co/api/models/<Author>/<Repo>/tree/<Revision>?recursive=1` (paginate if `cursor` present)
- Download files via:
  - `GET https://huggingface.co/<Author>/<Repo>/resolve/<Revision>/<path>`  
    Stream to disk with retry/resume (Range) when possible. Validate `content-length` and/or compute `sha256` after.

> For private repos, include `Authorization: Bearer ${HF_TOKEN}` if provided in env.

Use the Huggingface_cli (https://huggingface.co/docs/huggingface_hub/main/en/guides/cli) to download files

### 3.2 Endpoints

All non-auth routes accept **JWT** in `Authorization: Bearer <token>`.

**Auth**
- `POST /auth/register` → `{username, password}` → 201  
  - Hash with bcrypt, store. Optionally gate behind `ALLOW_REG=true`.
- `POST /auth/login` → `{username, password}` → `{token, user}`
- `GET /auth/me` → returns current user from token.

**Models / Hugging Face**
- `POST /hf/parse-url` → `{ url }` → `{author, repo, revision?}`
- `GET  /hf/refs` → `?author=&repo=` → `{branches: [...], tags: [...]}` (derive from model API)
- `GET  /hf/tree` → `?author=&repo=&revision=&cursor=` → `{files:[{path,size_bytes,type}], next_cursor}`  
  - `type ∈ file|dir`.
- `GET  /db/models` → list tracked models (filter by `author`, `repo`, `revision`, `downloaded`)
- `GET  /db/models/:id/files` → files & status

**Download jobs**
- `POST /downloads`  
  Payload:
  ```json
  {
    "author": "TheDrummer",
    "repo": "Behemoth-R1-123B-v2",
    "revision": "main",
    "selection": [{ "path": "README.md", "type": "file" }, { "path": "snapshots/", "type": "dir" }]
  }
  ```
  Behavior:
  1) Upsert `models` row; create `model_files` rows for target set (expand directories from current tree).  
  2) Create a `downloads` row with `queued`.  
  3) Start a job (in-process queue) that:
     - Ensures directory: `${STORAGE_ROOT}/${author}/${repo}/${revision}`
     - Streams files sequentially or with bounded concurrency (e.g., 3 at a time).
     - Updates `model_files.status` as it goes.  
     - On complete: set `models.is_downloaded=true` if all requested files are `done`; update counts/sizes.
- `GET /downloads/:id` → job status `{status, progress_pct, started_at, finished_at, log}`  
- **Realtime:** optional `GET /downloads/:id/stream` (SSE) or `ws://.../downloads/:id` for live progress.

**Admin / housekeeping**
- `POST /db/rescan` → recompute file presence & sizes from disk into DB for a given model.
- `POST /db/mark-missing` → set files to `failed` if not on disk.

### 3.3 Download integrity rules

- If target file exists with same size (and optional sha match), **skip** (idempotent).
- Temp file write pattern: `.partial` then `fs.rename` on success.
- Retries: 3 with exponential backoff on 5xx/ETIMEDOUT.
- On final failure: record error text.

---

## 4) Web Portal (#2) — detailed spec

**Tech:** Node 20 + Express + EJS (or React/Vite build served statically).  
**Port:** 32001.  
**Runtime:** `pm2-runtime` with `ecosystem.config.js`.

**Pages (minimal)**

1. **Login / Register**
   - POST to API `/auth/login` / `/auth/register`
   - Store JWT in HTTP-only cookie.

2. **Dashboard**
   - “Paste HF URL” input → POST `/hf/parse-url` → show parsed author/repo/revision.  
   - Button: “Check DB” → GET `/db/models?author=...&repo=...`  
   - Button: “List files/branches” → GET `/hf/refs` and `/hf/tree`.
   - File tree selector with `Select All` / per-branch dropdown.

3. **Download request**
   - POST `/downloads` with `selection`.
   - Show job card with progress (SSE/WebSocket).  
   - On finish, show “Open on NAS” path text.

4. **Models catalog**
   - Table of tracked repos, filters, status badges.

> All calls from web→API use the **service name** `http://api:32002` on Docker network.

**PM2 config (in repo)**

```js
// ecosystem.config.js
module.exports = {
  apps: [{
    name: "web-portal",
    script: "server.js",
    instances: "1",
    exec_mode: "fork",
    env: {
      PORT: 32001,
      API_BASE_URL: "http://api:32002",
      SESSION_SECRET: "change_me"
    }
  }]
};
```

---

## 5) Android app (#3) — capability scope

**Goal:** Mirror core portal interactions; thin client that only talks to the API.

**Tech (suggested):** Kotlin + Retrofit + Coroutines + Jetpack Compose.

**Screens**
- **Login** → stores JWT in EncryptedSharedPreferences; Authorization header interceptor.
- **Paste HF URL** → shows parsed author/repo/revision.
- **Browse files/branches** → paginated tree view, checkboxes.
- **Start download** → progress screen polling `/downloads/:id` or websocket; background worker for notifications.
- **My models** → list from `/db/models`.

**Config**
- Base URL pointing to your **API’s externally reachable address** (e.g., reverse proxy) rather than `api:32002`.

---

## 6) Environment & deployment

### 6.1 `.env` (shared)

```
# API
PORT_API=32002
JWT_SECRET=replace_me
BCRYPT_ROUNDS=12
STORAGE_ROOT=/media/models/models
HF_TOKEN=

# DB
PGHOST=10.1.1.50
PGPORT=5432
PGDATABASE=d011dl
PGUSER=d011dl_app
PGPASSWORD=supersecret
PGSSLMODE=disable

# WEB
PORT_WEB=32001
API_BASE_INTERNAL=http://api:32002
```

> Containers load this `.env`. **Never** commit real secrets.

### 6.2 Dockerfiles

**API (Dockerfile.api)**

```dockerfile
FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git git-lfs && rm -rf /var/lib/apt/lists/*
RUN git lfs install
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 32002
CMD ["node", "dist/index.js"]
```

**WEB (Dockerfile.web)**

```dockerfile
FROM node:20-slim
WORKDIR /app
RUN npm i -g pm2
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 32001
CMD ["pm2-runtime", "ecosystem.config.js"]
```

### 6.3 docker-compose.yml

```yaml
version: "3.9"
services:
  api:
    build:
      context: ./api
      dockerfile: Dockerfile.api
    env_file: .env
    volumes:
      - /media/models:/media/models
    networks: [modelnet]
    ports:
      - "32002:32002"   # publish if you want external/API access (Android)

  web:
    build:
      context: ./web
    env_file: .env
    environment:
      - API_BASE_URL=http://api:32002
    depends_on: [api]
    volumes:
      - /media/models:/media/models:ro
    networks: [modelnet]
    ports:
      - "32001:32001"

networks:
  modelnet:
    name: modelnet
```

---

## 7) Job engine design (inside API)

- Simple in-process queue using `p-queue` (concurrency configurable via env, default 3).
- Each `downloads` job:
  - `status=running`, `started_at=now()`.
  - Iterates selection → expands directories via latest `/hf/tree` snapshot.
  - For each file: stream to `STORAGE_ROOT/.../.partial` → verify size → rename → mark `model_files.status=done`.
  - Update `downloads.progress_pct` as `done/total`.
  - On any fatal error: set `status=failed` and append `log`.
  - On success: `status=succeeded`, `finished_at=now()`. If all files `done`, set `models.is_downloaded=true`.

> A later enhancement can swap to BullMQ + Redis without changing API contracts.

---

## 8) Validation & parsing rules

- **HF URL parsing:** Extract author/repo and optional revision; reject if not matching `^[A-Za-z0-9_.-]+$`.
- **Path traversal:** Forbid `..` segments and absolute paths.
- **Disk space check:** Before download, ensure sufficient free space (optional first release).
- **Idempotency:** If a `models` row exists and all **selected** files are `done`, return `409 | AlreadyDownloaded` with option to force re-download.

---

## 9) Logging, metrics, and health

- **API**: request logs (method, route, ms), job logs (per file). `/healthz` returns DB and NAS checks.
- **WEB**: minimal access logs.
- **Files**: write per-job logs to `/media/models/logs/<jobId>.log` (also store tail in DB `downloads.log`).
- Optional Prometheus later (not required for MVP).

---

## 10) UX flows mapped to your swimlane

1) **Login**  
User → Web → API `/auth/login` → DB user lookup (bcrypt verify) → JWT issued.

2) **Paste HF URL & check**  
Web → API `/hf/parse-url` → show author/repo/revision → API `/db/models?author&repo` (is it downloaded?) → API `/hf/refs` + `/hf/tree` for choices.

3) **Select & start download**  
Web → API `/downloads` with selection → API starts job → streams progress → DB writes as files complete → on success, DB `models.is_downloaded=true` → Web shows “Download Success”.

---

## 11) Deliverables & repo layout (what Cursor should scaffold)

```
d011dl/
  api/
    src/
      index.ts
      auth/
        routes.ts
        service.ts
      hf/
        parse.ts
        listTree.ts
        download.ts
      jobs/
        queue.ts
        worker.ts
      db/
        pool.ts
        modelsRepo.ts
        filesRepo.ts
        downloadsRepo.ts
      util/
        validate.ts
        paths.ts
    package.json
    tsconfig.json
    Dockerfile.api
    .env.example
  web/
    server.js
    views/
      layout.ejs
      login.ejs
      dashboard.ejs
      tree.ejs
      jobs.ejs
    public/
      css/app.css
      js/app.js
    ecosystem.config.js
    package.json
    Dockerfile.web
    .env.example
  android/
    (Kotlin project skeleton with Retrofit service interfaces)
  db/
    bootstrap.sql
  docker-compose.yml
  README.md
```

---

## 12) Sample API contracts (for Cursor to implement)

```http
POST /auth/register
{ "username":"andy", "password":"..."}
→ 201 { "id":"...", "username":"andy" }

POST /auth/login
{ "username":"andy", "password":"..."}
→ 200 { "token":"JWT", "user": { "id":"...", "username":"andy" } }

POST /hf/parse-url
{ "url":"https://huggingface.co/TheDrummer/Behemoth-R1-123B-v2/tree/main" }
→ 200 { "author":"TheDrummer", "repo":"Behemoth-R1-123B-v2", "revision":"main" }

GET /hf/refs?author=TheDrummer&repo=Behemoth-R1-123B-v2
→ 200 { "branches":["main","W4A16-ASYM",...], "tags":["v1", ...] }

GET /hf/tree?author=TheDrummer&repo=Behemoth-R1-123B-v2&revision=main
→ 200 { "files":[ {"path":"README.md","size_bytes":1234,"type":"file"}, {"path":"snapshots","type":"dir"} ] }

POST /downloads
{
  "author":"TheDrummer","repo":"Behemoth-R1-123B-v2","revision":"W4A16-ASYM",
  "selection":[{"path":"README.md","type":"file"},{"path":"snapshots","type":"dir"}]
}
→ 202 { "download_id":"...", "status":"queued" }

GET /downloads/:id
→ 200 { "status":"running","progress_pct":37.5,"log":"..." }

GET /db/models?author=TheDrummer&repo=Behemoth-R1-123B-v2
→ 200 [{ "id":"...","revision":"W4A16-ASYM","is_downloaded":true, "file_count":42 }]
```

---

## 13) Acceptance criteria (Definition of Done)

- **Networking**
  - `docker-compose up -d` starts both containers on `modelnet`.
  - `web` can reach `api` via `http://api:32002` (internal).
- **Auth**
  - Can register/login; bcrypt hashes stored; JWT protects private endpoints.
- **HF browse**
  - Paste any public HF model URL → see branches and a file tree.
- **Download**
  - Select full repo or subset; job starts; files land at `/media/models/<Author>/<Repo>/<Revision>/...`
  - Progress visible; DB reflects file count/size; completed models show `is_downloaded=true`.
- **Re-run idempotency**
  - Re-starting the same selection skips existing OK files.
- **Android**
  - Can login, parse a URL, list files, trigger a download, and watch progress (polling is fine for v1).
- **Bootstrap**
  - `bootstrap.sql` successfully creates DB, user, tables; app connects using `.env`.

---

## 14) Non-goals (v1)

- Inference serving, model validation, checksum verification against HF manifests.
- Queue durability across container restarts (can be added later with Redis/BullMQ).
- Organization-wide SSO/OAuth.
- Per-file diffing / partial binary patching.

---

## 15) Future extensions

- Redis-backed queue + retries dashboard.
- SHA256 verification using HF file metadata where available.
- Private repos with `HF_TOKEN` and per-user tokens.
- Webhook to external systems when downloads finish.
- RBAC (admin vs user) and audit log.
- Nginx ingress with TLS and hostname.

---

## 16) Notes mapping to the “Core Infrastructure” diagram

- **(1) API Container** — fully implemented as above (Fastify app, all endpoints, job runner).
- **(2) Web Portal Container** — PM2-managed Node app, internal calls to `api:32002`.
- **(3) Android App** — Kotlin client using Retrofit for all API calls; mirrors portal flows.
- **(4) PostgreSQL** — delivered as a SQL bootstrap script; containers consume connection details from `.env`.

---

_This document is the single source of truth for Cursor to scaffold the repo and implement the MVP._
