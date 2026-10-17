import { Hono } from "hono";
import { z } from "zod";
import type { Me } from "../../shared/types";
import { type AppEnv, requireUser } from "../auth";
import { attachScores } from "../ratings";
import { tmdb } from "../tmdb";
import { getUserState, type SavedTitleRow, savedRowToCard, snapshotTitle } from "../user-data";

export const me = new Hono<AppEnv>();
me.use(requireUser);

me.get("/", async (c) => {
	const user = c.get("user")!;
	const { results } = await c.env.DB.prepare("SELECT provider_id FROM user_services WHERE user_id = ?")
		.bind(user.id)
		.all<{ provider_id: number }>();
	return c.json({
		id: user.id,
		email: user.email,
		name: user.name,
		avatarUrl: user.avatar_url,
		region: user.region,
		services: results.map((r) => r.provider_id),
	} satisfies Me);
});

me.put("/region", async (c) => {
	const { region } = z.object({ region: z.string().regex(/^[A-Z]{2}$/) }).parse(await c.req.json());
	await c.env.DB.prepare("UPDATE users SET region = ? WHERE id = ?").bind(region, c.get("user")!.id).run();
	return c.json({ ok: true });
});

me.put("/services", async (c) => {
	const { providers } = z.object({ providers: z.array(z.number().int().positive()).max(100) }).parse(await c.req.json());
	const userId = c.get("user")!.id;
	await c.env.DB.batch([
		c.env.DB.prepare("DELETE FROM user_services WHERE user_id = ?").bind(userId),
		...providers.map((p) =>
			c.env.DB.prepare("INSERT OR IGNORE INTO user_services (user_id, provider_id) VALUES (?, ?)").bind(userId, p),
		),
	]);
	return c.json({ ok: true });
});

const LISTS = {
	watchlist: "ut.in_watchlist = 1",
	watched: "ut.watched_at IS NOT NULL",
	rated: "ut.rating IS NOT NULL",
} as const;

me.get("/titles", async (c) => {
	const list = z.enum(["watchlist", "watched", "rated"]).parse(c.req.query("list") ?? "watchlist");
	const { results } = await c.env.DB.prepare(
		`SELECT ut.media_type, ut.tmdb_id, ut.in_watchlist, ut.watched_at, ut.rating, ut.updated_at,
		        t.title, t.year, t.poster_path, t.genre_ids
		 FROM user_titles ut
		 JOIN titles t ON t.media_type = ut.media_type AND t.tmdb_id = ut.tmdb_id
		 WHERE ut.user_id = ? AND ${LISTS[list]}
		 ORDER BY ut.updated_at DESC`,
	)
		.bind(c.get("user")!.id)
		.all<SavedTitleRow>();
	const cards = results.map(savedRowToCard);
	await attachScores(c.env, cards, { refresh: false });
	return c.json(cards);
});

const titleUpdate = z.object({
	inWatchlist: z.boolean().optional(),
	watched: z.boolean().optional(),
	rating: z
		.number()
		.min(0.5)
		.max(5)
		.refine((n) => Number.isInteger(n * 2), "Ratings are in half-star steps")
		.nullable()
		.optional(),
});

