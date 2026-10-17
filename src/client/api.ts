import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppConfig, Me, MediaType, UserTitleState } from "../shared/types";

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}

const ANON_REGION_KEY = "wsiw:region";
const ANON_SERVICES_KEY = "wsiw:services";

function readLocal<T>(key: string, fallback: T): T {
	try {
		const v = localStorage.getItem(key);
		return v ? (JSON.parse(v) as T) : fallback;
	} catch {
		return fallback;
	}
}

function writeLocal(key: string, value: unknown) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Private mode etc. — preferences just won't persist.
	}
}

export const anonPrefs = {
	region: () => readLocal(ANON_REGION_KEY, "US"),
	services: () => readLocal<number[]>(ANON_SERVICES_KEY, []),
	setRegion: (r: string) => writeLocal(ANON_REGION_KEY, r),
	setServices: (s: number[]) => writeLocal(ANON_SERVICES_KEY, s),
};

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
	const { json, ...rest } = init ?? {};
	const res = await fetch(`/api${path}`, {
		...rest,
		headers: { Accept: "application/json", ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...rest.headers },
		body: json !== undefined ? JSON.stringify(json) : rest.body,
	});
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
	}
	return res.json() as Promise<T>;
}

/** Builds a query string, dropping empty values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
	const s = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "" && v !== false) s.set(k, String(v));
	const out = s.toString();
	return out ? `?${out}` : "";
}

export function useConfig() {
	return useQuery({ queryKey: ["config"], queryFn: () => api<AppConfig>("/config"), staleTime: 5 * 60_000 });
}

export function useMe() {
	const config = useConfig();
	const signedIn = Boolean(config.data?.me);
	const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me"), enabled: signedIn });
	return { signedIn, me: me.data ?? null, loading: config.isLoading };
}

/** Region + services for queries: the account's when signed in, otherwise this browser's. */
export function usePrefs() {
	const { signedIn, me } = useMe();
	return {
		region: signedIn && me ? me.region : anonPrefs.region(),
		services: signedIn && me ? me.services : anonPrefs.services(),
	};
}

export function useUpdateTitle(type: MediaType, id: number) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (body: { inWatchlist?: boolean; watched?: boolean; rating?: number | null }) =>
			api<{ inWatchlist: boolean; watchedAt: string | null; rating: number | null }>(`/me/titles/${type}/${id}`, {
				method: "PUT",
				json: body,
			}),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["title", type, id] });
			qc.invalidateQueries({ queryKey: ["lists"] });
			qc.invalidateQueries({ queryKey: ["recs"] });
		},
	});
}

export type { UserTitleState };

export const img = (path: string | null | undefined, size: "w92" | "w185" | "w342" | "w500" | "w780" | "w1280" | "original" = "w342") =>
	path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
