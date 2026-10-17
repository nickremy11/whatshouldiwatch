import { HTTPException } from "hono/http-exception";
import type { MediaType, Provider, TitleCard, WatchAvailability } from "../shared/types";

const BASE = "https://api.themoviedb.org/3";

type Params = Record<string, string | number | boolean | undefined | null>;

/**
 * GET a TMDB v3 endpoint, cached in KV. TMDB data changes slowly, so most
 * callers use the default hour; search-as-you-type uses a shorter TTL.
 */
export async function tmdb<T>(env: Env, path: string, params: Params = {}, ttlSeconds = 3600): Promise<T> {
	const qs = new URLSearchParams();
	for (const [k, v] of Object.entries(params).sort(([a], [b]) => a.localeCompare(b))) {
		if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
	}
	const key = `tmdb:${path}?${qs}`;
	const cached = await env.CACHE.get<T>(key, "json");
	if (cached) return cached;

	if (!env.TMDB_TOKEN) throw new HTTPException(503, { message: "TMDB_TOKEN is not configured" });
	const res = await fetch(`${BASE}${path}?${qs}`, {
		headers: { Authorization: `Bearer ${env.TMDB_TOKEN}`, Accept: "application/json" },
	});
	if (res.status === 404) throw new HTTPException(404, { message: "Not found on TMDB" });
	if (!res.ok) throw new HTTPException(502, { message: `TMDB error ${res.status}` });
	const data = (await res.json()) as T;
	await env.CACHE.put(key, JSON.stringify(data), { expirationTtl: Math.max(60, ttlSeconds) });
	return data;
}

export interface TmdbListItem {
	id: number;
	media_type?: string;
	title?: string;
	name?: string;
	release_date?: string;
	first_air_date?: string;
	poster_path?: string | null;
	profile_path?: string | null;
	overview?: string;
	genre_ids?: number[];
	genres?: { id: number }[];
	vote_average?: number;
	vote_count?: number;
	popularity?: number;
	known_for_department?: string;
	known_for?: TmdbListItem[];
}

export interface TmdbPage<T = TmdbListItem> {
	page: number;
	total_pages: number;
	total_results: number;
	results: T[];
}

export function yearOf(date: string | undefined | null): number | null {
	const y = date ? Number.parseInt(date.slice(0, 4), 10) : Number.NaN;
	return Number.isFinite(y) ? y : null;
}

export function toCard(item: TmdbListItem, fallbackType?: MediaType): TitleCard | null {
	const mediaType = (item.media_type ?? fallbackType) as MediaType | undefined;
	if (mediaType !== "movie" && mediaType !== "tv") return null;
	return {
		mediaType,
		id: item.id,
		title: item.title ?? item.name ?? "Untitled",
		year: yearOf(item.release_date ?? item.first_air_date),
		posterPath: item.poster_path ?? null,
		overview: item.overview ?? "",
		genreIds: item.genre_ids ?? item.genres?.map((g) => g.id) ?? [],
		tmdbRating: item.vote_count ? (item.vote_average ?? null) : null,
		tmdbVotes: item.vote_count ?? 0,
		popularity: item.popularity ?? 0,
	};
}

export function toCards(items: TmdbListItem[], fallbackType?: MediaType): TitleCard[] {
	return items.map((i) => toCard(i, fallbackType)).filter((c): c is TitleCard => c !== null);
}

interface TmdbProvider {
	provider_id: number;
	provider_name: string;
	logo_path: string | null;
	display_priority?: number;
}

interface TmdbRegionProviders {
	link?: string;
	flatrate?: TmdbProvider[];
	free?: TmdbProvider[];
	ads?: TmdbProvider[];
	rent?: TmdbProvider[];
	buy?: TmdbProvider[];
}

const toProvider = (p: TmdbProvider): Provider => ({ id: p.provider_id, name: p.provider_name, logoPath: p.logo_path });

export function toWatch(
	results: Record<string, TmdbRegionProviders> | undefined,
	region: string,
): WatchAvailability | null {
	const r = results?.[region];
	if (!r) return null;
	return {
		region,
		link: r.link ?? null,
		stream: (r.flatrate ?? []).map(toProvider),
		free: (r.free ?? []).map(toProvider),
		ads: (r.ads ?? []).map(toProvider),
		rent: (r.rent ?? []).map(toProvider),
		buy: (r.buy ?? []).map(toProvider),
	};
}

/** Provider ids where the title can be watched without renting/buying. */
export async function includedProviderIds(env: Env, type: MediaType, id: number, region: string): Promise<number[]> {
	const data = await tmdb<{ results: Record<string, TmdbRegionProviders> }>(
		env,
		`/${type}/${id}/watch/providers`,
		{},
		6 * 3600,
	);
	const r = data.results?.[region];
	return [...(r?.flatrate ?? []), ...(r?.free ?? []), ...(r?.ads ?? [])].map((p) => p.provider_id);
}

export async function listProviders(env: Env, region: string): Promise<(Provider & { priority: number })[]> {
	const [movie, tv] = await Promise.all(
		(["movie", "tv"] as const).map((t) =>
			tmdb<{ results: (TmdbProvider & { display_priorities?: Record<string, number> })[] }>(
				env,
				`/watch/providers/${t}`,
				{ watch_region: region },
				24 * 3600,
			),
		),
	);
	const byId = new Map<number, Provider & { priority: number }>();
	for (const p of [...movie.results, ...tv.results]) {
		const priority = p.display_priorities?.[region] ?? p.display_priority ?? 999;
		const existing = byId.get(p.provider_id);
		if (!existing || priority < existing.priority) byId.set(p.provider_id, { ...toProvider(p), priority });
	}
	return [...byId.values()].sort((a, b) => a.priority - b.priority);
}
