// Types shared between the Worker API and the React client.

export type MediaType = "movie" | "tv";

export interface Rating {
	source: string;
	label: string;
	/** The score as the source presents it, e.g. "8.7/10", "91%", "82". */
	display: string;
	votes: number | null;
	url: string | null;
	/** 0-100, used only for the blend. */
	normalized: number;
}

export interface Scores {
	/** 0-100 average of every normalized source, or null if none are known yet. */
	blended: number | null;
	ratings: Rating[];
	fetchedAt: string | null;
}

export interface UserTitleState {
	inWatchlist: boolean;
	watchedAt: string | null;
	/** 0.5-5 stars. */
	rating: number | null;
}

export interface TitleCard {
	mediaType: MediaType;
	id: number;
	title: string;
	year: number | null;
	posterPath: string | null;
	overview: string;
	genreIds: number[];
	tmdbRating: number | null;
	tmdbVotes: number;
	popularity: number;
	scores?: Scores;
	user?: UserTitleState;
	/** Recommendation context, e.g. "Because you rated The Shawshank Redemption 5★". */
	reason?: string;
}

export interface PersonCard {
	id: number;
	name: string;
	profilePath: string | null;
	knownFor: string;
}

export interface CastMember {
	id: number;
	name: string;
	character: string;
	profilePath: string | null;
}

export interface Provider {
	id: number;
	name: string;
	logoPath: string | null;
}

export interface WatchAvailability {
	region: string;
	link: string | null;
	stream: Provider[];
	free: Provider[];
	ads: Provider[];
	rent: Provider[];
	buy: Provider[];
}

export interface SeasonSummary {
	seasonNumber: number;
	name: string;
	episodeCount: number;
	airDate: string | null;
	posterPath: string | null;
}

export interface Episode {
	seasonNumber: number;
	episodeNumber: number;
	name: string;
	overview: string;
	airDate: string | null;
	runtime: number | null;
	stillPath: string | null;
	tmdbRating: number | null;
	tmdbVotes: number;
	watched: boolean;
}

export interface CollectionInfo {
	id: number;
	name: string;
	parts: TitleCard[];
}

export interface TitleDetail extends TitleCard {
	tagline: string;
	genres: { id: number; name: string }[];
	runtime: number | null;
	status: string;
	certification: string | null;
	imdbId: string | null;
	backdropPath: string | null;
	cast: CastMember[];
	directors: string[];
	creators: string[];
	watch: WatchAvailability | null;
	collection: CollectionInfo | null;
	recommendations: TitleCard[];
	// TV only
	numberOfSeasons?: number;
	numberOfEpisodes?: number;
	seasons?: SeasonSummary[];
	nextEpisode?: { seasonNumber: number; episodeNumber: number; airDate: string | null } | null;
	/** Episodes the signed-in user has watched, keyed "season:episode". */
	watchedEpisodes?: string[];
	trailerKey?: string | null;
}

export interface Paged<T> {
	page: number;
	totalPages: number;
	totalResults: number;
	results: T[];
	/** Explains partial filtering (e.g. blended-score filter only covers this page). */
	note?: string;
}

export interface Me {
	id: string;
	email: string;
	name: string | null;
	avatarUrl: string | null;
	region: string;
	services: number[];
}

export interface AppConfig {
	turnstileSiteKey: string;
	me: Me | null;
}

export interface AiPick extends TitleCard {
	/** 0-100: how well the model thinks this matches the prompt (and your taste, if signed in). */
	match: number;
	why: string;
}

export interface AiPicksResponse {
	prompt: string;
	model: string;
	picks: AiPick[];
}

export type DiscoverSort =
	| "popularity"
	| "blended"
	| "tmdb_rating"
	| "newest"
	| "oldest"
	| "title";

export const SORT_LABELS: Record<DiscoverSort, string> = {
	popularity: "Most popular",
	blended: "Blended score",
	tmdb_rating: "TMDB rating",
	newest: "Newest",
	oldest: "Oldest",
	title: "Title A–Z",
};
