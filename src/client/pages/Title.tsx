import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import type { Episode, MediaType, Provider, TitleDetail } from "../../shared/types";
import { api, img, qs, useMe, usePrefs, useUpdateTitle } from "../api";
import { EpisodeChart } from "../components/EpisodeChart";
import { ErrorBox, RatingsList, ScoreBadge, Spinner, StarInput, TitleRow } from "../components/ui";

export function TitlePage() {
	const params = useParams();
	const type = params.type as MediaType;
	const id = Number(params.id);
	const { region } = usePrefs();
	const detail = useQuery({
		queryKey: ["title", type, id, region],
		queryFn: () => api<TitleDetail>(`/title/${type}/${id}${qs({ region })}`),
	});

	if (detail.isLoading) return <Spinner label="Loading title" />;
	if (detail.error) return <ErrorBox error={detail.error} />;
	const d = detail.data!;
	const backdrop = img(d.backdropPath, "w1280");

	return (
		<div className="space-y-10">
			<section className="relative -mx-4 -mt-6 overflow-hidden px-4 pt-6 pb-2">
				{backdrop ? (
					<div className="absolute inset-0 -z-10">
						<img src={backdrop} alt="" className="h-full w-full object-cover opacity-20" />
						<div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/80 to-ink/30" />
					</div>
				) : null}
				<div className="grid gap-6 md:grid-cols-[240px_1fr]">
					<div className="mx-auto w-48 md:w-full">
						{img(d.posterPath, "w500") ? (
							<img src={img(d.posterPath, "w500")!} alt={d.title} className="w-full rounded-xl shadow-2xl" />
						) : (
							<div className="flex aspect-[2/3] items-center justify-center rounded-xl bg-panel-2 text-muted">{d.title}</div>
						)}
					</div>
					<div className="min-w-0 space-y-4">
						<div>
							<h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
								{d.title} {d.year ? <span className="font-normal text-muted">({d.year})</span> : null}
							</h1>
							{d.tagline ? <p className="mt-1 text-muted italic">{d.tagline}</p> : null}
						</div>
						<Facts d={d} />
						<div className="flex flex-wrap gap-1.5">
							{d.genres.map((g) => (
								<Link
									key={g.id}
									to={`/discover?type=${type}&genres=${g.id}`}
									className="rounded-full border border-line px-3 py-0.5 text-xs hover:border-banana"
								>
									{g.name}
								</Link>
							))}
						</div>
						<p className="max-w-3xl leading-relaxed text-gray-300">{d.overview || "No overview available."}</p>
						<Actions d={d} />
						{d.trailerKey ? (
							<a className="btn" href={`https://www.youtube.com/watch?v=${d.trailerKey}`} target="_blank" rel="noreferrer">
								▶ Watch trailer
							</a>
						) : null}
					</div>
				</div>
			</section>

			<div className="grid gap-10 lg:grid-cols-[1fr_340px]">
				<div className="min-w-0 space-y-10">
					<section className="space-y-3">
						<div className="flex items-center gap-3">
							<ScoreBadge scores={d.scores} size="lg" />
							<div>
								<h2 className="text-lg font-semibold">Ratings</h2>
								<p className="text-xs text-muted">
									{d.scores?.blended !== null && d.scores?.blended !== undefined
										? `Blended from ${d.scores.ratings.length} sources, each normalized to 0–100.`
										: "Ratings not available yet."}
								</p>
							</div>
						</div>
						<RatingsList ratings={d.scores?.ratings ?? []} />
					</section>

					{type === "tv" && d.seasons?.length ? <Seasons d={d} /> : null}

					{d.cast.length ? (
						<section className="space-y-3">
							<h2 className="text-lg font-semibold">Main cast</h2>
							<div className="scrollbar-none -mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
								{d.cast.map((m) => (
									<Link key={m.id} to={`/person/${m.id}`} className="group w-24 shrink-0">
										{img(m.profilePath, "w185") ? (
											<img src={img(m.profilePath, "w185")!} alt="" loading="lazy" className="aspect-[2/3] w-full rounded-lg object-cover" />
										) : (
											<div className="flex aspect-[2/3] items-center justify-center rounded-lg bg-panel-2 text-2xl text-muted">{m.name[0]}</div>
										)}
										<div className="mt-1 truncate text-xs font-medium group-hover:text-banana">{m.name}</div>
										<div className="truncate text-[11px] text-muted">{m.character}</div>
									</Link>
								))}
							</div>
						</section>
					) : null}

					{d.collection ? (
						<TitleRow title={`Part of ${d.collection.name}`} subtitle={`${d.collection.parts.length} films`} items={d.collection.parts} />
					) : null}
					<TitleRow title="If you like this" items={d.recommendations} />
				</div>

				<aside className="space-y-6">
					<WhereToWatch d={d} />
				</aside>
			</div>
		</div>
	);
}

