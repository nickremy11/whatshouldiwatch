-- Roles: 'user' (default), 'admin' (can see the admin page), 'blocked' (can't sign in).
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'blocked'));
ALTER TABLE users ADD COLUMN last_seen_at TEXT;

-- One row per AI Picks request, for the admin page. AI Gateway logs carry the same
-- user via request metadata.
CREATE TABLE ai_requests (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	prompt TEXT NOT NULL,
	media_type TEXT NOT NULL,
	model TEXT NOT NULL,
	picks INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ai_requests_user ON ai_requests(user_id, created_at);
CREATE INDEX ai_requests_created ON ai_requests(created_at);
