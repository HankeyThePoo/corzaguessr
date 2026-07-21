import { STORAGE_KEYS } from "../domain/mode-rules";
import type { DailyProgress, PersonalBests } from "../domain/types";
import { isIsoDate } from "../domain/track-catalog";

export interface StoredProgress {
  discoveries: Set<number>;
  daily: DailyProgress;
  personalBests: PersonalBests;
}

export interface ProgressRepository {
  load(): StoredProgress;
  saveDiscoveries(discoveries: ReadonlySet<number>): boolean;
  clearDiscoveries(): boolean;
  saveDaily(progress: DailyProgress): boolean;
  savePersonalBests(bests: PersonalBests): boolean;
}

export function emptyDailyProgress(): DailyProgress {
  return {
    date: "",
    dailyNumber: null,
    started: false,
    completed: false,
    won: false,
    step: 0,
  };
}

export function emptyPersonalBests(): PersonalBests {
  return {
    classic: { current: 0, best: 0, snippetTotal: 0, bestSnippetTotal: 0 },
    daily: 0,
    blitz: { score: 0, accuracy: null },
    survival: { score: 0, accuracy: null },
  };
}

function safeNonNegative(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function safeAccuracy(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100
    ? Number(value)
    : null;
}

export function sanitizeDailyProgress(value: unknown): DailyProgress {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const date = typeof source.date === "string" && isIsoDate(source.date) ? source.date : "";
  const dailyNumber =
    Number.isSafeInteger(source.dailyNumber) && Number(source.dailyNumber) > 0
      ? Number(source.dailyNumber)
      : null;
  const validIdentity = date !== "" && dailyNumber !== null;
  const started = source.started === true && validIdentity;
  const completed = started && source.completed === true;
  const step =
    Number.isSafeInteger(source.step) && Number(source.step) >= 0 && Number(source.step) < 6
      ? Number(source.step)
      : 0;
  return {
    date: validIdentity ? date : "",
    dailyNumber: validIdentity ? dailyNumber : null,
    started,
    completed,
    won: completed && source.won === true,
    step,
  };
}

export function sanitizePersonalBests(value: unknown): PersonalBests {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const classicSource =
    source.classic && typeof source.classic === "object" && !Array.isArray(source.classic)
      ? (source.classic as Record<string, unknown>)
      : {};
  let current = safeNonNegative(classicSource.current);
  let snippetTotal = safeNonNegative(classicSource.snippetTotal);
  if (snippetTotal < current || snippetTotal > current * 32) {
    current = 0;
    snippetTotal = 0;
  }
  const best = Math.max(current, safeNonNegative(classicSource.best));
  let bestSnippetTotal = safeNonNegative(classicSource.bestSnippetTotal);
  if (bestSnippetTotal < best || bestSnippetTotal > best * 32) {
    bestSnippetTotal = current === best ? snippetTotal : 0;
  }
  const score = (candidate: unknown) => {
    const item = candidate && typeof candidate === "object" && !Array.isArray(candidate)
      ? (candidate as Record<string, unknown>)
      : {};
    return { score: safeNonNegative(item.score), accuracy: safeAccuracy(item.accuracy) };
  };
  const survival = score(source.survival);
  survival.score = Math.floor(survival.score / 1_000) * 1_000;
  return {
    classic: { current, best, snippetTotal, bestSnippetTotal },
    daily: safeNonNegative(source.daily),
    blitz: score(source.blitz),
    survival,
  };
}

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export class LocalStorageProgressRepository implements ProgressRepository {
  constructor(private readonly storage: Storage | null = browserStorage()) {}

  load(): StoredProgress {
    return {
      discoveries: new Set(
        this.readArray(STORAGE_KEYS.discoveries).filter(
          (value): value is number =>
            typeof value === "number" && Number.isSafeInteger(value) && value > 0,
        ),
      ),
      daily: sanitizeDailyProgress(this.readUnknown(STORAGE_KEYS.daily)),
      personalBests: sanitizePersonalBests(this.readUnknown(STORAGE_KEYS.personalBests)),
    };
  }

  saveDiscoveries(discoveries: ReadonlySet<number>): boolean {
    const values = [...discoveries].sort((left, right) => left - right);
    try {
      if (!this.storage) return false;
      if (values.length) this.storage.setItem(STORAGE_KEYS.discoveries, JSON.stringify(values));
      else this.storage.removeItem(STORAGE_KEYS.discoveries);
      return true;
    } catch {
      return false;
    }
  }

  clearDiscoveries(): boolean {
    try {
      if (!this.storage) return false;
      this.storage.removeItem(STORAGE_KEYS.discoveries);
      return true;
    } catch {
      return false;
    }
  }

  saveDaily(progress: DailyProgress): boolean {
    return this.write(STORAGE_KEYS.daily, progress);
  }

  savePersonalBests(bests: PersonalBests): boolean {
    return this.write(STORAGE_KEYS.personalBests, bests);
  }

  private readUnknown(key: string): unknown {
    try {
      if (!this.storage) return undefined;
      const value = this.storage.getItem(key);
      return value === null ? undefined : JSON.parse(value);
    } catch {
      return undefined;
    }
  }

  private readArray(key: string): unknown[] {
    const value = this.readUnknown(key);
    return Array.isArray(value) ? value : [];
  }

  private write(key: string, value: unknown): boolean {
    try {
      if (!this.storage) return false;
      this.storage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }
}