function Facts({ d }: { d: TitleDetail }) {
	const facts = [
		d.mediaType === "tv" ? "TV Series" : "Movie",
		d.certification,
		d.runtime ? (d.mediaType === "tv" ? `~${d.runtime} min / ep` : `${Math.floor(d.runtime / 60)}h ${d.runtime % 60}m`) : null,
		d.mediaType === "tv" && d.numberOfSeasons ? `${d.numberOfSeasons} season${d.numberOfSeasons === 1 ? "" : "s"} · ${d.numberOfEpisodes} episodes` : null,
		d.status,
	].filter(Boolean);
	const people = d.mediaType === "tv" ? d.creators : d.directors;
	return (
		<div className="space-y-1 text-sm text-muted">
			<div>{facts.join(" · ")}</div>
			{people.length ? (
				<div>
					{d.mediaType === "tv" ? "Created by" : "Directed by"} <span className="text-gray-200">{people.join(", ")}</span>
				</div>
			) : null}
			{d.mediaType === "tv" && d.nextEpisode ? (
				<div>
					Next episode: S{d.nextEpisode.seasonNumber}E{d.nextEpisode.episodeNumber}
					{d.nextEpisode.airDate ? ` on ${new Date(d.nextEpisode.airDate).toLocaleDateString()}` : ""}
				</div>
			) : null}
			{d.imdbId ? (
				<a className="text-xs underline" href={`https://www.imdb.com/title/${d.imdbId}/`} target="_blank" rel="noreferrer">
					View on IMDb
				</a>
			) : null}
		</div>
	);
}

function Actions({ d }: { d: TitleDetail }) {
	const { signedIn } = useMe();
	const location = useLocation();
	const update = useUpdateTitle(d.mediaType, d.id);
	if (!signedIn) {
		return (
			<p className="text-sm text-muted">
				<Link className="text-banana underline" to={`/login?returnTo=${encodeURIComponent(location.pathname)}`}>
					Sign in
				</Link>{" "}
				to add to your watchlist, mark as watched and rate.
			</p>
		);
	}
	const u = update.data
		? { inWatchlist: update.data.inWatchlist, watchedAt: update.data.watchedAt, rating: update.data.rating }
		: (d.user ?? { inWatchlist: false, watchedAt: null, rating: null });
	return (
		<div className="flex flex-wrap items-center gap-3">
			<button type="button" className={`btn ${u.inWatchlist ? "btn-on" : ""}`} disabled={update.isPending} onClick={() => update.mutate({ inWatchlist: !u.inWatchlist })}>
				{u.inWatchlist ? "✓ On watchlist" : "+ Watchlist"}
			</button>
			<button type="button" className={`btn ${u.watchedAt ? "btn-on" : ""}`} disabled={update.isPending} onClick={() => update.mutate({ watched: !u.watchedAt })}>
				{u.watchedAt ? "✓ Watched" : "Mark watched"}
			</button>
			<StarInput value={u.rating} disabled={update.isPending} onChange={(rating) => update.mutate({ rating })} />
			{update.error ? <span className="text-xs text-red-300">{(update.error as Error).message}</span> : null}
		</div>
	);
}

function ProviderList({ label, providers }: { label: string; providers: Provider[] }) {
	if (!providers.length) return null;
	return (
		<div>
			<div className="label">{label}</div>
			<div className="flex flex-wrap gap-2">
				{providers.map((p) => (
					<span key={p.id} title={p.name} className="flex items-center gap-2 rounded-lg border border-line bg-panel-2 py-1 pr-2.5 pl-1 text-xs">
						{p.logoPath ? <img src={img(p.logoPath, "w92")!} alt="" className="size-7 rounded-md" /> : null}
						{p.name}
					</span>
				))}
			</div>
		</div>
	);
}

function WhereToWatch({ d }: { d: TitleDetail }) {
	const { services } = usePrefs();
	const w = d.watch;
	const included = w ? [...w.stream, ...w.free, ...w.ads] : [];
	const onMine = included.filter((p) => services.includes(p.id));
	return (
		<section className="space-y-4 rounded-xl border border-line bg-panel p-4">
			<h2 className="font-semibold">Where to watch {w ? <span className="text-xs font-normal text-muted">({w.region})</span> : null}</h2>
			{!w ? <p className="text-sm text-muted">Not available to stream, rent or buy in your region right now.</p> : null}
			{onMine.length ? (
				<p className="rounded-lg bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">On your services: {onMine.map((p) => p.name).join(", ")}</p>
			) : null}
			{w ? (
				<>
					<ProviderList label="Stream" providers={w.stream} />
					<ProviderList label="Free" providers={[...w.free, ...w.ads]} />
					<ProviderList label="Rent" providers={w.rent} />
					<ProviderList label="Buy" providers={w.buy} />
					{w.link ? (
						<a href={w.link} target="_blank" rel="noreferrer" className="block text-xs text-muted underline">
							Full list on TMDB · data by JustWatch
						</a>
					) : null}
				</>
			) : null}
		</section>
	);
}

