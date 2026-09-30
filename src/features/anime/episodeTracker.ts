import type { AnimeIds } from "./animeIdentity.ts";

export interface EpisodeProgress {
  episode: number;
  season: number;
  /** Playback position in seconds within the episode. */
  positionSeconds: number;
  /** Episode duration in seconds when known. */
  durationSeconds?: number | undefined;
  /** Epoch ms of the last tracked playback update. */
  updatedAt: number;
  finished: boolean;
}

export interface SeriesProgress {
  ids: AnimeIds;
  title: string;
  season: number;
  episodes: Record<number, EpisodeProgress>;
  /** Highest episode with recorded playback. */
  lastEpisode: number;
  updatedAt: number;
}

const STORAGE_KEY = "lyra-anime-episode-tracker";
const SCHEMA_VERSION = 1;
const MAX_SERIES = 200;
const PRUNE_KEEP = 150;
const POSITION_EPSILON_SECONDS = 1;

interface TrackerStorage {
  version: number;
  series: Record<string, SeriesProgress>;
}

let storageCache: TrackerStorage | null = null;
const listeners = new Set<() => void>();

function readStorage(): TrackerStorage {
  if (storageCache) return storageCache;
  let parsed: TrackerStorage | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const candidate = JSON.parse(raw) as TrackerStorage;
      if (
        candidate &&
        typeof candidate === "object" &&
        candidate.version === SCHEMA_VERSION &&
        candidate.series &&
        typeof candidate.series === "object"
      ) {
        parsed = candidate;
      }
    }
  } catch {}

  storageCache = parsed || { version: SCHEMA_VERSION, series: {} };
  return storageCache;
}

function writeStorage(storage: TrackerStorage): void {
  storageCache = storage;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
  } catch {}
  for (const listener of listeners) listener();
}

export function subscribeToEpisodeTracker(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function pruneSeries(storage: TrackerStorage): void {
  const keys = Object.keys(storage.series);
  if (keys.length <= MAX_SERIES) return;
  const oldest = keys
    .sort(
      (left, right) =>
        (storage.series[left]!.updatedAt || 0) -
        (storage.series[right]!.updatedAt || 0),
    )
    .slice(0, Math.max(0, keys.length - PRUNE_KEEP));
  for (const key of oldest) delete storage.series[key];
}

function sortedIdEntries(ids: AnimeIds): [string, string][] {
  return Object.entries(ids).sort(([left], [right]) =>
    left.localeCompare(right),
  );
}

// Only stable, series-level providers participate in the tracker key.
// Streaming-source ids (anikoto/anikotoEpisode) change per episode or per
// playback session and would otherwise split a series into multiple records.
const SERIES_ID_PROVIDERS = new Set([
  "anilist",
  "mal",
  "anidb",
  "kitsu",
  "tmdb",
  "tmdbSeason",
  "imdb",
  "tvdb",
  "tvdbSeason",
  "animePlanet",
  "liveChart",
  "animeNewsNetwork",
  "aniSearch",
  "simkl",
  "animeCountdown",
]);

export function animeTrackerSeriesKey(
  ids: AnimeIds | undefined,
  title: string,
): string {
  const entries = sortedIdEntries(ids || {}).filter(([provider]) =>
    SERIES_ID_PROVIDERS.has(provider),
  );
  const identity = entries.map(([provider, id]) => `${provider}:${id}`).join("|");
  const normalizedTitle = title.trim().toLocaleLowerCase();
  return identity || `title:${normalizedTitle}`;
}

function sanitizeProgress(
  value: unknown,
  fallbackSeason: number,
): EpisodeProgress | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EpisodeProgress>;
  const episode = Number(candidate.episode);
  const position = Number(candidate.positionSeconds);
  if (!Number.isFinite(episode) || episode < 1) return null;
  if (!Number.isFinite(position) || position < 0) return null;
  const duration = Number(candidate.durationSeconds);
  return {
    episode: Math.floor(episode),
    season: Number.isFinite(Number(candidate.season))
      ? Math.max(1, Math.floor(Number(candidate.season)))
      : fallbackSeason,
    positionSeconds: position,
    durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : undefined,
    updatedAt: Number.isFinite(Number(candidate.updatedAt))
      ? Number(candidate.updatedAt)
      : 0,
    finished: candidate.finished === true,
  };
}

export function readSeriesProgress(
  ids: AnimeIds | undefined,
  title: string,
): SeriesProgress | null {
  const storage = readStorage();
  const idsKey = animeTrackerSeriesKey(ids, "");
  const titleKey = animeTrackerSeriesKey(undefined, title);
  // The player records under the provider-id key; the picker may only know the
  // title before identity resolution, so probe both and prefer the id match.
  const found =
    storage.series[idsKey] ||
    (titleKey !== idsKey ? storage.series[titleKey] : undefined);
  if (!found) return null;
  const episodes: Record<number, EpisodeProgress> = {};
  for (const [episodeKey, progress] of Object.entries(found.episodes || {})) {
    const episodeNumber = Number(episodeKey);
    const sanitized = sanitizeProgress(progress, found.season || 1);
    if (Number.isInteger(episodeNumber) && episodeNumber >= 1 && sanitized) {
      episodes[episodeNumber] = sanitized;
    }
  }
  return {
    ids: normalizeStoredIds(found.ids),
    title: typeof found.title === "string" ? found.title : "",
    season: Number.isFinite(Number(found.season)) && Number(found.season) > 0
      ? Math.floor(Number(found.season))
      : 1,
    episodes,
    lastEpisode:
      Number.isFinite(Number(found.lastEpisode)) && Number(found.lastEpisode) > 0
        ? Math.floor(Number(found.lastEpisode))
        : 0,
    updatedAt: Number(found.updatedAt) || 0,
  };
}

