import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, NavLink, Outlet, ScrollRestoration, useLocation, useNavigate } from "react-router";
import { useConfig } from "../api";

const NAV = [
	{ to: "/", label: "Home", end: true },
	{ to: "/discover", label: "Discover" },
	{ to: "/picks", label: "AI Picks" },
	{ to: "/lists", label: "My Lists", auth: true },
];

export function Layout() {
	const config = useConfig();
	const me = config.data?.me;
	const navigate = useNavigate();
	const location = useLocation();
	const qc = useQueryClient();
	const [q, setQ] = useState("");

	const onSearch = (e: FormEvent) => {
		e.preventDefault();
		if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
	};

	const logout = async () => {
		await fetch("/auth/logout", { method: "POST" }).catch(() => undefined);
		await qc.invalidateQueries();
		navigate("/");
	};

	return (
		<div className="flex min-h-dvh flex-col">
			<header className="sticky top-0 z-30 border-b border-line bg-ink/90 backdrop-blur">
				<div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
					<Link to="/" className="flex items-center gap-2 font-bold tracking-tight">
						<img src="/favicon.svg" alt="" className="size-7" />
						<span>
							What Should I <span className="text-banana">Watch</span>
						</span>
					</Link>
					<nav className="order-3 flex w-full gap-1 overflow-x-auto text-sm sm:order-none sm:w-auto">
						{NAV.filter((n) => !n.auth || me).map((n) => (
							<NavLink
								key={n.to}
								to={n.to}
								end={n.end}
								className={({ isActive }) => `rounded-md px-3 py-1.5 whitespace-nowrap ${isActive ? "bg-panel-2 text-banana" : "text-muted hover:text-white"}`}
							>
								{n.label}
							</NavLink>
						))}
					</nav>
					<form onSubmit={onSearch} className="ml-auto flex min-w-0 flex-1 sm:max-w-xs">
						<input
							className="input"
							type="search"
							placeholder="Search titles or people…"
							value={q}
							onChange={(e) => setQ(e.target.value)}
							aria-label="Search"
						/>
					</form>
					{me ? (
						<div className="flex items-center gap-2">
							<Link to="/settings" title="Settings" className="flex items-center gap-2">
								{me.avatarUrl ? (
									<img src={me.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-8 rounded-full" />
								) : (
									<span className="flex size-8 items-center justify-center rounded-full bg-panel-2 text-sm">{(me.name ?? me.email)[0]}</span>
								)}
							</Link>
							<button type="button" onClick={logout} className="text-xs text-muted hover:text-white">
								Sign out
							</button>
						</div>
					) : config.isLoading ? null : (
						<div className="flex items-center gap-2">
							<Link to="/settings" className="text-xs text-muted hover:text-white">
								Settings
							</Link>
							<Link to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`} className="btn btn-primary">
								Sign in
							</Link>
						</div>
					)}
				</div>
			</header>

			<main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
				<Outlet />
			</main>

			<footer className="border-t border-line">
				<div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
					<div className="flex items-center gap-3">
						{/* Official logo from themoviedb.org/about/logos-attribution */}
						<a href="https://www.themoviedb.org" target="_blank" rel="noreferrer" className="shrink-0">
							<img src="/tmdb-logo.svg" alt="TMDB" className="h-3" />
						</a>
						<span>This product uses the TMDB API but is not endorsed or certified by TMDB.</span>
					</div>
					<div>
						Streaming data by{" "}
						<a className="underline" href="https://www.justwatch.com" target="_blank" rel="noreferrer">
							JustWatch
						</a>{" "}
						· Ratings via{" "}
						<a className="underline" href="https://mdblist.com" target="_blank" rel="noreferrer">
							MDBList
						</a>
					</div>
				</div>
			</footer>
			<ScrollRestoration />
		</div>
	);
}
