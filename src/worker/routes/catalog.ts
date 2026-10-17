import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type {
	CastMember,
	CollectionInfo,
	DiscoverSort,
	Episode,
	MediaType,
	Paged,
	PersonCard,
	TitleCard,
	TitleDetail,
} from "../../shared/types";
import type { AppEnv } from "../auth";
import { attachScores } from "../ratings";
import {
	includedProviderIds,
	listProviders,
	type TmdbListItem,
	type TmdbPage,
	tmdb,
	toCard,
	toCards,
	toWatch,
} from "../tmdb";
import { attachUserState, getUserState } from "../user-data";

export const catalog = new Hono<AppEnv>();

const PAGE_SIZE = 20;
/** TMDB "Talk" and "News" TV genres: noise in an actor's TV credits unless asked for. */
const TALK_NEWS = new Set([10767, 10763]);

export function regionFor(c: Context<AppEnv>): string {
	const q = c.req.query("region");
	if (q && /^[A-Z]{2}$/.test(q)) return q;
	return c.get("user")?.region ?? "US";
}

async function enrich(c: Context<AppEnv>, cards: TitleCard[]): Promise<TitleCard[]> {
	await attachScores(c.env, cards);
	await attachUserState(c.env, c.get("user")?.id, cards);
	return cards;
}

catalog.get("/genres", async (c) => {
	const [movie, tv] = await Promise.all(
		(["movie", "tv"] as const).map((t) =>
			tmdb<{ genres: { id: number; name: string }[] }>(c.env, `/genre/${t}/list`, {}, 7 * 86400),
		),
	);
	return c.json({ movie: movie.genres, tv: tv.genres });
});

catalog.get("/providers", async (c) => {
	return c.json(await listProviders(c.env, regionFor(c)));
});

catalog.get("/regions", async (c) => {
	const data = await tmdb<{ results: { iso_3166_1: string; english_name: string }[] }>(
		c.env,
		"/watch/providers/regions",
		{},
		7 * 86400,
	);
	return c.json(
		data.results
			.map((r) => ({ code: r.iso_3166_1, name: r.english_name }))
			.sort((a, b) => a.name.localeCompare(b.name)),
	);
});

catalog.get("/search", async (c) => {
	const q = (c.req.query("q") ?? "").trim();
	const page = Number(c.req.query("page") ?? 1) || 1;
	if (!q) return c.json({ titles: [], people: [], page: 1, totalPages: 0 });
	const data = await tmdb<TmdbPage>(c.env, "/search/multi", { query: q, page, include_adult: false }, 600);
	const people: PersonCard[] = data.results
		.filter((r) => r.media_type === "person")
		.map((p) => ({
			id: p.id,
			name: p.name ?? "",
			profilePath: p.profile_path ?? null,
			knownFor: (p.known_for ?? [])
				.map((k) => k.title ?? k.name)
				.filter(Boolean)
				.slice(0, 3)
				.join(", "),
		}));
	const titles = await enrich(c, toCards(data.results));
	return c.json({ titles, people, page: data.page, totalPages: data.total_pages });
});

catalog.get("/people/search", async (c) => {
	const q = (c.req.query("q") ?? "").trim();
	if (q.length < 2) return c.json([]);
	const data = await tmdb<TmdbPage>(c.env, "/search/person", { query: q, include_adult: false }, 3600);
	return c.json(
		data.results.slice(0, 8).map(
			(p): PersonCard => ({
				id: p.id,
				name: p.name ?? "",
				profilePath: p.profile_path ?? null,
				knownFor: (p.known_for ?? [])
					.map((k) => k.title ?? k.name)
					.filter(Boolean)
					.slice(0, 2)
					.join(", "),
			}),
		),
	);
});

catalog.get("/people/:id", async (c) => {
	const id = Number(c.req.param("id"));
	const person = await tmdb<{
		id: number;
		name: string;
		biography: string;
		profile_path: string | null;
		birthday: string | null;
		known_for_department: string;
		combined_credits: { cast: (TmdbListItem & { character?: string })[] };
	}>(c.env, `/person/${id}`, { append_to_response: "combined_credits" }, 86400);
	const seen = new Set<string>();
	const credits = toCards(
		person.combined_credits.cast
			.filter((t) => !(t.genre_ids ?? []).some((g) => TALK_NEWS.has(g)))
			.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0)),
	).filter((card) => {
		const k = `${card.mediaType}:${card.id}`;
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
	await enrich(c, credits.slice(0, 40));
	return c.json({
		id: person.id,
		name: person.name,
		biography: person.biography,
		profilePath: person.profile_path,
		birthday: person.birthday,
		department: person.known_for_department,
		credits: credits.slice(0, 40),
	});
});

