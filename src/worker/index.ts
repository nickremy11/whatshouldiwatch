import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import type { AppConfig } from "../shared/types";
import { type AppEnv, authRoutes, sameOrigin, sessionMiddleware } from "./auth";
import { getScores } from "./ratings";
import { admin } from "./routes/admin";
import { catalog } from "./routes/catalog";
import { me } from "./routes/me";
import { recs } from "./routes/recs";
import { type TmdbPage, tmdb, toCards } from "./tmdb";

const app = new Hono<AppEnv>();

app.use(sessionMiddleware);
app.route("/auth", authRoutes);

const api = new Hono<AppEnv>();
api.use(sameOrigin);
api.get("/config", (c) => {
	const user = c.get("user");
	return c.json({
		turnstileSiteKey: c.env.TURNSTILE_SITE_KEY,
		me: user
			? {
					id: user.id,
					email: user.email,
					name: user.name,
					avatarUrl: user.avatar_url,
					region: user.region,
					role: user.role,
					services: [],
				}
			: null,
	} satisfies AppConfig);
});
api.route("/", catalog);
api.route("/me", me);
api.route("/recommendations", recs);
api.route("/admin", admin);
api.notFound((c) => c.json({ error: "Not found" }, 404));
app.route("/api", api);

app.onError((err, c) => {
	if (err instanceof ZodError) return c.json({ error: "Invalid request", issues: err.issues }, 400);
	if (err instanceof HTTPException) return c.json({ error: err.message || "Request failed" }, err.status);
	console.error(err);
	return c.json({ error: "Something went wrong" }, 500);
});

export default {
	fetch: app.fetch,

	/** Daily: refresh stale scores for saved titles and pre-warm what's trending. */
	async scheduled(_controller, env, ctx) {
		const { results } = await env.DB.prepare(
			`SELECT DISTINCT ut.media_type AS mediaType, ut.tmdb_id AS id FROM user_titles ut
			 LEFT JOIN scores s ON s.media_type = ut.media_type AND s.tmdb_id = ut.tmdb_id
			 WHERE s.fetched_at IS NULL OR s.fetched_at < datetime('now', '-7 days')
			 LIMIT 400`,
		).all<{ mediaType: "movie" | "tv"; id: number }>();
		const trending = await tmdb<TmdbPage>(env, "/trending/all/day", {}, 3600);
		ctx.waitUntil(getScores(env, [...results, ...toCards(trending.results)]));
	},
} satisfies ExportedHandler<Env>;
