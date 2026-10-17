import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import type { AiPicksResponse } from "../../shared/types";
import { api, useMe } from "../api";
import { ErrorBox, PosterImage, ScoreBadge, Spinner } from "../components/ui";

const EXAMPLES = [
	"A twisty sci-fi movie that doesn't need a big budget to blow my mind",
	"Cozy, funny TV show to watch with my partner, 30-min episodes",
	"Something like Knives Out but darker",
	"A great war movie that isn't just battle scenes",
];

export function PicksPage() {
	const { signedIn } = useMe();
	const [prompt, setPrompt] = useState("");
	const [mediaType, setMediaType] = useState<"any" | "movie" | "tv">("any");
	const picks = useMutation({
		mutationFn: (body: { prompt: string; mediaType: string }) => api<AiPicksResponse>("/recommendations/ai", { method: "POST", json: body }),
	});

	const submit = (e?: FormEvent, text = prompt) => {
		e?.preventDefault();
		if (text.trim().length >= 3) picks.mutate({ prompt: text.trim(), mediaType });
	};

	return (
		<div className="mx-auto max-w-4xl space-y-8">
			<div>
				<h1 className="text-3xl font-bold tracking-tight">
					✨ AI <span className="text-banana">Picks</span>
				</h1>
				<p className="mt-2 text-muted">
					Describe what you're in the mood for and get five picks, each with a match score.
					{signedIn ? " Your ratings and watch history are used, and anything you've seen is skipped." : " Sign in to have your ratings shape the picks."}
				</p>
			</div>

			<form onSubmit={submit} className="space-y-3">
				<textarea
					className="input min-h-24 resize-y text-base"
					placeholder="e.g. a slow-burn mystery series set somewhere cold"
					maxLength={500}
					value={prompt}
					onChange={(e) => setPrompt(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
					}}
					aria-label="What are you in the mood for?"
				/>
				<div className="flex flex-wrap items-center gap-3">
					<div className="flex rounded-lg border border-line bg-panel p-1 text-sm">
						{(["any", "movie", "tv"] as const).map((t) => (
							<button
								key={t}
								type="button"
								onClick={() => setMediaType(t)}
								className={`rounded-md px-3 py-1 ${mediaType === t ? "bg-banana text-amber-950" : "text-muted"}`}
							>
								{t === "any" ? "Anything" : t === "movie" ? "Movies" : "TV"}
							</button>
						))}
					</div>
					<button type="submit" className="btn btn-primary ml-auto" disabled={picks.isPending || prompt.trim().length < 3}>
						{picks.isPending ? "Thinking…" : "Get 5 picks"}
					</button>
				</div>
				<div className="flex flex-wrap gap-2">
					{EXAMPLES.map((ex) => (
						<button
							key={ex}
							type="button"
							className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:border-banana hover:text-white"
							onClick={() => {
								setPrompt(ex);
								submit(undefined, ex);
							}}
						>
							{ex}
						</button>
					))}
				</div>
			</form>

			{picks.isPending ? <Spinner label="Asking the model" /> : null}
			{picks.error ? <ErrorBox error={picks.error} /> : null}
			{picks.data ? (
				<section className="space-y-4">
					{picks.data.picks.length === 0 ? <p className="text-muted">The model's picks didn't match anything on TMDB. Try rephrasing.</p> : null}
					{picks.data.picks.map((p, i) => (
						<Link
							key={`${p.mediaType}-${p.id}`}
							to={`/title/${p.mediaType}/${p.id}`}
							className="flex gap-4 rounded-xl border border-line bg-panel p-3 transition hover:border-banana/60"
						>
							<div className="w-20 shrink-0 sm:w-24">
								<PosterImage path={p.posterPath} alt={p.title} />
							</div>
							<div className="min-w-0 flex-1 space-y-2">
								<div className="flex items-start justify-between gap-3">
									<div>
										<div className="text-xs text-muted">#{i + 1}</div>
										<h2 className="font-semibold">
											{p.title} <span className="font-normal text-muted">({p.year ?? "?"})</span>
										</h2>
										<div className="text-xs text-muted">{p.mediaType === "tv" ? "TV series" : "Movie"}</div>
									</div>
									<MatchMeter value={p.match} />
								</div>
								<p className="text-sm text-gray-300">{p.why}</p>
								<div className="flex items-center gap-2 text-xs text-muted">
									<ScoreBadge scores={p.scores} />
									{p.scores?.ratings
										.slice(0, 3)
										.map((r) => `${r.label} ${r.display}`)
										.join(" · ")}
								</div>
							</div>
						</Link>
					))}
					<p className="text-xs text-muted">Model: {picks.data.model} via Cloudflare AI Gateway. Match scores are the model's own estimate.</p>
				</section>
			) : null}
		</div>
	);
}

function MatchMeter({ value }: { value: number }) {
	return (
		<div className="w-24 shrink-0 text-right" title="How well this matches your request">
			<div className="text-lg font-bold text-banana tabular-nums">{value}%</div>
			<div className="text-[10px] tracking-wide text-muted uppercase">match</div>
			<div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2">
				<div className="h-full rounded-full bg-banana" style={{ width: `${value}%` }} />
			</div>
		</div>
	);
}
