import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AdminAiRequest, AdminUser, Role } from "../../shared/types";
import { api, qs, useConfig } from "../api";
import { Empty, ErrorBox, Spinner } from "../components/ui";

/** D1 datetimes are UTC "YYYY-MM-DD HH:MM:SS". */
const when = (s: string | null) => (s ? new Date(`${s.replace(" ", "T")}Z`).toLocaleString() : "—");

const ROLE_STYLE: Record<Role, string> = {
	admin: "bg-banana/15 text-banana",
	user: "bg-panel-2 text-gray-300",
	blocked: "bg-red-500/15 text-red-300",
};

export function AdminPage() {
	const config = useConfig();
	const me = config.data?.me;
	const qc = useQueryClient();
	const [aiUser, setAiUser] = useState<AdminUser | null>(null);

	const users = useQuery({ queryKey: ["admin", "users"], queryFn: () => api<AdminUser[]>("/admin/users"), enabled: me?.role === "admin" });
	const ai = useQuery({
		queryKey: ["admin", "ai", aiUser?.id],
		queryFn: () => api<AdminAiRequest[]>(`/admin/ai-requests${qs({ userId: aiUser?.id })}`),
		enabled: me?.role === "admin",
	});
	const setRole = useMutation({
		mutationFn: ({ id, role }: { id: string; role: Role }) => api(`/admin/users/${id}/role`, { method: "PUT", json: { role } }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
	});

	if (config.isLoading) return <Spinner />;
	if (me?.role !== "admin") return <Empty>Admins only.</Empty>;

	const list = users.data ?? [];
	const totals = {
		users: list.filter((u) => u.role !== "blocked").length,
		active7d: list.filter((u) => u.lastSeenAt && Date.now() - Date.parse(`${u.lastSeenAt.replace(" ", "T")}Z`) < 7 * 86400_000).length,
		ai7d: list.reduce((n, u) => n + u.aiRequests7d, 0),
	};

	return (
		<div className="space-y-8">
			<h1 className="text-2xl font-bold">Admin</h1>

			<div className="grid grid-cols-3 gap-3 sm:max-w-xl">
				{[
					["Accounts", totals.users],
					["Active (7 days)", totals.active7d],
					["AI requests (7 days)", totals.ai7d],
				].map(([label, value]) => (
					<div key={label} className="rounded-xl border border-line bg-panel p-4">
						<div className="text-2xl font-bold tabular-nums">{value}</div>
						<div className="text-xs text-muted">{label}</div>
					</div>
				))}
			</div>

			<section className="space-y-3">
				<h2 className="text-lg font-semibold">Accounts</h2>
				{users.isLoading ? <Spinner /> : null}
				{users.error ? <ErrorBox error={users.error} /> : null}
				{setRole.error ? <ErrorBox error={setRole.error} /> : null}
				<div className="overflow-x-auto rounded-xl border border-line">
					<table className="w-full min-w-[820px] text-sm">
						<thead className="bg-panel-2 text-left text-xs tracking-wide text-muted uppercase">
							<tr>
								<th className="px-3 py-2">User</th>
								<th className="px-3 py-2">Role</th>
								<th className="px-3 py-2">Joined</th>
								<th className="px-3 py-2">Last seen</th>
								<th className="px-3 py-2 text-right">Watched</th>
								<th className="px-3 py-2 text-right">Rated</th>
								<th className="px-3 py-2 text-right">Watchlist</th>
								<th className="px-3 py-2 text-right">AI (7d / all)</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-line">
							{list.map((u) => (
								<tr key={u.id} className="bg-panel">
									<td className="px-3 py-2">
										<div className="flex items-center gap-2">
											{u.avatarUrl ? <img src={u.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-7 rounded-full" /> : null}
											<div className="min-w-0">
												<div className="truncate font-medium">{u.name ?? "—"}</div>
												<div className="truncate text-xs text-muted">{u.email}</div>
											</div>
										</div>
									</td>
									<td className="px-3 py-2">
										{u.id === me.id ? (
											<span className={`rounded px-2 py-0.5 text-xs ${ROLE_STYLE[u.role]}`}>{u.role} (you)</span>
										) : (
											<select
												className={`rounded border-0 px-2 py-0.5 text-xs ${ROLE_STYLE[u.role]}`}
												value={u.role}
												disabled={setRole.isPending}
												onChange={(e) => {
													const role = e.target.value as Role;
													if (role !== "blocked" || confirm(`Block ${u.email}? They'll be signed out and can't sign back in.`)) {
														setRole.mutate({ id: u.id, role });
													}
												}}
												aria-label={`Role for ${u.email}`}
											>
												<option value="user">user</option>
												<option value="admin">admin</option>
												<option value="blocked">blocked</option>
											</select>
										)}
									</td>
									<td className="px-3 py-2 text-xs text-muted">{when(u.createdAt)}</td>
									<td className="px-3 py-2 text-xs text-muted">{when(u.lastSeenAt)}</td>
									<td className="px-3 py-2 text-right tabular-nums">{u.watched}</td>
									<td className="px-3 py-2 text-right tabular-nums">{u.rated}</td>
									<td className="px-3 py-2 text-right tabular-nums">{u.watchlist}</td>
									<td className="px-3 py-2 text-right tabular-nums">
										<button type="button" className="text-banana hover:underline" onClick={() => setAiUser(u)} disabled={!u.aiRequests}>
											{u.aiRequests7d} / {u.aiRequests}
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>

			<section className="space-y-3">
				<div className="flex items-center gap-3">
					<h2 className="text-lg font-semibold">AI requests {aiUser ? `· ${aiUser.email}` : "· everyone"}</h2>
					{aiUser ? (
						<button type="button" className="text-xs text-banana" onClick={() => setAiUser(null)}>
							Show all
						</button>
					) : null}
				</div>
				<p className="text-xs text-muted">
					The latest 200. The same requests appear in Cloudflare's AI Gateway logs (gateway "whatshouldiwatch"), filterable by the{" "}
					<code>email</code> metadata.
				</p>
				{ai.isLoading ? <Spinner /> : null}
				{ai.data && !ai.data.length ? <Empty>No AI requests yet.</Empty> : null}
				{ai.data?.length ? (
					<ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
						{ai.data.map((r) => (
							<li key={r.id} className="bg-panel px-3 py-2 text-sm">
								<div className="flex flex-wrap justify-between gap-x-3 text-xs text-muted">
									<span>{r.email}</span>
									<span>
										{when(r.createdAt)} · {r.mediaType} · {r.picks} picks
									</span>
								</div>
								<div className="mt-0.5">{r.prompt}</div>
							</li>
						))}
					</ul>
				) : null}
			</section>
		</div>
	);
}