me.put("/titles/:type/:id", async (c) => {
	const type = z.enum(["movie", "tv"]).parse(c.req.param("type"));
	const id = z.coerce.number().int().positive().parse(c.req.param("id"));
	const body = titleUpdate.parse(await c.req.json());
	const userId = c.get("user")!.id;

	await snapshotTitle(c.env, type, id);
	const current = await getUserState(c.env, userId, type, id);
	const next = {
		inWatchlist: body.inWatchlist ?? current.inWatchlist,
		watchedAt: body.watched === undefined ? current.watchedAt : body.watched ? (current.watchedAt ?? new Date().toISOString()) : null,
		rating: body.rating === undefined ? current.rating : body.rating,
	};
	// Rating something means you've seen it.
	if (typeof body.rating === "number" && body.watched === undefined && !next.watchedAt) {
		next.watchedAt = new Date().toISOString();
	}
	// Watching something takes it off the watchlist.
	if (next.watchedAt && !current.watchedAt && body.inWatchlist === undefined) next.inWatchlist = false;

	if (!next.inWatchlist && !next.watchedAt && next.rating === null) {
		await c.env.DB.prepare("DELETE FROM user_titles WHERE user_id = ? AND media_type = ? AND tmdb_id = ?")
			.bind(userId, type, id)
			.run();
	} else {
		await c.env.DB.prepare(
			`INSERT INTO user_titles (user_id, media_type, tmdb_id, in_watchlist, watched_at, rating, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
			 ON CONFLICT (user_id, media_type, tmdb_id) DO UPDATE SET in_watchlist = excluded.in_watchlist,
			   watched_at = excluded.watched_at, rating = excluded.rating, updated_at = excluded.updated_at`,
		)
			.bind(userId, type, id, next.inWatchlist ? 1 : 0, next.watchedAt, next.rating)
			.run();
	}
	await c.env.CACHE.delete(`recs:${userId}`);
	return c.json(next);
});

const episodeUpdate = z.object({
	season: z.number().int().min(0),
	episodes: z.array(z.number().int().min(0)).min(1).max(500),
	watched: z.boolean(),
});

/** Marks episodes watched/unwatched and keeps the show's own watched flag in sync. */
me.put("/episodes/:id", async (c) => {
	const id = z.coerce.number().int().positive().parse(c.req.param("id"));
	const { season, episodes, watched } = episodeUpdate.parse(await c.req.json());
	const userId = c.get("user")!.id;

	await c.env.DB.batch(
		episodes.map((e) =>
			watched
				? c.env.DB.prepare(
						"INSERT OR IGNORE INTO user_episodes (user_id, tmdb_id, season, episode) VALUES (?, ?, ?, ?)",
					).bind(userId, id, season, e)
				: c.env.DB.prepare(
						"DELETE FROM user_episodes WHERE user_id = ? AND tmdb_id = ? AND season = ? AND episode = ?",
					).bind(userId, id, season, e),
		),
	);

	// Compare against aired, non-special episodes to decide whether the show is finished.
	const show = await tmdb<{
		seasons?: { season_number: number; episode_count: number }[];
		last_episode_to_air?: { season_number: number; episode_number: number } | null;
	}>(c.env, `/tv/${id}`);
	const last = show.last_episode_to_air;
	const aired = (show.seasons ?? [])
		.filter((s) => s.season_number > 0 && last && s.season_number <= last.season_number)
		.reduce((n, s) => n + (s.season_number === last!.season_number ? last!.episode_number : s.episode_count), 0);
	const row = await c.env.DB.prepare(
		"SELECT COUNT(*) AS n FROM user_episodes WHERE user_id = ? AND tmdb_id = ? AND season > 0",
	)
		.bind(userId, id)
		.first<{ n: number }>();
	const watchedCount = row?.n ?? 0;
	const finished = aired > 0 && watchedCount >= aired;

	await snapshotTitle(c.env, "tv", id);
	const state = await getUserState(c.env, userId, "tv", id);
	// Finishing every aired episode marks the show watched; un-ticking an episode un-marks it.
	// Ticking episodes otherwise leaves a manual "watched" (or a rating's) alone.
	const watchedAt = finished ? (state.watchedAt ?? new Date().toISOString()) : watched ? state.watchedAt : null;
	await c.env.DB.prepare(
		`INSERT INTO user_titles (user_id, media_type, tmdb_id, in_watchlist, watched_at, rating, updated_at)
		 VALUES (?, 'tv', ?, ?, ?, ?, datetime('now'))
		 ON CONFLICT (user_id, media_type, tmdb_id) DO UPDATE SET in_watchlist = excluded.in_watchlist,
		   watched_at = excluded.watched_at, updated_at = excluded.updated_at`,
	)
		.bind(userId, id, finished ? 0 : state.inWatchlist ? 1 : 0, watchedAt, state.rating)
		.run();

	return c.json({ watchedCount, airedCount: aired, finished });
});
