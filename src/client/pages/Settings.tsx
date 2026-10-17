import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Provider } from "../../shared/types";
import { anonPrefs, api, img, qs, useMe, usePrefs } from "../api";
import { Spinner } from "../components/ui";

export function SettingsPage() {
	const { signedIn, me } = useMe();
	const prefs = usePrefs();
	const qc = useQueryClient();
	const [region, setRegion] = useState(prefs.region);
	const [services, setServices] = useState<number[]>(prefs.services);
	const [filter, setFilter] = useState("");

	// Once the account loads, start from its saved values.
	useEffect(() => {
		if (me) {
			setRegion(me.region);
			setServices(me.services);
		}
	}, [me]);

	const regions = useQuery({ queryKey: ["regions"], queryFn: () => api<{ code: string; name: string }[]>("/regions"), staleTime: Infinity });
	const providers = useQuery({
		queryKey: ["providers", region],
		queryFn: () => api<Provider[]>(`/providers${qs({ region })}`),
		staleTime: Infinity,
	});

	const save = useMutation({
		mutationFn: async () => {
			if (signedIn) {
				await api("/me/region", { method: "PUT", json: { region } });
				await api("/me/services", { method: "PUT", json: { providers: services } });
			} else {
				anonPrefs.setRegion(region);
				anonPrefs.setServices(services);
			}
		},
		onSuccess: () => qc.invalidateQueries(),
	});

	const toggle = (id: number) => setServices((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
	const shown = (providers.data ?? []).filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()));

	return (
		<div className="mx-auto max-w-3xl space-y-8">
			<div>
				<h1 className="text-2xl font-bold">Settings</h1>
				<p className="text-sm text-muted">
					{signedIn ? `Signed in as ${me?.email ?? "…"}.` : "You're not signed in, so these are saved in this browser only."}
				</p>
			</div>

			<section className="space-y-2">
				<label className="label" htmlFor="region">
					Region (for streaming availability)
				</label>
				<select id="region" className="input max-w-xs" value={region} onChange={(e) => setRegion(e.target.value)}>
					{(regions.data ?? [{ code: region, name: region }]).map((r) => (
						<option key={r.code} value={r.code}>
							{r.name}
						</option>
					))}
				</select>
			</section>

			<section className="space-y-3">
				<div className="flex flex-wrap items-end justify-between gap-3">
					<div>
						<h2 className="label mb-0">My streaming services</h2>
						<p className="text-xs text-muted">{services.length} selected. Used by the “My services only” filter.</p>
					</div>
					<input className="input max-w-56" placeholder="Filter services…" value={filter} onChange={(e) => setFilter(e.target.value)} />
				</div>
				{providers.isLoading ? <Spinner /> : null}
				<div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
					{shown.map((p) => (
						<button
							key={p.id}
							type="button"
							aria-pressed={services.includes(p.id)}
							onClick={() => toggle(p.id)}
							className={`flex items-center gap-2 rounded-lg border p-2 text-left text-sm transition ${services.includes(p.id) ? "border-banana bg-banana/10" : "border-line bg-panel hover:border-muted"}`}
						>
							{p.logoPath ? <img src={img(p.logoPath, "w92")!} alt="" className="size-8 rounded-md" /> : null}
							<span className="min-w-0 truncate">{p.name}</span>
						</button>
					))}
				</div>
			</section>

			<div className="sticky bottom-4 flex items-center gap-3">
				<button type="button" className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
					{save.isPending ? "Saving…" : "Save settings"}
				</button>
				{save.isSuccess ? <span className="text-sm text-emerald-300">Saved.</span> : null}
				{save.error ? <span className="text-sm text-red-300">{(save.error as Error).message}</span> : null}
			</div>
		</div>
	);
}
