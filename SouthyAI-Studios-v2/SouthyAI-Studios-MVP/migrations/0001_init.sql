CREATE TABLE IF NOT EXISTS video_jobs (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'vertical',
  status TEXT NOT NULL DEFAULT 'queued',
  provider TEXT,
  result_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS voice_recordings (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  research_consent INTEGER NOT NULL DEFAULT 0,
  consent_version TEXT NOT NULL,
  consented_at TEXT,
  purpose TEXT NOT NULL DEFAULT 'personal_voice_service',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_video_jobs_created ON video_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_voice_recordings_created ON voice_recordings(created_at);