function normalizeStoredIds(ids: unknown): AnimeIds {
  if (!ids || typeof ids !== "object") return {};
  const normalized: AnimeIds = {};
  for (const [provider, value] of Object.entries(ids as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) {
      normalized[provider as keyof AnimeIds] = value.trim();
    }
  }
  return normalized;
}

/**
 * Most recent in-progress episode for a series: the latest episode that has a
 * position worth resuming (not finished), falling back to the first episode
 * after the newest finished one.
 */
export function findResumePoint(
  progress: SeriesProgress | null,
): EpisodeProgress | null {
  if (!progress) return null;
  const entries = Object.values(progress.episodes).sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
  const inProgress = entries.find(
    (entry) => !entry.finished && entry.positionSeconds > 0,
  );
  if (inProgress) return inProgress;

  const finished = entries.filter((entry) => entry.finished);
  if (finished.length === 0) return null;
  const latestFinished = finished.reduce((latest, entry) =>
    entry.episode > latest.episode ? entry : latest,
  );
  return {
    episode: latestFinished.episode + 1,
    season: latestFinished.season,
    positionSeconds: 0,
    durationSeconds: undefined,
    updatedAt: latestFinished.updatedAt,
    finished: false,
  };
}

function seriesEntryIds(ids: AnimeIds | undefined, title: string): AnimeIds {
  const normalized: AnimeIds = {};
  const entries = sortedIdEntries(ids || {}).filter(([provider]) =>
    SERIES_ID_PROVIDERS.has(provider),
  );
  for (const [provider, id] of entries) normalized[provider as keyof AnimeIds] = id;
  if (entries.length === 0 && title.trim()) {
    normalized.anilist = `title:${title.trim().toLocaleLowerCase()}`;
  }
  return normalized;
}

export function saveEpisodeProgress(options: {
  ids: AnimeIds | undefined;
  title: string;
  season: number;
  episode: number;
  positionSeconds: number;
  durationSeconds?: number | undefined;
  finished?: boolean | undefined;
}): void {
  const {
    ids,
    title,
    season,
    episode,
    positionSeconds,
    durationSeconds,
    finished = false,
  } = options;
  if (!title.trim() || !Number.isFinite(episode) || episode < 1) return;

  const key = animeTrackerSeriesKey(ids, title);
  if (!key) return;
  const storage = readStorage();
  const now = Date.now();
  const existing = storage.series[key];
  // Adopt history recorded under the title-only key (e.g. saved before the
  // provider ids were known) so progress is never split across two records.
  const titleKey = animeTrackerSeriesKey(undefined, title);
  const inherited =
    !existing && titleKey !== key ? storage.series[titleKey] : undefined;
  if (inherited) delete storage.series[titleKey];
  const source = existing || inherited;
  const series: SeriesProgress = {
    ids: seriesEntryIds(ids, title),
    title: title.trim(),
    season: season > 0 ? Math.floor(season) : 1,
    episodes: source?.episodes || {},
    lastEpisode: source?.lastEpisode || 0,
    updatedAt: now,
  };

  const previous = series.episodes[episode];
  const position = Math.max(0, positionSeconds);
  if (
    previous &&
    !finished &&
    Math.abs(previous.positionSeconds - position) < POSITION_EPSILON_SECONDS &&
    previous.updatedAt > now - 2500
  ) {
    return;
  }

  series.episodes[episode] = {
    episode,
    season: series.season,
    positionSeconds: position,
    durationSeconds:
      durationSeconds && durationSeconds > 0 ? durationSeconds : undefined,
    updatedAt: now,
    finished: finished || position > 0 ? finished : false,
  };

  if (episode > series.lastEpisode) series.lastEpisode = episode;
  pruneSeries(storage);
  storage.series[key] = series;
  writeStorage(storage);
}

export function markEpisodeFinished(options: {
  ids: AnimeIds | undefined;
  title: string;
  season: number;
  episode: number;
  durationSeconds?: number | undefined;
}): void {
  const { ids, title, season, episode, durationSeconds } = options;
  const key = animeTrackerSeriesKey(ids, title);
  const storage = readStorage();
  const existing = storage.series[key];
  if (!existing) return;
  const current = existing.episodes[episode];
  existing.episodes[episode] = {
    episode,
    season: existing.season || season || 1,
    positionSeconds: 0,
    durationSeconds:
      durationSeconds && durationSeconds > 0
        ? durationSeconds
        : current?.durationSeconds,
    updatedAt: Date.now(),
    finished: true,
  };
  if (episode > existing.lastEpisode) existing.lastEpisode = episode;
  existing.updatedAt = Date.now();
  writeStorage(storage);
}

export function clearSeriesProgress(ids: AnimeIds | undefined, title: string): void {
  const storage = readStorage();
  delete storage.series[animeTrackerSeriesKey(ids, title)];
  writeStorage(storage);
}

export function formatTrackerTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const total = Math.floor(totalSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatTrackerAge(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) return "just now";
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

/** Fraction (0..1) of the episode watched, when duration is known. */
export function episodeWatchFraction(progress: EpisodeProgress): number | null {
  if (!progress.durationSeconds || progress.durationSeconds <= 0) return null;
  if (progress.finished) return 1;
  return Math.max(
    0,
    Math.min(1, progress.positionSeconds / progress.durationSeconds),
  );
}
