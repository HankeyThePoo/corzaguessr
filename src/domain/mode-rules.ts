import type {
  AttemptOutcome,
  GameMode,
  PersonalBests,
} from "./types";

export const SNIPPET_SECONDS = [1, 2, 4, 8, 16, 32] as const;
export const RANDOM_TIMED_CLIP_SECONDS = 60;

export const STORAGE_KEYS = {
  discoveries: "corzaguessrDiscovered",
  daily: "corzaguessrDaily",
  personalBests: "corzaguessrPersonalBests",
} as const;

export const COPY = {
  modePrompt: "SELECT A MODE TO BEGIN",
  loadingCatalog: "LOADING TRACKLIST...",
  catalogError: "COULD NOT LOAD THE TRACKLIST, RETRYING...",
  loadingTrack: "LOADING TRACK...",
  trackError: "COULD NOT PLAY TRACK, PRESS PLAY TO RETRY!",
  trackUnavailable: "TRACK IS UNAVAILABLE.",
  discovery:
    "REVEAL TRACKS YOU'VE GUESSED CORRECTLY AND TRACK YOUR DISCOVERY PROGRESS",
} as const;

export const MODE_RULES = {
  classic: {
    initialTimeMs: null,
    description: "GUESS THE TRACK IN SIX TRIES AS MORE AUDIO IS REVEALED",
  },
  daily: {
    initialTimeMs: null,
    description: "ONE SHARED TRACK EACH DAY, GUESS IT IN SIX TRIES",
  },
  blitz: {
    initialTimeMs: 60_000,
    description: "GUESS AS MANY TRACKS AS POSSIBLE BEFORE THE TIMER RUNS OUT",
  },
  survival: {
    initialTimeMs: 30_000,
    description: "CORRECT GUESSES ADD TIME; MISTAKES AND SKIPS DRAIN IT",
  },
} as const;

export function isTimedMode(mode: GameMode | null): mode is "blitz" | "survival" {
  return mode === "blitz" || mode === "survival";
}

export function snippetSeconds(attempt: number): number {
  return SNIPPET_SECONDS[
    Math.max(0, Math.min(SNIPPET_SECONDS.length - 1, attempt))
  ] as number;
}

export function skipLabel(mode: GameMode | null, attempt: number): string {
  if (isTimedMode(mode)) return "SKIP";
  if (attempt >= SNIPPET_SECONDS.length - 1) return "GIVE UP";
  return `ADD ${SNIPPET_SECONDS[attempt + 1]! - SNIPPET_SECONDS[attempt]!}S`;
}

export function sixTryPrompt(attempt: number): { text: string; tone: string } {
  const finalAttempt = attempt === SNIPPET_SECONDS.length - 1;
  return {
    text: finalAttempt ? "LAST CHANCE TO GUESS" : `GUESS ${attempt + 1} OUT OF ${SNIPPET_SECONDS.length}`,
    tone: finalAttempt ? "blink prompt" : "prompt",
  };
}

export function timedPrompt(roundNumber: number): { text: string; tone: string } {
  return { text: `GUESS #${roundNumber}`, tone: "prompt" };
}

export function survivalAdjustment(outcome: AttemptOutcome): number {
  return outcome === "correct" ? 3_000 : outcome === "wrong" ? -1_000 : -2_000;
}

export function accuracy(correct: number, guesses: number): number {
  return guesses > 0 ? Math.round((correct * 100) / guesses) : 0;
}

export function updateDailyBest(
  bests: PersonalBests,
  won: boolean,
  attempts: number,
): { changed: boolean; newPersonalBest: boolean } {
  if (!won || (bests.daily !== 0 && attempts >= bests.daily)) {
    return { changed: false, newPersonalBest: false };
  }
  bests.daily = attempts;
  return { changed: true, newPersonalBest: false };
}

export function updateClassicBest(
  bests: PersonalBests,
  won: boolean,
  attempt: number,
): {
  changed: boolean;
  newPersonalBest: boolean;
  streak: number;
  average: number;
} {
  const classic = bests.classic;
  if (won) {
    classic.current += 1;
    classic.snippetTotal += snippetSeconds(attempt);
    const average = classic.snippetTotal / classic.current;
    const isBest =
      classic.current > classic.best ||
      (classic.current === classic.best &&
        (!classic.bestSnippetTotal || classic.snippetTotal < classic.bestSnippetTotal));
    if (isBest) {
      classic.best = classic.current;
      classic.bestSnippetTotal = classic.snippetTotal;
    }
    return {
      changed: true,
      newPersonalBest: isBest,
      streak: classic.current,
      average,
    };
  }

  const streak = classic.current;
  const average = classic.current ? classic.snippetTotal / classic.current : 0;
  const changed = classic.current !== 0 || classic.snippetTotal !== 0;
  classic.current = 0;
  classic.snippetTotal = 0;
  return { changed, newPersonalBest: false, streak, average };
}

export function updateTimedBest(
  bests: PersonalBests,
  mode: "blitz" | "survival",
  score: number,
  runAccuracy: number,
): { changed: boolean; newPersonalBest: boolean } {
  const current = bests[mode];
  const higherScore = score > current.score;
  const blitzTie =
    mode === "blitz" &&
    score > 0 &&
    score === current.score &&
    runAccuracy > (current.accuracy ?? -1);
  if (!higherScore && !blitzTie) {
    return { changed: false, newPersonalBest: false };
  }
  bests[mode] = { score, accuracy: runAccuracy };
  return { changed: true, newPersonalBest: false };
}
