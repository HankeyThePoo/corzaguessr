import { RANDOM_TIMED_CLIP_SECONDS, SNIPPET_SECONDS } from "./mode-rules";
import type { Track } from "./types";

export type RandomSource = () => number;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const days = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= days[month - 1]!;
}

export function validateTrackCatalog(value: unknown): Track[] {
  if (!Array.isArray(value)) throw new Error("Track catalog is not an array.");
  if (value.length === 0) throw new Error("Track catalog is empty.");
  const titles = new Set<string>();
  const numbers = new Set<number>();

  return value.map((candidate, index) => {
    const fail = (reason: string): never => {
      throw new Error(`Track catalog entry ${index + 1} ${reason}`);
    };
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      fail("is not an object.");
    }
    const record = candidate as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const duration = record.duration;
    const spotify = typeof record.spotify === "string" ? record.spotify.trim() : "";
    const dailyNumber = record.dailyNumber;
    const dailyFrom = typeof record.dailyFrom === "string" ? record.dailyFrom.trim() : "";

    if (!title) fail("has no title.");
    if (titles.has(title)) fail(`duplicates title "${title}".`);
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
      fail("has an invalid duration.");
    }
    if (!Number.isSafeInteger(dailyNumber) || Number(dailyNumber) <= 0) {
      fail("has an invalid dailyNumber.");
    }
    if (numbers.has(Number(dailyNumber))) {
      fail(`duplicates dailyNumber ${String(dailyNumber)}.`);
    }
    if (spotify && !/^[A-Za-z0-9]{22}$/.test(spotify)) {
      fail("has an invalid Spotify track ID.");
    }
    if (!isIsoDate(dailyFrom)) fail("has an invalid dailyFrom date.");

    titles.add(title);
    numbers.add(Number(dailyNumber));
    return {
      title,
      duration: Number(duration),
      spotify,
      dailyNumber: Number(dailyNumber),
      dailyFrom,
      isNew: record.isNew === true,
    };
  });
}

export function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function selectDailyTrack(
  tracks: readonly Track[],
  date: string,
  persistedNumber: number | null,
): Track | null {
  const available = tracks.filter((track) => track.dailyFrom <= date);
  if (available.length === 0) return null;
  if (persistedNumber !== null) {
    const persisted = available.find((track) => track.dailyNumber === persistedNumber);
    if (persisted) return persisted;
  }
  let selected = available[0]!;
  let selectedHash = stableHash(`corzaguessr-daily:${date}:${selected.dailyNumber}`);
  for (const track of available.slice(1)) {
    const hash = stableHash(`corzaguessr-daily:${date}:${track.dailyNumber}`);
    if (hash > selectedHash) {
      selected = track;
      selectedHash = hash;
    }
  }
  return selected;
}

export function isDailyTrackAvailable(
  tracks: readonly Track[],
  date: string,
  dailyNumber: number,
): boolean {
  return tracks.some(
    (track) => track.dailyNumber === dailyNumber && track.dailyFrom <= date,
  );
}

export function dailyClipStart(track: Track, date: string): number {
  const clip = Math.min(SNIPPET_SECONDS.at(-1)!, track.duration);
  const maximum = Math.max(0, Math.floor(track.duration - clip));
  return stableHash(`corzaguessr-daily-clip:${date}:${track.dailyNumber}`) % (maximum + 1);
}

export function randomClipStart(
  track: Track,
  timed: boolean,
  random: RandomSource = Math.random,
): number {
  const clip = Math.min(
    timed ? RANDOM_TIMED_CLIP_SECONDS : SNIPPET_SECONDS.at(-1)!,
    track.duration,
  );
  const maximum = Math.max(0, Math.floor(track.duration - clip));
  return Math.floor(clampRandom(random()) * (maximum + 1));
}

export function selectRandomTrack(
  tracks: readonly Track[],
  failed: ReadonlySet<number>,
  previousTrackId: number | null,
  random: RandomSource = Math.random,
): Track | null {
  const playable = tracks.filter((track) => !failed.has(track.dailyNumber));
  if (playable.length === 0) return null;
  const withoutPrevious =
    playable.length > 1 && previousTrackId !== null
      ? playable.filter((track) => track.dailyNumber !== previousTrackId)
      : playable;
  const candidates = withoutPrevious.length ? withoutPrevious : playable;
  return candidates[Math.min(candidates.length - 1, Math.floor(clampRandom(random()) * candidates.length))] ?? null;
}

function clampRandom(value: number): number {
  return Math.max(0, Math.min(0.999_999_999_999, value));
}
