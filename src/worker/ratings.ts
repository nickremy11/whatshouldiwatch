import type { MediaType, Rating, Scores, TitleCard } from "../shared/types";

const MDBLIST = "https://api.mdblist.com";
const STALE_AFTER_DAYS = 7;
/** Free tier is 1,000/day; leave headroom for manual use. */
const DAILY_BUDGET = 900;
const BATCH_SIZE = 100;

/** How each MDBList source is labelled and shown in its native format. */
const SOURCES: Record<string, { label: string; format: (v: number) => string; max: number }> = {
	imdb: { label: "IMDb", format: (v) => `${v.toFixed(1)}/10`, max: 10 },
	tmdb: { label: "TMDB", format: (v) => `${Math.round(v)}%`, max: 100 },
	metacritic: { label: "Metacritic", format: (v) => `${Math.round(v)}`, max: 100 },
	metacriticuser: { label: "Metacritic Users", format: (v) => `${v.toFixed(1)}/10`, max: 10 },
	tomatoes: { label: "Rotten Tomatoes", format: (v) => `${Math.round(v)}%`, max: 100 },
	popcorn: { label: "RT Audience", format: (v) => `${Math.round(v)}%`, max: 100 },
	letterboxd: { label: "Letterboxd", format: (v) => `${v.toFixed(1)}/5`, max: 5 },
	trakt: { label: "Trakt", format: (v) => `${Math.round(v)}%`, max: 100 },
	rogerebert: { label: "Roger Ebert", format: (v) => `${v}/4`, max: 4 },
	myanimelist: { label: "MyAnimeList", format: (v) => `${v.toFixed(2)}/10`, max: 10 },
};

interface MdbRating {
	source: string;
	value: number | null;
	score: number | null;
	votes: number | null;
	url?: string | null;
}

interface MdbItem {
	ids?: { tmdb?: number | string };
	tmdbid?: number | string;
	tmdb_id?: number | string;
	ratings?: MdbRating[];
}

export function normalizeRatings(raw: MdbRating[]): Rating[] {
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
		out.push({
			source: r.source,
			label: meta?.label ?? r.source,
			display: meta ? meta.format(value) : String(value),
			votes: r.votes ?? null,
			url: r.url ?? null,
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

function rowToScores(row: ScoreRow): Scores {
	return { blended: row.blended, ratings: JSON.parse(row.ratings) as Rating[], fetchedAt: row.fetched_at };
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

async function fetchBatch(env: Env, type: MediaType, ids: number[]): Promise<Map<number, MdbRating[]>> {
	const out = new Map<number, MdbRating[]>();
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
		if (Number.isFinite(id)) out.set(id, item.ratings ?? []);
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
				const ratings = normalizeRatings(fetched.get(id) ?? []);
				const scores: Scores = { blended: blend(ratings), ratings, fetchedAt: new Date().toISOString() };
				out.set(key(type, id), scores);
				writes.push(
					env.DB.prepare(
						`INSERT INTO scores (media_type, tmdb_id, ratings, blended, source_count, fetched_at)
						 VALUES (?, ?, ?, ?, ?, datetime('now'))
						 ON CONFLICT (media_type, tmdb_id) DO UPDATE SET
						   ratings = excluded.ratings, blended = excluded.blended,
						   source_count = excluded.source_count, fetched_at = excluded.fetched_at`,
					).bind(type, id, JSON.stringify(ratings), scores.blended, ratings.length),
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