function Seasons({ d }: { d: TitleDetail }) {
	const seasons = d.seasons ?? [];
	const firstReal = seasons.find((s) => s.seasonNumber > 0)?.seasonNumber ?? seasons[0]?.seasonNumber ?? 1;
	const [season, setSeason] = useState(firstReal);
	const { signedIn } = useMe();
	const qc = useQueryClient();
	const eps = useQuery({
		queryKey: ["season", d.id, season],
		queryFn: () => api<{ season: number; episodes: Episode[] }>(`/title/tv/${d.id}/season/${season}`),
	});
	const mark = useMutation({
		mutationFn: (body: { season: number; episodes: number[]; watched: boolean }) =>
			api<{ watchedCount: number; airedCount: number; finished: boolean }>(`/me/episodes/${d.id}`, { method: "PUT", json: body }),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["season", d.id] });
			qc.invalidateQueries({ queryKey: ["title", "tv", d.id] });
			qc.invalidateQueries({ queryKey: ["lists"] });
		},
	});
	const watchedTotal = d.watchedEpisodes?.filter((k) => !k.startsWith("0:")).length ?? 0;
	const today = new Date().toISOString().slice(0, 10);
	const aired = (eps.data?.episodes ?? []).filter((e) => e.airDate && e.airDate <= today);
	const allSeasonWatched = aired.length > 0 && aired.every((e) => e.watched);

	return (
		<section className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 className="text-lg font-semibold">Episodes</h2>
				{signedIn && d.numberOfEpisodes ? (
					<div className="flex min-w-48 items-center gap-2 text-xs text-muted">
						<div className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2">
							<div className="h-full bg-emerald-400" style={{ width: `${Math.min(100, (watchedTotal / d.numberOfEpisodes) * 100)}%` }} />
						</div>
						{watchedTotal}/{d.numberOfEpisodes} watched
					</div>
				) : null}
			</div>
			<div className="scrollbar-none flex gap-1.5 overflow-x-auto">
				{seasons.map((s) => (
					<button
						key={s.seasonNumber}
						type="button"
						onClick={() => setSeason(s.seasonNumber)}
						className={`shrink-0 rounded-md px-3 py-1.5 text-sm ${season === s.seasonNumber ? "bg-banana text-amber-950" : "bg-panel text-muted hover:text-white"}`}
					>
						{s.seasonNumber === 0 ? "Specials" : `S${s.seasonNumber}`}
					</button>
				))}
			</div>
			{eps.isLoading ? <Spinner label="Loading episodes" /> : null}
			{eps.error ? <ErrorBox error={eps.error} /> : null}
			{eps.data ? (
				<>
					<EpisodeChart episodes={eps.data.episodes} />
					{signedIn && aired.length ? (
						<button
							type="button"
							className="btn"
							disabled={mark.isPending}
							onClick={() => mark.mutate({ season, episodes: aired.map((e) => e.episodeNumber), watched: !allSeasonWatched })}
						>
							{allSeasonWatched ? "Unmark season" : "Mark season watched"}
						</button>
					) : null}
					<ol className="divide-y divide-line overflow-hidden rounded-xl border border-line">
						{eps.data.episodes.map((e) => {
							const upcoming = !e.airDate || e.airDate > today;
							return (
								<li key={e.episodeNumber} className="flex gap-3 bg-panel p-3">
									{signedIn ? (
										<input
											type="checkbox"
											className="mt-1 size-4 shrink-0 accent-emerald-400"
											checked={e.watched}
											disabled={mark.isPending || upcoming}
											onChange={() => mark.mutate({ season, episodes: [e.episodeNumber], watched: !e.watched })}
											aria-label={`Mark episode ${e.episodeNumber} watched`}
										/>
									) : null}
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-baseline justify-between gap-x-3">
											<span className="font-medium">
												<span className="text-muted">{e.episodeNumber}.</span> {e.name}
											</span>
											<span className="text-xs text-muted tabular-nums">
												{e.tmdbRating ? `★ ${e.tmdbRating.toFixed(1)} · ` : ""}
												{e.airDate ? new Date(`${e.airDate}T00:00:00`).toLocaleDateString() : "TBA"}
												{e.runtime ? ` · ${e.runtime}m` : ""}
											</span>
										</div>
										{e.overview ? <p className="mt-1 line-clamp-2 text-sm text-muted">{e.overview}</p> : null}
									</div>
								</li>
							);
						})}
					</ol>
				</>
			) : null}
		</section>
	);
}
