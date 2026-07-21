import {
  accuracy,
  updateClassicBest,
  updateDailyBest,
  updateTimedBest,
} from "../domain/mode-rules";
import type {
  DailyProgress,
  GameMode,
  GameResult,
  PersonalBests,
  Track,
} from "../domain/types";
import type { ProgressRepository } from "../platform/progress-repository";

export interface FinishedRun {
  mode: GameMode;
  won: boolean;
  track: Track;
  attempt: number;
  correct: number;
  guesses: number;
  elapsedMs: number;
  dailyDate: string;
}

export class ProgressService {
  private discoveriesState = new Set<number>();
  private dailyState: DailyProgress;
  private bestsState: PersonalBests;

  constructor(private readonly repository: ProgressRepository) {
    const loaded = repository.load();
    this.discoveriesState = loaded.discoveries;
    this.dailyState = loaded.daily;
    this.bestsState = loaded.personalBests;
  }

  get discoveries(): ReadonlySet<number> {
    return this.discoveriesState;
  }

  get daily(): DailyProgress {
    return this.dailyState;
  }

  get personalBests(): PersonalBests {
    return this.bestsState;
  }

  dailyDone(date: string): boolean {
    return this.dailyState.date === date && this.dailyState.completed;
  }

  dailyInProgress(date: string): boolean {
    return this.dailyState.date === date && this.dailyState.started && !this.dailyState.completed;
  }

  markDailyStarted(date: string, track: Track, attempt: number): void {
    if (this.dailyInProgress(date)) return;
    this.dailyState = {
      date,
      dailyNumber: track.dailyNumber,
      started: true,
      completed: false,
      won: false,
      step: attempt,
    };
    this.repository.saveDaily(this.dailyState);
  }

  updateDailyStep(step: number): void {
    if (!this.dailyState.started || this.dailyState.completed) return;
    this.dailyState.step = step;
    this.repository.saveDaily(this.dailyState);
  }

  recordDiscovery(trackNumber: number): void {
    if (this.discoveriesState.has(trackNumber)) return;
    this.discoveriesState.add(trackNumber);
    this.repository.saveDiscoveries(this.discoveriesState);
  }

  resetDiscoveries(): boolean {
    if (!this.repository.clearDiscoveries()) return false;
    this.discoveriesState.clear();
    return true;
  }

  finish(run: FinishedRun): GameResult {
    if (run.mode === "daily") {
      this.dailyState = {
        date: run.dailyDate,
        dailyNumber: run.track.dailyNumber,
        started: true,
        completed: true,
        won: run.won,
        step: run.attempt,
      };
      this.repository.saveDaily(this.dailyState);
      const update = updateDailyBest(this.bestsState, run.won, run.attempt + 1);
      if (update.changed) this.repository.savePersonalBests(this.bestsState);
      return {
        mode: "daily",
        won: run.won,
        trackTitle: run.track.title,
        spotify: run.track.spotify,
        newPersonalBest: update.newPersonalBest,
        attempts: run.attempt + 1,
        bestAttempts: this.bestsState.daily,
      };
    }

    if (run.mode === "classic") {
      const update = updateClassicBest(this.bestsState, run.won, run.attempt);
      if (update.changed) this.repository.savePersonalBests(this.bestsState);
      const best = this.bestsState.classic;
      return {
        mode: "classic",
        won: run.won,
        trackTitle: run.track.title,
        spotify: run.track.spotify,
        newPersonalBest: update.newPersonalBest,
        streak: update.streak,
        average: update.average,
        bestStreak: best.best,
        bestAverage: best.best ? best.bestSnippetTotal / best.best : 0,
      };
    }

    const runAccuracy = accuracy(run.correct, run.guesses);
    if (run.mode === "blitz") {
      const update = updateTimedBest(this.bestsState, "blitz", run.correct, runAccuracy);
      if (update.changed) this.repository.savePersonalBests(this.bestsState);
      return {
        mode: "blitz",
        newPersonalBest: update.newPersonalBest,
        correct: run.correct,
        accuracy: runAccuracy,
        bestCorrect: this.bestsState.blitz.score,
        bestAccuracy: this.bestsState.blitz.accuracy,
      };
    }

    const elapsedMs = Math.floor(run.elapsedMs / 1_000) * 1_000;
    const update = updateTimedBest(this.bestsState, "survival", elapsedMs, runAccuracy);
    if (update.changed) this.repository.savePersonalBests(this.bestsState);
    return {
      mode: "survival",
      newPersonalBest: update.newPersonalBest,
      elapsedMs,
      accuracy: runAccuracy,
      bestElapsedMs: this.bestsState.survival.score,
      bestAccuracy: this.bestsState.survival.accuracy,
    };
  }
}
