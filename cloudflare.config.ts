import { bindings, defineConfig, triggers } from "cf/config";
import * as entrypoint from "./src/worker/index.ts" with { type: "cf-worker" };

export default defineConfig(({ mode }) => ({
	accountId: "78edab4f9169850cdbb26130fac4d108",
	worker: {
		name: "whatshouldiwatch",
		compatibilityDate: "2026-10-06",
		compatibilityFlags: ["nodejs_compat"],
		entrypoint,
		domains: ["whatshouldiwatch.bruisedbanana.dev"],
		assets: {
			notFoundHandling: "single-page-application",
			runWorkerFirst: ["/api/*", "/auth/*"],
		},
		observability: { enabled: true },
		triggers: [
			// Refresh stale ratings for saved titles + pre-warm trending titles.
			triggers.scheduled({ schedule: "17 6 * * *" }),
		],
		env: {
			DB: bindings.d1({ id: "8904ef6b-d461-4327-bce6-b6fe5aea2c6a", name: "whatshouldiwatch-db" }),
			CACHE: bindings.kv({ id: "8f227cd5b15f48c78ff271661e547bd2" }),
			// Workers AI has no local simulator, so dev calls the real (billed) service.
			AI: bindings.ai({ dev: { remote: true } }),
			AI_RATE_LIMIT: bindings.rateLimit({ namespace: "4201", simple: { limit: 10, period: 60 } }),

			AI_MODEL: bindings.text("@cf/zai-org/glm-4.7-flash"),
			AI_GATEWAY_ID: bindings.text("whatshouldiwatch"),
			// Comma-separated; these accounts become admins when they sign in.
			ADMIN_EMAILS: bindings.text("nickremy11@gmail.com"),
			// Public Turnstile site key. Dev uses Cloudflare's always-pass test key so
			// it pairs with the test secret the Worker falls back to on localhost.
			TURNSTILE_SITE_KEY: bindings.text(mode === "development" ? "1x00000000000000000000AA" : "0x4AAAAAAFY_JlGBaajQTadO"),

			TMDB_TOKEN: bindings.secret(),
			MDBLIST_API_KEY: bindings.secret(),
			GOOGLE_CLIENT_ID: bindings.secret(),
			GOOGLE_CLIENT_SECRET: bindings.secret(),
			TURNSTILE_SECRET_KEY: bindings.secret(),
		},
	},
}));
