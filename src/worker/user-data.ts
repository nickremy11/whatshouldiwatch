import type { MediaType, TitleCard, UserTitleState } from "../shared/types";
import { type TmdbListItem, tmdb, toCard } from "./tmdb";

interface UserTitleRow {
	media_type: MediaType;
	tmdb_id: number;
	in_watchlist: number;
	watched_at: string | null;
	rating: number | null;
}

const toState = (r: UserTitleRow): UserTitleState => ({
	inWatchlist: r.in_watchlist === 1,
	watchedAt: r.watched_at,
	rating: r.rating,
});

/** Adds the signed-in user's watchlist/watched/rating state to each card. */
export async function attachUserState(env: Env, userId: string | undefined, cards: TitleCard[]): Promise<TitleCard[]> {
	if (!userId || !cards.length) return cards;
	const states = new Map<string, UserTitleState>();
	for (let i = 0; i < cards.length; i += 40) {
		const slice = cards.slice(i, i + 40);
		const where = slice.map(() => "(media_type = ? AND tmdb_id = ?)").join(" OR ");
		const { results } = await env.DB.prepare(
			`SELECT media_type, tmdb_id, in_watchlist, watched_at, rating FROM user_titles WHERE user_id = ? AND (${where})`,
		)
			.bind(userId, ...slice.flatMap((c) => [c.mediaType, c.id]))
			.all<UserTitleRow>();
		for (const r of results) states.set(`${r.media_type}:${r.tmdb_id}`, toState(r));
	}
	for (const c of cards) c.user = states.get(`${c.mediaType}:${c.id}`) ?? { inWatchlist: false, watchedAt: null, rating: null };
	return cards;
}

export async function getUserState(env: Env, userId: string, type: MediaType, id: number): Promise<UserTitleState> {
	const row = await env.DB.prepare(
		"SELECT media_type, tmdb_id, in_watchlist, watched_at, rating FROM user_titles WHERE user_id = ? AND media_type = ? AND tmdb_id = ?",
	)
		.bind(userId, type, id)
		.first<UserTitleRow>();
	return row ? toState(row) : { inWatchlist: false, watchedAt: null, rating: null };
}

/** Caches a card-sized snapshot so lists and recommendations render without TMDB calls. */
export async function snapshotTitle(env: Env, type: MediaType, id: number): Promise<TitleCard> {
	const detail = await tmdb<TmdbListItem & { external_ids?: { imdb_id?: string | null }; imdb_id?: string | null }>(
		env,
		`/${type}/${id}`,
		{ append_to_response: "external_ids" },
	);
	const card = toCard(detail, type);
	if (!card) throw new Error("Unsupported title");
	await env.DB.prepare(
		`INSERT INTO titles (media_type, tmdb_id, imdb_id, title, year, poster_path, genre_ids, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
		 ON CONFLICT (media_type, tmdb_id) DO UPDATE SET imdb_id = excluded.imdb_id, title = excluded.title,
		   year = excluded.year, poster_path = excluded.poster_path, genre_ids = excluded.genre_ids, updated_at = excluded.updated_at`,
	)
		.bind(
			type,
			id,
			detail.imdb_id ?? detail.external_ids?.imdb_id ?? null,
			card.title,
			card.year,
			card.posterPath,
			JSON.stringify(card.genreIds),
		)
		.run();
	return card;
}

export interface SavedTitleRow extends UserTitleRow {
	title: string;
	year: number | null;
	poster_path: string | null;
	genre_ids: string;
	updated_at: string;
}

export function savedRowToCard(r: SavedTitleRow): TitleCard {
	return {
		mediaType: r.media_type,
		id: r.tmdb_id,
		title: r.title,
		year: r.year,
		posterPath: r.poster_path,
		overview: "",
		genreIds: JSON.parse(r.genre_ids) as number[],
		tmdbRating: null,
		tmdbVotes: 0,
		popularity: 0,
		user: toState(r),
	};
}

/** Per-genre taste: mean of (stars - 3) across rated titles. Positive = likes the genre. */
export async function genreAffinity(env: Env, userId: string): Promise<Map<number, number>> {
	const { results } = await env.DB.prepare(
		`SELECT t.genre_ids, ut.rating FROM user_titles ut
		 JOIN titles t ON t.media_type = ut.media_type AND t.tmdb_id = ut.tmdb_id
		 WHERE ut.user_id = ? AND ut.rating IS NOT NULL`,
	)
		.bind(userId)
		.all<{ genre_ids: string; rating: number }>();
	const sums = new Map<number, { total: number; n: number }>();
	for (const r of results) {
		for (const g of JSON.parse(r.genre_ids) as number[]) {
			const s = sums.get(g) ?? { total: 0, n: 0 };
			s.total += r.rating - 3;
			s.n += 1;
			sums.set(g, s);
		}
	}
	return new Map([...sums].map(([g, s]) => [g, s.total / s.n]));
}
