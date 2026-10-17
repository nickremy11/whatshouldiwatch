import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { PersonCard, TitleCard } from "../../shared/types";
import { api, img, qs } from "../api";

interface Suggestions {
	titles: TitleCard[];
	people: PersonCard[];
}

type Item = { key: string; href: string; title: string; sub: string; image: string | null; round?: boolean };

function useDebounced<T>(value: T, ms: number): T {
	const [v, setV] = useState(value);
	useEffect(() => {
		const t = setTimeout(() => setV(value), ms);
		return () => clearTimeout(t);
	}, [value, ms]);
	return v;
}

/** Header search with a live dropdown; Enter with nothing highlighted opens full results. */
export function SearchBox() {
	const navigate = useNavigate();
	const location = useLocation();
	const [q, setQ] = useState("");
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(-1);
	const box = useRef<HTMLDivElement>(null);
	const debounced = useDebounced(q.trim(), 250);

	const suggest = useQuery({
		queryKey: ["suggest", debounced],
		queryFn: () => api<Suggestions>(`/search/suggest${qs({ q: debounced })}`),
		enabled: debounced.length >= 2,
		staleTime: 10 * 60_000,
		placeholderData: keepPreviousData,
	});

	const items: Item[] = [
		...(suggest.data?.titles ?? []).map((t) => ({
			key: `${t.mediaType}-${t.id}`,
			href: `/title/${t.mediaType}/${t.id}`,
			title: t.title,
			sub: `${t.year ?? "—"} · ${t.mediaType === "tv" ? "TV" : "Movie"}${t.tmdbRating ? ` · TMDB ${t.tmdbRating.toFixed(1)}` : ""}`,
			image: img(t.posterPath, "w92"),
		})),
		...(suggest.data?.people ?? []).map((p) => ({
			key: `p-${p.id}`,
			href: `/person/${p.id}`,
			title: p.name,
			sub: p.knownFor || "Person",
			image: img(p.profilePath, "w92"),
			round: true,
		})),
	];

	// Close on navigation and on outside clicks.
	useEffect(() => setOpen(false), [location.pathname, location.search]);
	useEffect(() => {
		const onDown = (e: MouseEvent) => {
			if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, []);
	useEffect(() => setActive(-1), [debounced]);

	const go = (href: string) => {
		setOpen(false);
		setQ("");
		navigate(href);
	};

	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setOpen(true);
			setActive((a) => Math.min(a + 1, items.length));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setActive((a) => Math.max(a - 1, -1));
		} else if (e.key === "Escape") {
			setOpen(false);
		} else if (e.key === "Enter") {
			e.preventDefault();
			if (active >= 0 && active < items.length) go(items[active].href);
			else if (q.trim()) go(`/search?q=${encodeURIComponent(q.trim())}`);
		}
	};

	const showDropdown = open && q.trim().length >= 2 && debounced.length >= 2;

	return (
		<div ref={box} className="relative ml-auto min-w-0 flex-1 sm:max-w-xs">
			<input
				className="input"
				type="search"
				placeholder="Search titles or people…"
				value={q}
				onChange={(e) => {
					setQ(e.target.value);
					setOpen(true);
				}}
				onFocus={() => setOpen(true)}
				onKeyDown={onKeyDown}
				role="combobox"
				aria-expanded={showDropdown}
				aria-controls="search-suggestions"
				aria-activedescendant={active >= 0 ? `sugg-${active}` : undefined}
				aria-label="Search"
			/>
			{showDropdown ? (
				<div
					id="search-suggestions"
					role="listbox"
					className="absolute right-0 z-40 mt-1 w-full min-w-72 overflow-hidden rounded-xl border border-line bg-panel-2 shadow-2xl"
				>
					{suggest.isLoading ? <div className="px-3 py-3 text-sm text-muted">Searching…</div> : null}
					{suggest.data && !items.length ? <div className="px-3 py-3 text-sm text-muted">No matches.</div> : null}
					{items.map((it, i) => (
						<button
							key={it.key}
							id={`sugg-${i}`}
							type="button"
							role="option"
							aria-selected={active === i}
							onMouseEnter={() => setActive(i)}
							onClick={() => go(it.href)}
							className={`flex w-full items-center gap-3 px-3 py-2 text-left ${active === i ? "bg-panel" : ""}`}
						>
							{it.image ? (
								<img src={it.image} alt="" className={`w-8 shrink-0 object-cover ${it.round ? "size-8 rounded-full" : "aspect-[2/3] rounded"}`} />
							) : (
								<span className={`w-8 shrink-0 bg-panel ${it.round ? "size-8 rounded-full" : "aspect-[2/3] rounded"}`} />
							)}
							<span className="min-w-0">
								<span className="block truncate text-sm">{it.title}</span>
								<span className="block truncate text-xs text-muted">{it.sub}</span>
							</span>
						</button>
					))}
					{items.length ? (
						<button
							id={`sugg-${items.length}`}
							type="button"
							role="option"
							aria-selected={active === items.length}
							onMouseEnter={() => setActive(items.length)}
							onClick={() => go(`/search?q=${encodeURIComponent(q.trim())}`)}
							className={`block w-full border-t border-line px-3 py-2 text-left text-sm text-banana ${active === items.length ? "bg-panel" : ""}`}
						>
							See all results for “{q.trim()}” with ratings →
						</button>
					) : null}
				</div>
			) : null}
		</div>
	);
}
