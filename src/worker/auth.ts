import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

export interface SessionUser {
	id: string;
	email: string;
	name: string | null;
	avatar_url: string | null;
	region: string;
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser | null } };

const SESSION_COOKIE = "wsiw_session";
const STATE_COOKIE = "wsiw_oauth_state";
const SESSION_DAYS = 30;
// Cloudflare's documented always-pass test secret, used only on localhost when no secret is set.
const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
	btoa(String.fromCharCode(...new Uint8Array(bytes)))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function sha256(input: string): Promise<string> {
	return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
}

const isLocal = (url: string) => {
	const host = new URL(url).hostname;
	return host === "localhost" || host === "127.0.0.1";
};

/** Loads the signed-in user (or null) for every request. */
export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
	const token = getCookie(c, SESSION_COOKIE);
	let user: SessionUser | null = null;
	if (token) {
		user = await c.env.DB.prepare(
			`SELECT u.id, u.email, u.name, u.avatar_url, u.region FROM sessions s
			 JOIN users u ON u.id = s.user_id
			 WHERE s.id = ? AND s.expires_at > datetime('now')`,
		)
			.bind(await sha256(token))
			.first<SessionUser>();
	}
	c.set("user", user);
	await next();
});

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
	if (!c.get("user")) throw new HTTPException(401, { message: "Sign in required" });
	await next();
});

/** Rejects cross-site writes. Browsers always send Origin on non-GET fetches. */
export const sameOrigin = createMiddleware<AppEnv>(async (c, next) => {
	if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
		const origin = c.req.header("Origin");
		if (origin !== new URL(c.req.url).origin) throw new HTTPException(403, { message: "Cross-origin request" });
	}
	await next();
});

async function verifyTurnstile(env: Env, url: string, token: string, ip: string | undefined): Promise<boolean> {
	const secret = env.TURNSTILE_SECRET_KEY || (isLocal(url) ? TURNSTILE_TEST_SECRET : "");
	if (!secret || !token) return false;
	const body = new FormData();
	body.set("secret", secret);
	body.set("response", token);
	if (ip) body.set("remoteip", ip);
	const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
	const data = (await res.json()) as { success: boolean };
	return data.success === true;
}

function safeReturnTo(value: unknown): string {
	return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/google/start", async (c) => {
	const form = await c.req.formData();
	const returnTo = safeReturnTo(form.get("returnTo"));
	const ok = await verifyTurnstile(
		c.env,
		c.req.url,
		String(form.get("cf-turnstile-response") ?? ""),
		c.req.header("CF-Connecting-IP"),
	);
	if (!ok) return c.redirect(`/login?error=turnstile&returnTo=${encodeURIComponent(returnTo)}`, 303);
	if (!c.env.GOOGLE_CLIENT_ID) return c.redirect("/login?error=config", 303);

	const state = randomToken();
	const verifier = randomToken(48);
	const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
	await c.env.CACHE.put(`oauth:${state}`, JSON.stringify({ verifier, returnTo }), { expirationTtl: 600 });
	setCookie(c, STATE_COOKIE, state, { httpOnly: true, secure: !isLocal(c.req.url), sameSite: "Lax", path: "/auth", maxAge: 600 });

	const origin = new URL(c.req.url).origin;
	const params = new URLSearchParams({
		client_id: c.env.GOOGLE_CLIENT_ID,
		redirect_uri: `${origin}/auth/google/callback`,
		response_type: "code",
		scope: "openid email profile",
		state,
		code_challenge: challenge,
		code_challenge_method: "S256",
		prompt: "select_account",
	});
	return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 303);
});

interface GoogleClaims {
	iss: string;
	aud: string;
	sub: string;
	exp: number;
	email: string;
	email_verified?: boolean;
	name?: string;
	picture?: string;
}

authRoutes.get("/google/callback", async (c) => {
	const { code, state, error } = c.req.query();
	const cookieState = getCookie(c, STATE_COOKIE);
	deleteCookie(c, STATE_COOKIE, { path: "/auth" });
	if (error) return c.redirect("/login?error=denied");
	if (!code || !state || state !== cookieState) return c.redirect("/login?error=state");

	const stored = await c.env.CACHE.get<{ verifier: string; returnTo: string }>(`oauth:${state}`, "json");
	await c.env.CACHE.delete(`oauth:${state}`);
	if (!stored) return c.redirect("/login?error=state");

	const origin = new URL(c.req.url).origin;
	const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			code,
			client_id: c.env.GOOGLE_CLIENT_ID,
			client_secret: c.env.GOOGLE_CLIENT_SECRET,
			redirect_uri: `${origin}/auth/google/callback`,
			grant_type: "authorization_code",
			code_verifier: stored.verifier,
		}),
	});
	if (!tokenRes.ok) {
		console.warn("google token exchange failed", tokenRes.status, await tokenRes.text());
		return c.redirect("/login?error=google");
	}
	const { id_token } = (await tokenRes.json()) as { id_token: string };
	// The ID token came straight from Google's token endpoint over TLS, so its
	// signature does not need re-verifying (OIDC Core 3.1.3.7); check the claims.
	const claims = JSON.parse(
		new TextDecoder().decode(
			Uint8Array.from(atob(id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0)),
		),
	) as GoogleClaims;
	const validIssuer = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
	if (!validIssuer || claims.aud !== c.env.GOOGLE_CLIENT_ID || claims.exp * 1000 < Date.now() || !claims.email_verified) {
		return c.redirect("/login?error=google");
	}

	const user = await c.env.DB.prepare(
		`INSERT INTO users (id, google_sub, email, name, avatar_url) VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT (google_sub) DO UPDATE SET email = excluded.email, name = excluded.name, avatar_url = excluded.avatar_url
		 RETURNING id`,
	)
		.bind(crypto.randomUUID(), claims.sub, claims.email, claims.name ?? null, claims.picture ?? null)
		.first<{ id: string }>();
	if (!user) return c.redirect("/login?error=google");

	const token = randomToken();
	await c.env.DB.prepare(
		`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`,
	)
		.bind(await sha256(token), user.id)
		.run();
	setCookie(c, SESSION_COOKIE, token, {
		httpOnly: true,
		secure: !isLocal(c.req.url),
		sameSite: "Lax",
		path: "/",
		maxAge: SESSION_DAYS * 86400,
	});
	return c.redirect(safeReturnTo(stored.returnTo));
});

authRoutes.post("/logout", sameOrigin, async (c) => {
	const token = getCookie(c, SESSION_COOKIE);
	if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256(token)).run();
	deleteCookie(c, SESSION_COOKIE, { path: "/" });
	return c.json({ ok: true });
});
