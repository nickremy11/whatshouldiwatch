-- Accounts and sessions -------------------------------------------------------

CREATE TABLE users (
	id TEXT PRIMARY KEY,
	google_sub TEXT NOT NULL UNIQUE,
	email TEXT NOT NULL,
	name TEXT,
	avatar_url TEXT,
	region TEXT NOT NULL DEFAULT 'US',
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- id is the SHA-256 of the session token; the raw token only lives in the cookie.
CREATE TABLE sessions (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	expires_at TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Streaming services the user subscribes to (TMDB watch provider ids).
CREATE TABLE user_services (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	provider_id INTEGER NOT NULL,
	PRIMARY KEY (user_id, provider_id)
);

-- Title cache -----------------------------------------------------------------

-- Lightweight snapshot of a title, enough to render cards in lists and recs.
CREATE TABLE titles (
	media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
	tmdb_id INTEGER NOT NULL,
	imdb_id TEXT,
	title TEXT NOT NULL,
	year INTEGER,
	poster_path TEXT,
	genre_ids TEXT NOT NULL DEFAULT '[]',
	updated_at TEXT NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (media_type, tmdb_id)
);

-- Multi-source ratings from MDBList, kept in each source's original format.
CREATE TABLE scores (
	media_type TEXT NOT NULL,
	tmdb_id INTEGER NOT NULL,
	ratings TEXT NOT NULL DEFAULT '[]',
	blended REAL,
	source_count INTEGER NOT NULL DEFAULT 0,
	fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (media_type, tmdb_id)
);
CREATE INDEX scores_fetched ON scores(fetched_at);

-- Personal tracking -------------------------------------------------------------

CREATE TABLE user_titles (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	media_type TEXT NOT NULL,
	tmdb_id INTEGER NOT NULL,
	in_watchlist INTEGER NOT NULL DEFAULT 0,
	watched_at TEXT,
	-- 0.5 to 5 stars in half-star steps.
	rating REAL CHECK (rating IS NULL OR (rating >= 0.5 AND rating <= 5)),
	added_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (user_id, media_type, tmdb_id)
);
CREATE INDEX user_titles_rating ON user_titles(user_id, rating);

CREATE TABLE user_episodes (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	tmdb_id INTEGER NOT NULL,
	season INTEGER NOT NULL,
	episode INTEGER NOT NULL,
	watched_at TEXT NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (user_id, tmdb_id, season, episode)
);
