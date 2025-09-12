-- bootstrap.sql
-- Adjust placeholders before running:
-- :DB_NAME, :DB_USER, :DB_PASS

CREATE DATABASE ":D011DL";
\c :D011DL;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = ':D011DLUSER') THEN
      CREATE ROLE ":D011DLUSER" LOGIN PASSWORD ':Skeetles@AreFore@Beeatles@2025';
   END IF;
END$$;

GRANT CONNECT ON DATABASE ":D011DL" TO ":D011DLUSER";
GRANT USAGE ON SCHEMA public TO ":D011DLUSER";

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

-- Add a default user
INSERT INTO users (username, password_hash)
VALUES ('dload', crypt('Broccoli@2025', gen_salt('bf', 12)))
ON CONFLICT (username) DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ":D011DLUSER";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ":D011DLUSER";
