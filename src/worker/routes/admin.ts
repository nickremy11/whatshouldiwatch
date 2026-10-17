import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AdminAiRequest, AdminUser } from "../../shared/types";
import { type AppEnv, requireAdmin } from "../auth";

export const admin = new Hono<AppEnv>();
admin.use(requireAdmin);

admin.get("/users", async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT u.id, u.email, u.name, u.avatar_url AS avatarUrl, u.role, u.region,
		        u.created_at AS createdAt, u.last_seen_at AS lastSeenAt,
		        (SELECT COUNT(*) FROM user_titles t WHERE t.user_id = u.id AND t.watched_at IS NOT NULL) AS watched,
		        (SELECT COUNT(*) FROM user_titles t WHERE t.user_id = u.id AND t.rating IS NOT NULL) AS rated,
		        (SELECT COUNT(*) FROM user_titles t WHERE t.user_id = u.id AND t.in_watchlist = 1) AS watchlist,
		        (SELECT COUNT(*) FROM ai_requests a WHERE a.user_id = u.id) AS aiRequests,
		        (SELECT COUNT(*) FROM ai_requests a WHERE a.user_id = u.id AND a.created_at > datetime('now', '-7 days')) AS aiRequests7d,
		        (SELECT MAX(created_at) FROM ai_requests a WHERE a.user_id = u.id) AS lastAiAt
		 FROM users u ORDER BY u.created_at DESC`,
	).all<AdminUser>();
	return c.json(results);
});

admin.put("/users/:id/role", async (c) => {
	const id = c.req.param("id");
	const { role } = z.object({ role: z.enum(["user", "admin", "blocked"]) }).parse(await c.req.json());
	if (id === c.get("user")!.id) throw new HTTPException(400, { message: "You can't change your own role." });
	const res = await c.env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
	if (!res.meta.changes) throw new HTTPException(404, { message: "User not found" });
	// Blocking signs them out everywhere.
	if (role === "blocked") await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id).run();
	return c.json({ ok: true });
});

admin.get("/ai-requests", async (c) => {
	const userId = c.req.query("userId");
	const { results } = await c.env.DB.prepare(
		`SELECT a.id, a.user_id AS userId, u.email, a.prompt, a.media_type AS mediaType, a.model, a.picks, a.created_at AS createdAt
		 FROM ai_requests a JOIN users u ON u.id = a.user_id
		 ${userId ? "WHERE a.user_id = ?" : ""}
		 ORDER BY a.created_at DESC LIMIT 200`,
	)
		.bind(...(userId ? [userId] : []))
		.all<AdminAiRequest>();
	return c.json(results);
});