const discoverQuery = z.object({
	type: z.enum(["movie", "tv"]).default("movie"),
	genres: z.string().optional(),
	genreMode: z.enum(["all", "any"]).default("all"),
	person: z.coerce.number().int().positive().optional(),
	providers: z.string().optional(),
	myServices: z.enum(["0", "1"]).optional(),
	yearFrom: z.coerce.number().int().optional(),
	yearTo: z.coerce.number().int().optional(),
	minTmdb: z.coerce.number().min(0).max(10).optional(),
	minBlend: z.coerce.number().min(0).max(100).optional(),
	hideWatched: z.enum(["0", "1"]).optional(),
	sort: z.enum(["popularity", "blended", "tmdb_rating", "newest", "oldest", "title"]).default("popularity"),
	page: z.coerce.number().int().min(1).max(500).default(1),
});

const ids = (s: string | undefined) =>
	(s ?? "")
		.split(",")
		.map(Number)
		// -1 is a sentinel for "no allowed providers" so the result is empty rather than unfiltered.
		.filter((n) => Number.isInteger(n) && (n > 0 || n === -1));

function tmdbSort(type: MediaType, sort: DiscoverSort): string {
	switch (sort) {
		case "tmdb_rating":
			return "vote_average.desc";
		case "newest":
			return type === "movie" ? "primary_release_date.desc" : "first_air_date.desc";
		case "oldest":
			return type === "movie" ? "primary_release_date.asc" : "first_air_date.asc";
		case "title":
			return type === "movie" ? "title.asc" : "name.asc";
		default:
			return "popularity.desc";
	}
}

function localSort(cards: TitleCard[], sort: DiscoverSort): TitleCard[] {
	const by: Record<DiscoverSort, (a: TitleCard, b: TitleCard) => number> = {
		popularity: (a, b) => b.popularity - a.popularity,
		blended: (a, b) => (b.scores?.blended ?? -1) - (a.scores?.blended ?? -1),
		tmdb_rating: (a, b) => (b.tmdbRating ?? -1) - (a.tmdbRating ?? -1),
		newest: (a, b) => (b.year ?? 0) - (a.year ?? 0),
		oldest: (a, b) => (a.year ?? 9999) - (b.year ?? 9999),
		title: (a, b) => a.title.localeCompare(b.title),
	};
	return [...cards].sort(by[sort]);
}

