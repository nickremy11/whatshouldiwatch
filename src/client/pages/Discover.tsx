import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { type DiscoverSort, type Paged, type PersonCard, type Provider, SORT_LABELS, type TitleCard } from "../../shared/types";
import { api, img, qs, useMe, usePrefs } from "../api";
import { Chip, Empty, ErrorBox, Pagination, Spinner, TitleGrid } from "../components/ui";

type Genre = { id: number; name: string };

const list = (s: string | null) => (s ? s.split(",").filter(Boolean).map(Number) : []);

export function DiscoverPage() {
	const [params, setParams] = useSearchParams();
	const { signedIn } = useMe();
	const prefs = usePrefs();

	const type = (params.get("type") ?? "movie") as "movie" | "tv";
	const genres = list(params.get("genres"));
	const providers = list(params.get("providers"));
	const myServices = params.get("myServices") === "1";
	const sort = (params.get("sort") ?? "popularity") as DiscoverSort;
	const page = Number(params.get("page") ?? 1);

	const update = (patch: Record<string, string | number | null | undefined>, keepPage = false) => {
		const next = new URLSearchParams(params);
		for (const [k, v] of Object.entries(patch)) {
			if (v === null || v === undefined || v === "") next.delete(k);
			else next.set(k, String(v));
		}
		if (!keepPage) next.delete("page");
		setParams(next, { replace: !keepPage });
	};
	const toggleIn = (key: "genres" | "providers", current: number[], id: number) =>
		update({ [key]: (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]).join(",") || null });

	const genreQ = useQuery({ queryKey: ["genres"], queryFn: () => api<{ movie: Genre[]; tv: Genre[] }>("/genres"), staleTime: Infinity });
	const providerQ = useQuery({
		queryKey: ["providers", prefs.region],
		queryFn: () => api<(Provider & { priority: number })[]>(`/providers${qs({ region: prefs.region })}`),
		staleTime: Infinity,
	});

	// Signed-out "my services" uses the services saved in this browser.
	const anonServiceFilter =
		myServices && !signedIn ? (providers.length ? providers.filter((p) => prefs.services.includes(p)) : prefs.services) : null;
	const effectiveProviders = anonServiceFilter ?? providers;

	const queryString = qs({
		type,
		genres: genres.join(","),
		genreMode: params.get("genreMode") ?? undefined,
		person: params.get("person") ?? undefined,
		providers: myServices && !signedIn ? effectiveProviders.join(",") || "-1" : providers.join(","),
		myServices: myServices && signedIn ? 1 : undefined,
		yearFrom: params.get("yearFrom") ?? undefined,
		yearTo: params.get("yearTo") ?? undefined,
		minTmdb: params.get("minTmdb") ?? undefined,
		minBlend: params.get("minBlend") ?? undefined,
		hideWatched: params.get("hideWatched") ?? undefined,
		sort,
		page,
		region: prefs.region,
	});
	const results = useQuery({
		queryKey: ["discover", queryString],
		queryFn: () => api<Paged<TitleCard>>(`/discover${queryString}`),
		placeholderData: keepPreviousData,
	});

	const [showAllProviders, setShowAllProviders] = useState(false);
	const visibleProviders = (providerQ.data ?? []).filter(
		(p, i) => showAllProviders || i < 14 || providers.includes(p.id) || prefs.services.includes(p.id),
	);

	return (
		<div className="grid gap-6 lg:grid-cols-[300px_1fr]">
			<aside className="space-y-5 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pr-2">
				<div className="flex rounded-lg border border-line bg-panel p-1">
					{(["movie", "tv"] as const).map((t) => (
						<button
							key={t}
							type="button"
							onClick={() => update({ type: t, genres: null })}
							className={`flex-1 rounded-md py-1.5 text-sm font-medium ${type === t ? "bg-banana text-amber-950" : "text-muted"}`}
						>
							{t === "movie" ? "Movies" : "TV Shows"}
						</button>
					))}
				</div>

				<div>
					<label className="label" htmlFor="sort">
						Sort by
					</label>
					<select id="sort" className="input" value={sort} onChange={(e) => update({ sort: e.target.value })}>
						{Object.entries(SORT_LABELS).map(([k, v]) => (
							<option key={k} value={k}>
								{v}
							</option>
						))}
					</select>
				</div>

				<div>
					<div className="mb-1.5 flex items-center justify-between">
						<span className="label mb-0">Genres</span>
						{genres.length > 1 ? (
							<button
								type="button"
								className="text-xs text-banana"
								onClick={() => update({ genreMode: params.get("genreMode") === "any" ? null : "any" })}
							>
								Match {params.get("genreMode") === "any" ? "any" : "all"}
							</button>
						) : null}
					</div>
					<div className="flex flex-wrap gap-1.5">
						{(genreQ.data?.[type] ?? []).map((g) => (
							<Chip key={g.id} active={genres.includes(g.id)} onClick={() => toggleIn("genres", genres, g.id)}>
								{g.name}
							</Chip>
						))}
					</div>
				</div>

				<PersonFilter
					personId={params.get("person")}
					personName={params.get("personName")}
					onChange={(p) => update({ person: p?.id ?? null, personName: p?.name ?? null })}
				/>

				<div>
					<div className="mb-1.5 flex items-center justify-between">
						<span className="label mb-0">Streaming on ({prefs.region})</span>
						<label className="flex items-center gap-1.5 text-xs">
							<input type="checkbox" checked={myServices} onChange={(e) => update({ myServices: e.target.checked ? 1 : null })} />
							My services only
						</label>
					</div>
					{myServices && !prefs.services.length ? (
						<p className="mb-2 text-xs text-banana">Pick your services in Settings first.</p>
					) : null}
					<div className="flex flex-wrap gap-1.5">
						{visibleProviders.map((p) => (
							<button
								key={p.id}
								type="button"
								title={p.name}
								aria-pressed={providers.includes(p.id)}
								onClick={() => toggleIn("providers", providers, p.id)}
								className={`rounded-lg border-2 transition ${providers.includes(p.id) ? "border-banana" : "border-transparent opacity-70 hover:opacity-100"}`}
							>
								{p.logoPath ? <img src={img(p.logoPath, "w92")!} alt={p.name} className="size-9 rounded-md" /> : <span className="px-2 text-xs">{p.name}</span>}
							</button>
						))}
					</div>
					{(providerQ.data?.length ?? 0) > 14 ? (
						<button type="button" className="mt-1 text-xs text-banana" onClick={() => setShowAllProviders(!showAllProviders)}>
							{showAllProviders ? "Show fewer" : `Show all ${providerQ.data?.length}`}
						</button>
					) : null}
				</div>

				<div className="grid grid-cols-2 gap-3">
					<div>
						<label className="label" htmlFor="yf">
							From year
						</label>
						<input id="yf" className="input" type="number" min={1900} max={2100} defaultValue={params.get("yearFrom") ?? ""} onBlur={(e) => update({ yearFrom: e.target.value })} />
					</div>
					<div>
						<label className="label" htmlFor="yt">
							To year
						</label>
						<input id="yt" className="input" type="number" min={1900} max={2100} defaultValue={params.get("yearTo") ?? ""} onBlur={(e) => update({ yearTo: e.target.value })} />
					</div>
				</div>

				<RangeFilter label="Min TMDB rating" max={10} step={0.5} value={params.get("minTmdb")} onChange={(v) => update({ minTmdb: v })} format={(v) => `${v}+`} />
				<RangeFilter label="Min blended score" max={100} step={5} value={params.get("minBlend")} onChange={(v) => update({ minBlend: v })} format={(v) => `${v}+`} />

				{signedIn ? (
					<label className="flex items-center gap-2 text-sm">
						<input type="checkbox" checked={params.get("hideWatched") === "1"} onChange={(e) => update({ hideWatched: e.target.checked ? 1 : null })} />
						Hide titles I've watched
					</label>
				) : null}

				<button type="button" className="btn w-full" onClick={() => setParams({ type })}>
					Reset filters
				</button>
			</aside>

			<section className="min-w-0 space-y-4">
				<div className="flex items-baseline justify-between gap-4">
					<h1 className="text-2xl font-bold">Discover {type === "movie" ? "movies" : "TV shows"}</h1>
					{results.data ? <span className="text-sm text-muted">{results.data.totalResults.toLocaleString()} matches</span> : null}
				</div>
				{results.data?.note ? <p className="text-xs text-muted">{results.data.note}</p> : null}
				{results.isLoading ? <Spinner label="Loading titles and ratings" /> : null}
				{results.error ? <ErrorBox error={results.error} /> : null}
				{results.data ? (
					<div className={results.isPlaceholderData ? "opacity-50 transition" : ""}>
						{results.data.results.length ? <TitleGrid items={results.data.results} /> : <Empty>Nothing matches these filters.</Empty>}
					</div>
				) : null}
				{results.data ? <Pagination page={results.data.page} totalPages={results.data.totalPages} onPage={(p) => update({ page: p }, true)} /> : null}
			</section>
		</div>
	);
}

