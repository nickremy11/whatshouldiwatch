import type { MediaType, Rating, Scores, TitleCard } from "../shared/types";

const MDBLIST = "https://api.mdblist.com";
const STALE_AFTER_DAYS = 7;
/** Free tier is 1,000/day; leave headroom for manual use. */
const DAILY_BUDGET = 900;
const BATCH_SIZE = 100;

interface LinkContext {
	mediaType: MediaType;
	tmdbId: number;
	imdbId: string | null;
}

const join = (base: string, path: unknown) => (typeof path === "string" && path ? `${base}${path.startsWith("/") ? "" : "/"}${path}` : null);

/**
 * How each MDBList source is labelled, shown in its native format, and linked.
 * MDBList returns `url` as a site-relative path (or an id), not a full URL.
 */
const SOURCES: Record<
	string,
	{ label: string; format: (v: number) => string; max: number; link: (url: unknown, ctx: LinkContext) => string | null }
> = {
	imdb: {
		label: "IMDb",
		format: (v) => `${v.toFixed(1)}/10`,
		max: 10,
		link: (_, c) => (c.imdbId ? `https://www.imdb.com/title/${c.imdbId}/` : null),
	},
	tmdb: {
		label: "TMDB",
		format: (v) => `${Math.round(v)}%`,
		max: 100,
		link: (_, c) => `https://www.themoviedb.org/${c.mediaType}/${c.tmdbId}`,
	},
	metacritic: {
		label: "Metacritic",
		format: (v) => `${Math.round(v)}`,
		max: 100,
		link: (u, c) => join(`https://www.metacritic.com/${c.mediaType === "tv" ? "tv" : "movie"}`, u),
	},
	metacriticuser: {
		label: "Metacritic Users",
		format: (v) => `${v.toFixed(1)}/10`,
		max: 10,
		link: (u, c) => join(`https://www.metacritic.com/${c.mediaType === "tv" ? "tv" : "movie"}`, u),
	},
	tomatoes: { label: "Rotten Tomatoes", format: (v) => `${Math.round(v)}%`, max: 100, link: (u) => join("https://www.rottentomatoes.com", u) },
	popcorn: { label: "RT Audience", format: (v) => `${Math.round(v)}%`, max: 100, link: (u) => join("https://www.rottentomatoes.com", u) },
	// MDBList reports Letterboxd on a 10-point scale (double the site's 5-star average).
	letterboxd: { label: "Letterboxd", format: (v) => `${(v > 5 ? v / 2 : v).toFixed(1)}/5`, max: 10, link: (u) => join("https://letterboxd.com", u) },
	trakt: { label: "Trakt", format: (v) => `${Math.round(v)}%`, max: 100, link: () => null },
	rogerebert: { label: "Roger Ebert", format: (v) => `${v}/4`, max: 4, link: (u) => join("https://www.rogerebert.com/reviews", u) },
	myanimelist: { label: "MyAnimeList", format: (v) => `${v.toFixed(2)}/10`, max: 10, link: (u) => join("https://myanimelist.net/anime", u) },
};

interface MdbRating {
	source: string;
	value: number | null;
	score: number | null;
	votes: number | null;
	url?: unknown;
}

interface MdbItem {
	ids?: { tmdb?: number | string; imdb?: string | null };
	tmdbid?: number | string;
	tmdb_id?: number | string;
	ratings?: MdbRating[];
}

/** What the scores table stores: MDBList's raw ratings, formatted on read. */
interface StoredRatings {
	imdbId: string | null;
	raw: MdbRating[];
}

export function normalizeRatings(raw: MdbRating[], ctx: LinkContext): Rating[] {
	const out: Rating[] = [];
	for (const r of raw) {
		if (r.value === null || r.value === undefined || Number(r.value) <= 0) continue;
		const value = Number(r.value);
		const meta = SOURCES[r.source];
		const normalized =
			r.score !== null && r.score !== undefined && Number(r.score) > 0
				? Number(r.score)
				: meta
					? (value / meta.max) * 100
					: value <= 10
						? value * 10
						: value;
		const url = meta ? meta.link(r.url, ctx) : typeof r.url === "string" && r.url.startsWith("https://") ? r.url : null;
		out.push({
			source: r.source,
			label: meta?.label ?? r.source,
			display: meta ? meta.format(value) : String(value),
			votes: r.votes ?? null,
			url,
			normalized: Math.round(Math.min(100, Math.max(0, normalized))),
		});
	}
	return out;
}

export function blend(ratings: Rating[]): number | null {
	if (!ratings.length) return null;
	return Math.round(ratings.reduce((s, r) => s + r.normalized, 0) / ratings.length);
}

const key = (t: MediaType, id: number) => `${t}:${id}`;

interface ScoreRow {
	media_type: MediaType;
	tmdb_id: number;
	ratings: string;
	blended: number | null;
	fetched_at: string;
}

function toScores(type: MediaType, id: number, stored: StoredRatings, fetchedAt: string): Scores {
	const ratings = normalizeRatings(stored.raw, { mediaType: type, tmdbId: id, imdbId: stored.imdbId });
	return { blended: blend(ratings), ratings, fetchedAt };
}