catalog.get("/discover", async (c) => {
	const q = discoverQuery.parse(c.req.query());
	const region = regionFor(c);
	const user = c.get("user");
	const genres = ids(q.genres);

	let providers = ids(q.providers);
	if (q.myServices === "1" && user) {
		const { results } = await c.env.DB.prepare("SELECT provider_id FROM user_services WHERE user_id = ?")
			.bind(user.id)
			.all<{ provider_id: number }>();
		const mine = results.map((r) => r.provider_id);
		providers = providers.length ? providers.filter((p) => mine.includes(p)) : mine;
		if (!providers.length) providers = [-1]; // no overlap → empty results, not "any provider"
	}

	let cards: TitleCard[];
	let page = q.page;
	let totalPages = 1;
	let totalResults = 0;

	if (q.person && q.type === "tv") {
		// TMDB's TV discover can't filter by cast, so filter the actor's TV credits ourselves.
		const credits = await tmdb<{ cast: TmdbListItem[] }>(c.env, `/person/${q.person}/tv_credits`, {}, 86400);
		let pool = toCards(credits.cast, "tv").filter((t) => {
			if (!genres.length && t.genreIds.some((g) => TALK_NEWS.has(g))) return false;
			if (genres.length) {
				const hit = q.genreMode === "all" ? genres.every((g) => t.genreIds.includes(g)) : genres.some((g) => t.genreIds.includes(g));
				if (!hit) return false;
			}
			if (q.yearFrom && (t.year ?? 0) < q.yearFrom) return false;
			if (q.yearTo && (t.year ?? 9999) > q.yearTo) return false;
			if (q.minTmdb && (t.tmdbRating ?? 0) < q.minTmdb) return false;
			return true;
		});
		pool = [...new Map(pool.map((t) => [t.id, t])).values()].slice(0, 80);
		if (providers.length) {
			const avail = await Promise.all(pool.map((t) => includedProviderIds(c.env, "tv", t.id, region)));
			pool = pool.filter((_, i) => avail[i].some((p) => providers.includes(p)));
		}
		pool = localSort(pool, q.sort === "blended" ? "popularity" : q.sort);
		totalResults = pool.length;
		totalPages = Math.max(1, Math.ceil(pool.length / PAGE_SIZE));
		page = Math.min(page, totalPages);
		cards = pool.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
	} else {
		const dateField = q.type === "movie" ? "primary_release_date" : "first_air_date";
		const strictVotes = q.sort === "tmdb_rating" || q.minTmdb !== undefined;
		const data = await tmdb<TmdbPage>(
			c.env,
			`/discover/${q.type}`,
			{
				include_adult: false,
				page,
				sort_by: tmdbSort(q.type, q.sort),
				with_genres: genres.join(q.genreMode === "all" ? "," : "|"),
				with_cast: q.person,
				with_watch_providers: providers.join("|"),
				watch_region: providers.length ? region : undefined,
				with_watch_monetization_types: providers.length ? "flatrate|free|ads" : undefined,
				[`${dateField}.gte`]: q.yearFrom ? `${q.yearFrom}-01-01` : undefined,
				[`${dateField}.lte`]: q.yearTo ? `${q.yearTo}-12-31` : undefined,
				"vote_average.gte": q.minTmdb,
				"vote_count.gte": strictVotes ? 100 : q.sort === "title" || q.sort === "oldest" ? 10 : undefined,
			},
			1800,
		);
		cards = toCards(data.results, q.type);
		totalPages = Math.min(data.total_pages, 500);
		totalResults = data.total_results;
	}

	await enrich(c, cards);
	let note: string | undefined;
	if (q.minBlend !== undefined) {
		cards = cards.filter((t) => (t.scores?.blended ?? -1) >= q.minBlend!);
		note = "The blended-score filter is applied to each page of results, so some pages may show fewer titles.";
	}
	if (q.hideWatched === "1") cards = cards.filter((t) => !t.user?.watchedAt);
	if (q.sort === "blended") {
		cards = localSort(cards, "blended");
		note ??= "Blended-score sorting ranks titles within each page of results.";
	}

	return c.json({ page, totalPages, totalResults, results: cards, note } satisfies Paged<TitleCard>);
});

interface TmdbDetail extends TmdbListItem {
	tagline?: string;
	genres: { id: number; name: string }[];
	runtime?: number;
	episode_run_time?: number[];
	status: string;
	imdb_id?: string | null;
	backdrop_path?: string | null;
	number_of_seasons?: number;
	number_of_episodes?: number;
	seasons?: { season_number: number; name: string; episode_count: number; air_date: string | null; poster_path: string | null }[];
	next_episode_to_air?: { season_number: number; episode_number: number; air_date: string | null } | null;
	created_by?: { name: string }[];
	belongs_to_collection?: { id: number; name: string } | null;
	credits?: { cast: TmdbCast[]; crew: { job: string; name: string }[] };
	aggregate_credits?: { cast: (Omit<TmdbCast, "character"> & { roles: { character: string }[] })[] };
	external_ids?: { imdb_id?: string | null };
	"watch/providers"?: { results: Record<string, never> };
	recommendations?: TmdbPage;
	release_dates?: { results: { iso_3166_1: string; release_dates: { certification: string }[] }[] };
	content_ratings?: { results: { iso_3166_1: string; rating: string }[] };
	videos?: { results: { site: string; type: string; key: string; official: boolean }[] };
}

interface TmdbCast {
	id: number;
	name: string;
	character: string;
	profile_path: string | null;
}

