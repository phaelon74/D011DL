-- bootstrap.sql
-- Adjust placeholders before running:
-- :DB_NAME, :DB_USER, :DB_PASS

CREATE DATABASE "D011DL";
\c D011DL;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'D011DLUSER') THEN
      CREATE ROLE "D011DLUSER" LOGIN PASSWORD 'Skeetles@AreFore@Beeatles@2025';
   END IF;
END$$;

GRANT CONNECT ON DATABASE "D011DL" TO "D011DLUSER";
GRANT USAGE ON SCHEMA public TO "D011DLUSER";

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
  locations TEXT[] DEFAULT ARRAY[]::TEXT[],
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

CREATE TABLE downloads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'queued', -- queued, running, succeeded, failed
    progress_pct INTEGER NOT NULL DEFAULT 0,
    bytes_downloaded BIGINT NOT NULL DEFAULT 0,
    total_bytes BIGINT NOT NULL DEFAULT 0,
    log TEXT,
    selection_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);

-- Hugging Face upload jobs
CREATE TABLE IF NOT EXISTS hf_uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'queued', -- queued, running, succeeded, failed
    progress_pct INTEGER NOT NULL DEFAULT 0,
    bytes_uploaded BIGINT NOT NULL DEFAULT 0,
    total_bytes BIGINT NOT NULL DEFAULT 0,
    log TEXT,
    revision TEXT NOT NULL DEFAULT 'main',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);

-- Ensure privileges for application role
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE hf_uploads TO "D011DLUSER";

-- Filesystem operation jobs (copy, move)
CREATE TABLE fs_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL, -- 'copy' or 'move'
    status VARCHAR(20) NOT NULL DEFAULT 'queued',
    source_path TEXT NOT NULL,
    destination_path TEXT NOT NULL,
    -- Progress fields for long-running file operations
    progress_pct INTEGER NOT NULL DEFAULT 0,
    bytes_downloaded BIGINT NOT NULL DEFAULT 0,
    total_bytes BIGINT NOT NULL DEFAULT 0,
    log TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);

-- Add a default user
INSERT INTO users (username, password_hash)
VALUES ('dload', crypt('Broccoli@2025', gen_salt('bf')));

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "D011DLUSER";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "D011DLUSER";