function rowToScores(row: ScoreRow): Scores {
	const parsed = JSON.parse(row.ratings) as StoredRatings | unknown[];
	// Rows from before raw storage hold pre-formatted ratings; treat them as empty until refreshed.
	const stored: StoredRatings = Array.isArray(parsed) ? { imdbId: null, raw: [] } : parsed;
	return toScores(row.media_type, row.tmdb_id, stored, row.fetched_at);
}

async function readCached(env: Env, items: { mediaType: MediaType; id: number }[]): Promise<Map<string, ScoreRow>> {
	const out = new Map<string, ScoreRow>();
	// D1 caps bound parameters per statement, so query in slices.
	for (let i = 0; i < items.length; i += 40) {
		const slice = items.slice(i, i + 40);
		const where = slice.map(() => "(media_type = ? AND tmdb_id = ?)").join(" OR ");
		const { results } = await env.DB.prepare(`SELECT * FROM scores WHERE ${where}`)
			.bind(...slice.flatMap((s) => [s.mediaType, s.id]))
			.all<ScoreRow>();
		for (const r of results) out.set(key(r.media_type, r.tmdb_id), r);
	}
	return out;
}

async function takeBudget(env: Env, calls: number): Promise<boolean> {
	const day = new Date().toISOString().slice(0, 10);
	const k = `mdblist:calls:${day}`;
	const used = Number((await env.CACHE.get(k)) ?? 0);
	if (used + calls > DAILY_BUDGET) return false;
	await env.CACHE.put(k, String(used + calls), { expirationTtl: 2 * 86400 });
	return true;
}

async function fetchBatch(env: Env, type: MediaType, ids: number[]): Promise<Map<number, StoredRatings>> {
	const out = new Map<number, StoredRatings>();
	if (!env.MDBLIST_API_KEY || !ids.length) return out;
	if (!(await takeBudget(env, 1))) return out;
	const res = await fetch(`${MDBLIST}/tmdb/${type === "tv" ? "show" : "movie"}/?apikey=${env.MDBLIST_API_KEY}`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({ ids }),
	});
	if (!res.ok) {
		console.warn("mdblist batch failed", res.status, await res.text().catch(() => ""));
		return out;
	}
	const items = (await res.json()) as MdbItem[];
	for (const item of items) {
		const id = Number(item.ids?.tmdb ?? item.tmdbid ?? item.tmdb_id);
		if (Number.isFinite(id)) out.set(id, { imdbId: item.ids?.imdb ?? null, raw: item.ratings ?? [] });
	}
	return out;
}

/**
 * Scores for many titles at once. Serves D1 cache hits, and refreshes misses
 * or stale rows with one MDBList batch call per media type.
 */
export async function getScores(
	env: Env,
	items: { mediaType: MediaType; id: number }[],
	{ refresh = true }: { refresh?: boolean } = {},
): Promise<Map<string, Scores>> {
	const unique = [...new Map(items.map((i) => [key(i.mediaType, i.id), i])).values()];
	const cached = await readCached(env, unique);
	const out = new Map<string, Scores>();
	const staleBefore = Date.now() - STALE_AFTER_DAYS * 86400_000;
	const toFetch: Record<MediaType, number[]> = { movie: [], tv: [] };

	for (const i of unique) {
		const row = cached.get(key(i.mediaType, i.id));
		if (row) out.set(key(i.mediaType, i.id), rowToScores(row));
		if (!row || Date.parse(`${row.fetched_at.replace(" ", "T")}Z`) < staleBefore) toFetch[i.mediaType].push(i.id);
	}
	if (!refresh) return out;

	const writes: D1PreparedStatement[] = [];
	for (const type of ["movie", "tv"] as const) {
		for (let i = 0; i < toFetch[type].length; i += BATCH_SIZE) {
			const ids = toFetch[type].slice(i, i + BATCH_SIZE);
			const fetched = await fetchBatch(env, type, ids);
			if (!fetched.size) continue;
			for (const id of ids) {
				const stored = fetched.get(id) ?? { imdbId: null, raw: [] };
				const scores = toScores(type, id, stored, new Date().toISOString());
				out.set(key(type, id), scores);
				writes.push(
					env.DB.prepare(
						`INSERT INTO scores (media_type, tmdb_id, ratings, blended, source_count, fetched_at)
						 VALUES (?, ?, ?, ?, ?, datetime('now'))
						 ON CONFLICT (media_type, tmdb_id) DO UPDATE SET
						   ratings = excluded.ratings, blended = excluded.blended,
						   source_count = excluded.source_count, fetched_at = excluded.fetched_at`,
					).bind(type, id, JSON.stringify(stored), scores.blended, scores.ratings.length),
				);
			}
		}
	}
	if (writes.length) await env.DB.batch(writes);
	return out;
}

export async function attachScores(env: Env, cards: TitleCard[], opts?: { refresh?: boolean }): Promise<TitleCard[]> {
	const scores = await getScores(env, cards, opts);
	for (const c of cards) c.scores = scores.get(key(c.mediaType, c.id)) ?? { blended: null, ratings: [], fetchedAt: null };
	return cards;
}