catalog.get("/title/:type/:id", async (c) => {
	const type = z.enum(["movie", "tv"]).parse(c.req.param("type"));
	const id = z.coerce.number().int().positive().parse(c.req.param("id"));
	const region = regionFor(c);
	const user = c.get("user");

	const d = await tmdb<TmdbDetail>(c.env, `/${type}/${id}`, {
		append_to_response:
			type === "movie"
				? "credits,watch/providers,recommendations,external_ids,release_dates,videos"
				: "aggregate_credits,watch/providers,recommendations,external_ids,content_ratings,videos",
	});
	const base = toCard(d, type);
	if (!base) throw new HTTPException(404);

	const cast: CastMember[] =
		type === "movie"
			? (d.credits?.cast ?? []).slice(0, 15).map((m) => ({ id: m.id, name: m.name, character: m.character, profilePath: m.profile_path }))
			: (d.aggregate_credits?.cast ?? []).slice(0, 15).map((m) => ({
					id: m.id,
					name: m.name,
					character: m.roles.map((r) => r.character).filter(Boolean).join(" / "),
					profilePath: m.profile_path,
				}));

	let collection: CollectionInfo | null = null;
	if (d.belongs_to_collection) {
		const col = await tmdb<{ id: number; name: string; parts: TmdbListItem[] }>(
			c.env,
			`/collection/${d.belongs_to_collection.id}`,
			{},
			86400,
		);
		collection = {
			id: col.id,
			name: col.name,
			parts: toCards(col.parts, "movie").sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999)),
		};
	}

	const certification =
		type === "movie"
			? (d.release_dates?.results.find((r) => r.iso_3166_1 === region)?.release_dates.find((r) => r.certification)?.certification ?? null)
			: (d.content_ratings?.results.find((r) => r.iso_3166_1 === region)?.rating ?? null);
	const trailer = d.videos?.results.find((v) => v.site === "YouTube" && v.type === "Trailer" && v.official) ??
		d.videos?.results.find((v) => v.site === "YouTube" && v.type === "Trailer");

	const recommendations = toCards(d.recommendations?.results ?? [], type).slice(0, 12);
	const detail: TitleDetail = {
		...base,
		tagline: d.tagline ?? "",
		genres: d.genres,
		runtime: d.runtime ?? d.episode_run_time?.[0] ?? null,
		status: d.status,
		certification: certification || null,
		imdbId: d.imdb_id ?? d.external_ids?.imdb_id ?? null,
		backdropPath: d.backdrop_path ?? null,
		cast,
		directors: (d.credits?.crew ?? []).filter((m) => m.job === "Director").map((m) => m.name),
		creators: (d.created_by ?? []).map((m) => m.name),
		watch: toWatch(d["watch/providers"]?.results, region),
		collection,
		recommendations,
		trailerKey: trailer?.key ?? null,
	};
	if (type === "tv") {
		detail.numberOfSeasons = d.number_of_seasons;
		detail.numberOfEpisodes = d.number_of_episodes;
		detail.seasons = (d.seasons ?? []).map((s) => ({
			seasonNumber: s.season_number,
			name: s.name,
			episodeCount: s.episode_count,
			airDate: s.air_date,
			posterPath: s.poster_path,
		}));
		detail.nextEpisode = d.next_episode_to_air
			? {
					seasonNumber: d.next_episode_to_air.season_number,
					episodeNumber: d.next_episode_to_air.episode_number,
					airDate: d.next_episode_to_air.air_date,
				}
			: null;
	}

	// One scores call covers the title, its recommendations and its collection.
	const all = [detail, ...recommendations, ...(collection?.parts ?? [])];
	await attachScores(c.env, all);
	if (user) {
		await attachUserState(c.env, user.id, all);
		detail.user = await getUserState(c.env, user.id, type, id);
		if (type === "tv") {
			const { results } = await c.env.DB.prepare(
				"SELECT season, episode FROM user_episodes WHERE user_id = ? AND tmdb_id = ?",
			)
				.bind(user.id, id)
				.all<{ season: number; episode: number }>();
			detail.watchedEpisodes = results.map((r) => `${r.season}:${r.episode}`);
		}
	}
	return c.json(detail);
});

catalog.get("/title/tv/:id/season/:season", async (c) => {
	const id = z.coerce.number().int().positive().parse(c.req.param("id"));
	const season = z.coerce.number().int().min(0).parse(c.req.param("season"));
	const data = await tmdb<{
		episodes: {
			season_number: number;
			episode_number: number;
			name: string;
			overview: string;
			air_date: string | null;
			runtime: number | null;
			still_path: string | null;
			vote_average: number;
			vote_count: number;
		}[];
	}>(c.env, `/tv/${id}/season/${season}`, {}, 6 * 3600);
	const user = c.get("user");
	const watched = new Set<number>();
	if (user) {
		const { results } = await c.env.DB.prepare(
			"SELECT episode FROM user_episodes WHERE user_id = ? AND tmdb_id = ? AND season = ?",
		)
			.bind(user.id, id, season)
			.all<{ episode: number }>();
		for (const r of results) watched.add(r.episode);
	}
	const episodes: Episode[] = data.episodes.map((e) => ({
		seasonNumber: e.season_number,
		episodeNumber: e.episode_number,
		name: e.name,
		overview: e.overview,
		airDate: e.air_date,
		runtime: e.runtime,
		stillPath: e.still_path,
		tmdbRating: e.vote_count ? e.vote_average : null,
		tmdbVotes: e.vote_count,
		watched: watched.has(e.episode_number),
	}));
	return c.json({ season, episodes });
});
