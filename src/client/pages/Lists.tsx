import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { TitleCard } from "../../shared/types";
import { api, useMe } from "../api";
import { Empty, ErrorBox, Spinner, TitleGrid } from "../components/ui";

const TABS = [
	{ id: "watchlist", label: "Watchlist" },
	{ id: "watched", label: "Watched" },
	{ id: "rated", label: "Rated" },
] as const;

const SORTS = {
	recent: { label: "Recently updated", fn: () => 0 },
	rating: { label: "My rating", fn: (a: TitleCard, b: TitleCard) => (b.user?.rating ?? 0) - (a.user?.rating ?? 0) },
	blended: { label: "Blended score", fn: (a: TitleCard, b: TitleCard) => (b.scores?.blended ?? -1) - (a.scores?.blended ?? -1) },
	year: { label: "Year", fn: (a: TitleCard, b: TitleCard) => (b.year ?? 0) - (a.year ?? 0) },
	title: { label: "Title", fn: (a: TitleCard, b: TitleCard) => a.title.localeCompare(b.title) },
};

export function ListsPage() {
	const { signedIn, loading } = useMe();
	const [params, setParams] = useSearchParams();
	const tab = (params.get("tab") ?? "watchlist") as (typeof TABS)[number]["id"];
	const [sort, setSort] = useState<keyof typeof SORTS>("recent");
	const [type, setType] = useState<"all" | "movie" | "tv">("all");
	const list = useQuery({
		queryKey: ["lists", tab],
		queryFn: () => api<TitleCard[]>(`/me/titles?list=${tab}`),
		enabled: signedIn,
	});
	const items = useMemo(
		() => (list.data ?? []).filter((c) => type === "all" || c.mediaType === type).sort(SORTS[sort].fn),
		[list.data, sort, type],
	);

	if (loading) return <Spinner />;
	if (!signedIn)
		return (
			<Empty>
				<Link to="/login?returnTo=/lists" className="text-banana underline">
					Sign in
				</Link>{" "}
				to see your lists.
			</Empty>
		);

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center gap-3">
				<h1 className="mr-auto text-2xl font-bold">My lists</h1>
				<select className="input w-auto" value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="Type">
					<option value="all">Movies & TV</option>
					<option value="movie">Movies</option>
					<option value="tv">TV</option>
				</select>
				<select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value as keyof typeof SORTS)} aria-label="Sort">
					{Object.entries(SORTS).map(([k, v]) => (
						<option key={k} value={k}>
							{v.label}
						</option>
					))}
				</select>
			</div>
			<div className="flex gap-1 border-b border-line">
				{TABS.map((t) => (
					<button
						key={t.id}
						type="button"
						onClick={() => setParams({ tab: t.id })}
						className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === t.id ? "border-banana text-banana" : "border-transparent text-muted hover:text-white"}`}
					>
						{t.label}
					</button>
				))}
			</div>
			{list.isLoading ? <Spinner /> : null}
			{list.error ? <ErrorBox error={list.error} /> : null}
			{list.data ? items.length ? <TitleGrid items={items} /> : <Empty>Nothing here yet.</Empty> : null}
		</div>
	);
}
