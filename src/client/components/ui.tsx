import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import type { Rating, Scores, TitleCard } from "../../shared/types";
import { img } from "../api";

export function Spinner({ label = "Loading" }: { label?: string }) {
	return (
		<div className="flex items-center gap-3 py-10 text-muted" role="status">
			<span className="size-5 animate-spin rounded-full border-2 border-line border-t-banana" />
			{label}…
		</div>
	);
}

export function ErrorBox({ error }: { error: unknown }) {
	return (
		<div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
			{error instanceof Error ? error.message : "Something went wrong."}
		</div>
	);
}

export function Empty({ children }: { children: ReactNode }) {
	return <div className="rounded-xl border border-dashed border-line p-8 text-center text-muted">{children}</div>;
}

/** Blended 0-100 score, coloured by band. */
export function ScoreBadge({ scores, size = "sm" }: { scores?: Scores; size?: "sm" | "lg" }) {
	const v = scores?.blended;
	if (v === null || v === undefined) return null;
	const tone = v >= 80 ? "bg-emerald-400 text-emerald-950" : v >= 65 ? "bg-banana text-amber-950" : v >= 50 ? "bg-orange-400 text-orange-950" : "bg-red-400 text-red-950";
	return (
		<span
			title={`Blended score from ${scores?.ratings.length} source${scores?.ratings.length === 1 ? "" : "s"}`}
			className={`inline-flex items-center justify-center rounded-md font-bold tabular-nums ${tone} ${size === "lg" ? "h-12 min-w-12 px-2 text-xl" : "h-6 min-w-7 px-1 text-xs"}`}
		>
			{v}
		</span>
	);
}

export function RatingsList({ ratings }: { ratings: Rating[] }) {
	if (!ratings.length) return <p className="text-sm text-muted">No external ratings yet.</p>;
	return (
		<ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
			{ratings.map((r) => {
				const body = (
					<>
						<span className="text-xs text-muted">{r.label}</span>
						<span className="text-lg font-semibold tabular-nums">{r.display}</span>
						{r.votes ? <span className="text-[11px] text-muted">{r.votes.toLocaleString()} votes</span> : null}
					</>
				);
				return (
					<li key={r.source}>
						{r.url ? (
							<a href={r.url} target="_blank" rel="noreferrer" className="flex flex-col rounded-lg border border-line bg-panel-2 px-3 py-2 hover:border-banana/60">
								{body}
							</a>
						) : (
							<div className="flex flex-col rounded-lg border border-line bg-panel-2 px-3 py-2">{body}</div>
						)}
					</li>
				);
			})}
		</ul>
	);
}

export function PosterImage({ path, alt, className = "" }: { path: string | null; alt: string; className?: string }) {
	const src = img(path, "w342");
	return src ? (
		<img src={src} alt={alt} loading="lazy" className={`aspect-[2/3] w-full rounded-lg bg-panel-2 object-cover ${className}`} />
	) : (
		<div className={`flex aspect-[2/3] w-full items-center justify-center rounded-lg bg-panel-2 p-2 text-center text-xs text-muted ${className}`}>{alt}</div>
	);
}

export function PosterCard({ card, extra }: { card: TitleCard; extra?: ReactNode }) {
	const u = card.user;
	return (
		<Link to={`/title/${card.mediaType}/${card.id}`} className="group block min-w-0">
			<div className="relative">
				<PosterImage path={card.posterPath} alt={card.title} className="transition group-hover:ring-2 group-hover:ring-banana" />
				<div className="absolute top-1.5 left-1.5 flex gap-1">
					<ScoreBadge scores={card.scores} />
				</div>
				<div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-1 text-[10px] font-semibold">
					{u?.watchedAt ? <span className="rounded bg-emerald-500/90 px-1.5 py-0.5 text-emerald-950">Watched</span> : null}
					{u?.inWatchlist ? <span className="rounded bg-sky-400/90 px-1.5 py-0.5 text-sky-950">Watchlist</span> : null}
					{u?.rating ? <span className="rounded bg-black/70 px-1.5 py-0.5 text-banana">{u.rating}★</span> : null}
				</div>
			</div>
			<div className="mt-2 truncate text-sm font-medium group-hover:text-banana">{card.title}</div>
			<div className="text-xs text-muted">
				{card.year ?? "—"} · {card.mediaType === "tv" ? "TV" : "Movie"}
				{card.tmdbRating ? ` · TMDB ${card.tmdbRating.toFixed(1)}` : ""}
			</div>
			{card.reason ? <div className="mt-1 line-clamp-2 text-xs text-banana/80">{card.reason}</div> : null}
			{extra}
		</Link>
	);
}

export function TitleGrid({ items }: { items: TitleCard[] }) {
	return (
		<div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
			{items.map((c) => (
				<PosterCard key={`${c.mediaType}-${c.id}`} card={c} />
			))}
		</div>
	);
}

export function TitleRow({ title, subtitle, items }: { title: string; subtitle?: string; items: TitleCard[] }) {
	if (!items.length) return null;
	return (
		<section className="space-y-3">
			<div>
				<h2 className="text-lg font-semibold">{title}</h2>
				{subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
			</div>
			<div className="scrollbar-none -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2">
				{items.map((c) => (
					<div key={`${c.mediaType}-${c.id}`} className="w-32 shrink-0 snap-start sm:w-36">
						<PosterCard card={c} />
					</div>
				))}
			</div>
		</section>
	);
}

/** Half-star rating input. Clicking the current value clears it. */
export function StarInput({ value, onChange, disabled }: { value: number | null; onChange: (v: number | null) => void; disabled?: boolean }) {
	const [hover, setHover] = useState<number | null>(null);
	const shown = hover ?? value ?? 0;
	return (
		<div className="flex items-center gap-2">
			<div className="flex" onMouseLeave={() => setHover(null)} role="radiogroup" aria-label="Your rating">
				{[1, 2, 3, 4, 5].map((star) => (
					<div key={star} className="relative size-8">
						<span className="pointer-events-none absolute inset-0 flex items-center justify-center text-3xl leading-none text-line">★</span>
						<span
							className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden text-3xl leading-none text-banana"
							style={{ clipPath: `inset(0 ${shown >= star ? 0 : shown >= star - 0.5 ? 50 : 100}% 0 0)` }}
						>
							★
						</span>
						{[star - 0.5, star].map((v, i) => (
							<button
								key={v}
								type="button"
								disabled={disabled}
								aria-label={`${v} stars`}
								aria-checked={value === v}
								role="radio"
								onMouseEnter={() => setHover(v)}
								onClick={() => onChange(value === v ? null : v)}
								className={`absolute top-0 h-full w-1/2 cursor-pointer disabled:cursor-not-allowed ${i === 0 ? "left-0" : "right-0"}`}
							/>
						))}
					</div>
				))}
			</div>
			<span className="w-10 text-sm text-muted tabular-nums">{shown ? `${shown}★` : ""}</span>
		</div>
	);
}

export function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
	if (totalPages <= 1) return null;
	return (
		<div className="flex items-center justify-center gap-3 pt-4">
			<button type="button" className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>
				← Prev
			</button>
			<span className="text-sm text-muted">
				Page {page} of {totalPages}
			</span>
			<button type="button" className="btn" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
				Next →
			</button>
		</div>
	);
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={`rounded-full border px-3 py-1 text-sm transition ${active ? "border-banana bg-banana text-amber-950" : "border-line bg-panel hover:border-muted"}`}
		>
			{children}
		</button>
	);
}
