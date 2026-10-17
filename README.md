# What Should I Watch

A streamlined movie and TV search, ratings and tracking app at
[whatshouldiwatch.bruisedbanana.dev](https://whatshouldiwatch.bruisedbanana.dev).

- **Search** movies, shows and people; title pages show genres, runtime, seasons, episodes, cast,
  collections, trailer and where to stream.
- **Ratings from many sources** in their original formats (IMDb, Rotten Tomatoes, Metacritic,
  Letterboxd, Trakt, TMDB…) plus a blended 0–100 score.
- **Discover** with stacked filters: genres (match all/any), actor, streaming services (or just
  "my services"), year range, minimum TMDB rating, minimum blended score, hide watched; sort by
  popularity, blended score, rating, year or title.
- **Track** a watchlist, watched titles, half-star ratings and per-episode progress (signed in with Google).
- **Recommendations**: "Because you rated X…" rows built from your ratings, plus trending and acclaimed rows.
- **AI Picks** (signed-in only): describe a mood and get 5 picks with a match score, from a Workers AI model
  through AI Gateway. Each request carries the user's `email`/`userId` as AI Gateway metadata and is logged in D1.
- **Admin** (`/admin`): every account with activity counts and AI usage; set roles (`user`, `admin`, `blocked`).
  Emails in the `ADMIN_EMAILS` config var always become admins when they sign in.

## Stack

One Cloudflare Worker serves both the API ([Hono](https://hono.dev)) and the React SPA (Vite +
Tailwind + TanStack Query + React Router), built and deployed with the [`cf` CLI](https://developers.cloudflare.com/cf/).

| Piece | Used for |
| --- | --- |
| D1 `whatshouldiwatch-db` | users, sessions, watchlist/watched/ratings, episode progress, cached ratings |
| KV `whatshouldiwatch-cache` | TMDB response cache, OAuth state, MDBList daily budget, per-user recs cache |
| Workers AI + AI Gateway `whatshouldiwatch` | AI Picks (`@cf/zai-org/glm-4.7-flash` by default, set by `AI_MODEL`) |
| Rate limiting binding | 10 AI requests per minute per user/IP |
| Cron (daily 06:17 UTC) | refresh ratings older than 7 days for saved titles, pre-warm trending |

### Data sources (all free, API-based, no scraping)

- **[TMDB](https://www.themoviedb.org/documentation/api)**: metadata, search, discover, cast, seasons,
  collections, recommendations. Attribution is in the footer.
- **[JustWatch](https://www.justwatch.com) via TMDB**: streaming availability by region.
- **[MDBList](https://mdblist.com)**: IMDb, RT, Metacritic, Letterboxd, Trakt and more ratings. Free tier is
  1,000 requests/day; the app batches one request per page of results, caches for 7 days, and stops at 900/day.

## Develop

```sh
npm install
cp .dev.vars.example .dev.vars   # fill in keys
cf d1 migrations apply 8904ef6b-d461-4327-bce6-b6fe5aea2c6a --local --persist-to .cloudflare/state
npm run dev
```

Workers AI has no local simulator, so AI Picks calls the real (billed) service in dev.

## Deploy

```sh
npm run typecheck
cf d1 migrations apply 8904ef6b-d461-4327-bce6-b6fe5aea2c6a   # when migrations/ changes
cf deploy
```

Secrets live on the Worker and persist across deploys. Set or rotate one with:

```sh
cf workers secrets update <NAME> --worker whatshouldiwatch --text "<value>"
# TMDB_TOKEN, MDBLIST_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TURNSTILE_SECRET_KEY
```

## Google sign-in setup

In Google Cloud Console → APIs & Services → Credentials, create an OAuth client ID (Web application) with:

- Authorized JavaScript origins: `https://whatshouldiwatch.bruisedbanana.dev`, `http://localhost:5173`
- Authorized redirect URIs: `https://whatshouldiwatch.bruisedbanana.dev/auth/google/callback`,
  `http://localhost:5173/auth/google/callback`