function RangeFilter({
	label,
	max,
	step,
	value,
	onChange,
	format,
}: {
	label: string;
	max: number;
	step: number;
	value: string | null;
	onChange: (v: string | null) => void;
	format: (v: number) => string;
}) {
	const [local, setLocal] = useState(Number(value ?? 0));
	return (
		<div>
			<div className="mb-1.5 flex justify-between">
				<span className="label mb-0">{label}</span>
				<span className="text-xs text-banana">{local ? format(local) : "Any"}</span>
			</div>
			<input
				type="range"
				className="w-full accent-[var(--color-banana)]"
				min={0}
				max={max}
				step={step}
				value={local}
				onChange={(e) => setLocal(Number(e.target.value))}
				onPointerUp={() => onChange(local ? String(local) : null)}
				onKeyUp={() => onChange(local ? String(local) : null)}
				aria-label={label}
			/>
		</div>
	);
}

function PersonFilter({
	personId,
	personName,
	onChange,
}: {
	personId: string | null;
	personName: string | null;
	onChange: (p: { id: number; name: string } | null) => void;
}) {
	const [q, setQ] = useState("");
	const people = useQuery({
		queryKey: ["people", q],
		queryFn: () => api<PersonCard[]>(`/people/search${qs({ q })}`),
		enabled: q.trim().length >= 2,
	});
	return (
		<div className="relative">
			<span className="label">Actor</span>
			{personId ? (
				<div className="flex items-center justify-between rounded-lg border border-banana bg-panel px-3 py-2 text-sm">
					{personName ?? `Person #${personId}`}
					<button type="button" className="text-muted hover:text-white" onClick={() => onChange(null)} aria-label="Clear actor">
						✕
					</button>
				</div>
			) : (
				<>
					<input className="input" placeholder="e.g. Tom Cruise" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Actor" />
					{q.trim().length >= 2 && people.data?.length ? (
						<ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-line bg-panel-2 shadow-xl">
							{people.data.map((p) => (
								<li key={p.id}>
									<button
										type="button"
										className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-panel"
										onClick={() => {
											onChange({ id: p.id, name: p.name });
											setQ("");
										}}
									>
										{p.profilePath ? <img src={img(p.profilePath, "w92")!} alt="" className="size-7 rounded-full object-cover" /> : <span className="size-7" />}
										<span>
											<span className="block">{p.name}</span>
											<span className="block truncate text-xs text-muted">{p.knownFor}</span>
										</span>
									</button>
								</li>
							))}
						</ul>
					) : null}
				</>
			)}
		</div>
	);
}
