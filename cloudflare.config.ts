import { bindings, defineConfig, triggers } from "cf/config";
import * as entrypoint from "./src/worker/index.ts" with { type: "cf-worker" };

export default defineConfig({
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
			// Public Turnstile site key. The default is Cloudflare's always-pass test key;
			// the production key is swapped in when the widget is created.
			TURNSTILE_SITE_KEY: bindings.text("1x00000000000000000000AA"),

			TMDB_TOKEN: bindings.secret(),
			MDBLIST_API_KEY: bindings.secret(),
			GOOGLE_CLIENT_ID: bindings.secret(),
			GOOGLE_CLIENT_SECRET: bindings.secret(),
			TURNSTILE_SECRET_KEY: bindings.secret(),
		},
	},
});
