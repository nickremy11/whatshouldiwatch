import { useState } from "react";
import type { Episode } from "../../shared/types";

/** Per-episode TMDB rating bars for one season (single series, so no legend). */
export function EpisodeChart({ episodes }: { episodes: Episode[] }) {
	const rated = episodes.filter((e) => e.tmdbRating !== null);
	const [hover, setHover] = useState<number | null>(null);
	if (rated.length < 2) return null;

	const ratings = rated.map((e) => e.tmdbRating!);
	const lo = Math.max(0, Math.floor(Math.min(...ratings)) - 1);
	const hi = 10;
	const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
	const H = 120;
	const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
	const active = hover !== null ? rated[hover] : null;

	return (
		<figure className="rounded-xl border border-line bg-panel p-4">
			<figcaption className="mb-3 flex items-baseline justify-between text-sm">
				<span className="font-medium">Episode ratings (TMDB)</span>
				<span className="text-xs text-muted tabular-nums">
					{active ? `E${active.episodeNumber} · ${active.name} · ${active.tmdbRating!.toFixed(1)}` : `Season avg ${avg.toFixed(1)}`}
				</span>
			</figcaption>
			<div className="flex gap-2">
				<div className="flex flex-col justify-between text-[10px] text-muted tabular-nums" style={{ height: H }}>
					<span>{hi}</span>
					<span>{lo}</span>
				</div>
				<svg
					viewBox={`0 0 ${rated.length * 10} ${H}`}
					preserveAspectRatio="none"
					className="h-[120px] flex-1"
					role="img"
					aria-label={`Episode ratings, season average ${avg.toFixed(1)} out of 10`}
					onMouseLeave={() => setHover(null)}
				>
					<line x1="0" x2={rated.length * 10} y1={y(avg)} y2={y(avg)} stroke="var(--color-muted)" strokeDasharray="3 3" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
					{rated.map((e, i) => (
						<g key={e.episodeNumber} onMouseEnter={() => setHover(i)}>
							{/* Full-height hit target, wider than the bar */}
							<rect x={i * 10} y={0} width={10} height={H} fill="transparent" />
							<rect
								x={i * 10 + 1}
								y={y(e.tmdbRating!)}
								width={8}
								height={H - y(e.tmdbRating!)}
								rx={1.5}
								fill="var(--color-banana)"
								opacity={hover === null || hover === i ? 1 : 0.45}
							>
								<title>{`E${e.episodeNumber} ${e.name}: ${e.tmdbRating!.toFixed(1)}`}</title>
							</rect>
						</g>
					))}
				</svg>
			</div>
		</figure>
	);
}
