import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { TitleCard } from "../../shared/types";
import { api, qs, useMe, usePrefs } from "../api";
import { ErrorBox, Spinner, TitleRow } from "../components/ui";

interface RecsResponse {
	personalized: boolean;
	sections: { id: string; title: string; subtitle?: string; items: TitleCard[] }[];
}

export function HomePage() {
	const { signedIn } = useMe();
	const { region } = usePrefs();
	const recs = useQuery({
		queryKey: ["recs", signedIn, region],
		queryFn: () => api<RecsResponse>(`/recommendations${qs({ region })}`),
	});

	return (
		<div className="space-y-10">
			<section className="rounded-2xl border border-line bg-gradient-to-br from-panel-2 to-ink p-6 sm:p-10">
				<h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
					What should I <span className="text-banana">watch</span> tonight?
				</h1>
				<p className="mt-2 max-w-2xl text-muted">
					Search anything, compare ratings from IMDb, Rotten Tomatoes, Metacritic, Letterboxd and more side by side, and filter down to
					what's on your services.
				</p>
				<div className="mt-6 flex flex-wrap gap-3">
					<Link to="/discover" className="btn btn-primary">
						Browse with filters
					</Link>
					<Link to="/picks" className="btn">
						✨ Ask AI for 5 picks
					</Link>
					{!signedIn ? (
						<Link to="/login" className="btn">
							Sign in to track & rate
						</Link>
					) : null}
				</div>
			</section>

			{recs.isLoading ? <Spinner label="Finding things to watch" /> : null}
			{recs.error ? <ErrorBox error={recs.error} /> : null}
			{signedIn && recs.data && !recs.data.personalized ? (
				<p className="rounded-xl border border-line bg-panel p-4 text-sm text-muted">
					Rate or mark a few titles as watched and personalized picks will show up here.
				</p>
			) : null}
			{recs.data?.sections.map((s) => (
				<TitleRow key={s.id} title={s.title} subtitle={s.subtitle} items={s.items} />
			))}
		</div>
	);
}
