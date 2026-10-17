import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AiPick, AiPicksResponse, MediaType, TitleCard } from "../../shared/types";
import type { AppEnv } from "../auth";
import { attachScores } from "../ratings";
import { type TmdbPage, tmdb, toCards } from "../tmdb";
import { attachUserState, genreAffinity } from "../user-data";

export const recs = new Hono<AppEnv>();

interface Section {
	id: string;
	title: string;
	subtitle?: string;
	items: TitleCard[];
}

const stars = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}★`;

interface SeedRow {
	media_type: MediaType;
	tmdb_id: number;
	title: string;
	rating: number | null;
	genre_ids: string;
}

async function personalSections(env: Env, userId: string): Promise<Section[] | null> {
	const { results: seeds } = await env.DB.prepare(
		`SELECT ut.media_type, ut.tmdb_id, t.title, ut.rating, t.genre_ids
		 FROM user_titles ut JOIN titles t ON t.media_type = ut.media_type AND t.tmdb_id = ut.tmdb_id
		 WHERE ut.user_id = ? AND (ut.rating >= 3.5 OR (ut.rating IS NULL AND ut.watched_at IS NOT NULL))
		 ORDER BY COALESCE(ut.rating, 3.5) DESC, ut.updated_at DESC LIMIT 8`,
	)
		.bind(userId)
		.all<SeedRow>();
	if (!seeds.length) return null;

	const { results: seenRows } = await env.DB.prepare(
		"SELECT media_type, tmdb_id FROM user_titles WHERE user_id = ? AND (watched_at IS NOT NULL OR rating IS NOT NULL)",
	)
		.bind(userId)
		.all<{ media_type: MediaType; tmdb_id: number }>();
	const seen = new Set(seenRows.map((r) => `${r.media_type}:${r.tmdb_id}`));
	const affinity = await genreAffinity(env, userId);

	const perSeed = await Promise.all(
		seeds.map(async (s) => {
			const page = await tmdb<TmdbPage>(env, `/${s.media_type}/${s.tmdb_id}/recommendations`, {}, 86400);
			return toCards(page.results, s.media_type).filter((c) => !seen.has(`${c.mediaType}:${c.id}`));
		}),
	);

	// Score each candidate: how strongly the seeds point at it, plus genre taste.
	const candidates = new Map<string, { card: TitleCard; score: number; bestSeed: SeedRow; bestContribution: number }>();
	perSeed.forEach((list, si) => {
		const seed = seeds[si];
		const weight = (seed.rating ?? 3.5) - 2.5;
		list.forEach((card, rank) => {
			const contribution = weight * (1 - rank / 25);
			const k = `${card.mediaType}:${card.id}`;
			const existing = candidates.get(k);
			if (existing) {
				existing.score += contribution;
				if (contribution > existing.bestContribution) Object.assign(existing, { bestSeed: seed, bestContribution: contribution });
			} else {
				const taste = card.genreIds.length
					? card.genreIds.reduce((t, g) => t + (affinity.get(g) ?? 0), 0) / card.genreIds.length
					: 0;
				candidates.set(k, { card, score: contribution + taste * 0.5, bestSeed: seed, bestContribution: contribution });
			}
		});
	});

	const reasonFor = (s: SeedRow) => (s.rating ? `Because you rated ${s.title} ${stars(s.rating)}` : `Because you watched ${s.title}`);
	const top = [...candidates.values()]
		.sort((a, b) => b.score - a.score)
		.slice(0, 20)
		.map((x) => ({ ...x.card, reason: reasonFor(x.bestSeed) }));

	const sections: Section[] = [{ id: "for-you", title: "Top picks for you", items: top }];
	const used = new Set(top.map((c) => `${c.mediaType}:${c.id}`));
	for (const [i, seed] of seeds.slice(0, 3).entries()) {
		const items = perSeed[i].filter((c) => !used.has(`${c.mediaType}:${c.id}`)).slice(0, 12);
		if (items.length >= 4) sections.push({ id: `seed-${seed.media_type}-${seed.tmdb_id}`, title: reasonFor(seed), items });
	}
	return sections;
}

async function generalSections(env: Env): Promise<Section[]> {
	const [trending, topMovies, topTv] = await Promise.all([
		tmdb<TmdbPage>(env, "/trending/all/week", {}, 6 * 3600),
		tmdb<TmdbPage>(env, "/movie/top_rated", {}, 86400),
		tmdb<TmdbPage>(env, "/tv/top_rated", {}, 86400),
	]);
	return [
		{ id: "trending", title: "Trending this week", items: toCards(trending.results).slice(0, 20) },
		{ id: "top-movies", title: "Critically acclaimed movies", items: toCards(topMovies.results, "movie").slice(0, 20) },
		{ id: "top-tv", title: "Critically acclaimed shows", items: toCards(topTv.results, "tv").slice(0, 20) },
	];
}

recs.get("/", async (c) => {
	const user = c.get("user");
	let sections: Section[] = [];
	if (user) {
		const cacheKey = `recs:${user.id}`;
		const cached = await c.env.CACHE.get<Section[]>(cacheKey, "json");
		sections = cached ?? (await personalSections(c.env, user.id)) ?? [];
		if (!cached && sections.length) await c.env.CACHE.put(cacheKey, JSON.stringify(sections), { expirationTtl: 6 * 3600 });
	}
	const personalized = sections.length > 0;
	sections = [...sections, ...(await generalSections(c.env))];
	const all = sections.flatMap((s) => s.items);
	await attachScores(c.env, all);
	await attachUserState(c.env, user?.id, all);
	return c.json({ personalized, sections });
});

// --- AI picks micro app -------------------------------------------------------

const aiBody = z.object({
	prompt: z.string().trim().min(3).max(500),
	mediaType: z.enum(["any", "movie", "tv"]).default("any"),
});

const AI_SCHEMA = {
	type: "object",
	properties: {
		recommendations: {
			type: "array",
			minItems: 5,
			maxItems: 5,
			items: {
				type: "object",
				properties: {
					title: { type: "string" },
					year: { type: "integer" },
					type: { type: "string", enum: ["movie", "tv"] },
					match: { type: "integer", minimum: 0, maximum: 100 },
					why: { type: "string" },
				},
				required: ["title", "year", "type", "match", "why"],
			},
		},
	},
	required: ["recommendations"],
};

interface AiRec {
	title: string;
	year?: number;
	type: MediaType;
	match: number;
	why: string;
}

function parseAiOutput(raw: unknown): AiRec[] {
	const r = raw as { response?: unknown; choices?: { message?: { content?: string } }[] };
	let payload: unknown = r.response ?? r.choices?.[0]?.message?.content ?? raw;
	if (typeof payload === "string") {
		const json = payload.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
		payload = JSON.parse(json.slice(json.indexOf("{"), json.lastIndexOf("}") + 1));
	}
	const recsOut = (payload as { recommendations?: AiRec[] }).recommendations;
	if (!Array.isArray(recsOut)) throw new Error("Model returned no recommendations");
	return recsOut;
}

async function resolveOnTmdb(env: Env, rec: AiRec): Promise<TitleCard | null> {
	const type: MediaType = rec.type === "tv" ? "tv" : "movie";
	const yearParam = type === "movie" ? "primary_release_year" : "first_air_date_year";
	const exact = await tmdb<TmdbPage>(env, `/search/${type}`, { query: rec.title, [yearParam]: rec.year }, 86400);
	const hit = toCards(exact.results, type)[0];
	if (hit) return hit;
	const loose = await tmdb<TmdbPage>(env, "/search/multi", { query: rec.title }, 86400);
	return toCards(loose.results)[0] ?? null;
}

recs.post("/ai", async (c) => {
	const { prompt, mediaType } = aiBody.parse(await c.req.json());
	const user = c.get("user");
	const limiterKey = user?.id ?? c.req.header("CF-Connecting-IP") ?? "anon";
	const { success } = await c.env.AI_RATE_LIMIT.limit({ key: limiterKey });
	if (!success) throw new HTTPException(429, { message: "Slow down — try again in a minute." });

	let taste = "";
	let seen = new Set<string>();
	if (user) {
		const { results } = await c.env.DB.prepare(
			`SELECT t.title, t.year, ut.media_type, ut.tmdb_id, ut.rating, ut.watched_at
			 FROM user_titles ut JOIN titles t ON t.media_type = ut.media_type AND t.tmdb_id = ut.tmdb_id
			 WHERE ut.user_id = ? AND (ut.rating IS NOT NULL OR ut.watched_at IS NOT NULL)
			 ORDER BY ut.rating IS NULL, ut.rating DESC, ut.updated_at DESC LIMIT 40`,
		)
			.bind(user.id)
			.all<{ title: string; year: number | null; media_type: MediaType; tmdb_id: number; rating: number | null }>();
		seen = new Set(results.map((r) => `${r.media_type}:${r.tmdb_id}`));
		if (results.length) {
			taste =
				"The viewer has already seen these (do NOT recommend them). Ratings are out of 5 stars:\n" +
				results.map((r) => `- ${r.title}${r.year ? ` (${r.year})` : ""}${r.rating ? `: ${r.rating}★` : ": watched, unrated"}`).join("\n");
		}
	}

	const system = [
		"You recommend movies and TV shows. Reply only with JSON matching the schema.",
		"Return exactly 5 real, released titles with their original release year.",
		mediaType === "any" ? "Mix movies and TV if it fits the request." : `Only recommend ${mediaType === "tv" ? "TV shows" : "movies"}.`,
		"For each, give `match`: 0-100 for how well it fits the request" + (taste ? " and the viewer's taste" : "") + ".",
		"Be calibrated: 90+ only for an excellent fit, 60-75 for a reasonable but loose fit.",
		"`why` is one short sentence tying the title to the request.",
	].join(" ");

	const raw = await c.env.AI.run(
		c.env.AI_MODEL as keyof AiModels,
		{
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: taste ? `${taste}\n\nRequest: ${prompt}` : prompt },
			],
			response_format: { type: "json_schema", json_schema: AI_SCHEMA },
			// Hidden reasoning can use the whole token budget before any JSON is written,
			// and isn't needed for a list of picks.
			chat_template_kwargs: { enable_thinking: false },
			max_tokens: 2000,
			temperature: 0.6,
		} as never,
		{ gateway: { id: c.env.AI_GATEWAY_ID } },
	);

	let aiRecs: AiRec[];
	try {
		aiRecs = parseAiOutput(raw);
	} catch (err) {
		console.warn("ai parse failed", err, JSON.stringify(raw).slice(0, 500));
		throw new HTTPException(502, { message: "The model returned something unreadable. Try rephrasing." });
	}

	const resolved = await Promise.all(aiRecs.slice(0, 5).map((r) => resolveOnTmdb(c.env, r)));
	const picks: AiPick[] = [];
	resolved.forEach((card, i) => {
		if (!card || seen.has(`${card.mediaType}:${card.id}`)) return;
		if (picks.some((p) => p.mediaType === card.mediaType && p.id === card.id)) return;
		const match = Math.max(0, Math.min(100, Math.round(Number(aiRecs[i].match) || 0)));
		picks.push({ ...card, match, why: aiRecs[i].why });
	});
	picks.sort((a, b) => b.match - a.match);
	await attachScores(c.env, picks);
	await attachUserState(c.env, user?.id, picks);
	return c.json({ prompt, model: c.env.AI_MODEL, picks } satisfies AiPicksResponse);
});
