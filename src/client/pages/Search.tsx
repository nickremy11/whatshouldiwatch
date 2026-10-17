import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import type { PersonCard, TitleCard } from "../../shared/types";
import { api, img, qs, usePrefs } from "../api";
import { Empty, ErrorBox, Pagination, Spinner, TitleGrid } from "../components/ui";

interface SearchResponse {
	titles: TitleCard[];
	people: PersonCard[];
	page: number;
	totalPages: number;
}

export function SearchPage() {
	const [params, setParams] = useSearchParams();
	const q = params.get("q") ?? "";
	const page = Number(params.get("page") ?? 1);
	const { region } = usePrefs();
	const search = useQuery({
		queryKey: ["search", q, page],
		queryFn: () => api<SearchResponse>(`/search${qs({ q, page, region })}`),
		enabled: Boolean(q),
	});

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">
				Results for <span className="text-banana">“{q}”</span>
			</h1>
			{search.isLoading ? <Spinner label="Searching" /> : null}
			{search.error ? <ErrorBox error={search.error} /> : null}
			{search.data?.people.length ? (
				<section className="space-y-3">
					<h2 className="text-sm font-semibold tracking-wide text-muted uppercase">People</h2>
					<div className="flex flex-wrap gap-3">
						{search.data.people.map((p) => (
							<Link key={p.id} to={`/person/${p.id}`} className="flex items-center gap-3 rounded-xl border border-line bg-panel p-2 pr-4 hover:border-banana/60">
								{img(p.profilePath, "w92") ? (
									<img src={img(p.profilePath, "w92")!} alt="" className="size-12 rounded-full object-cover" />
								) : (
									<span className="flex size-12 items-center justify-center rounded-full bg-panel-2">{p.name[0]}</span>
								)}
								<span>
									<span className="block text-sm font-medium">{p.name}</span>
									<span className="block max-w-56 truncate text-xs text-muted">{p.knownFor}</span>
								</span>
							</Link>
						))}
					</div>
				</section>
			) : null}
			{search.data ? (
				search.data.titles.length ? (
					<TitleGrid items={search.data.titles} />
				) : (
					<Empty>No movies or shows matched.</Empty>
				)
			) : null}
			{search.data ? (
				<Pagination
					page={search.data.page}
					totalPages={search.data.totalPages}
					onPage={(p) => setParams({ q, page: String(p) })}
				/>
			) : null}
		</div>
	);
}
