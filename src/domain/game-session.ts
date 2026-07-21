import { isTimedMode, sixTryPrompt, timedPrompt } from "./mode-rules";
import type {
  AttemptOutcome,
  AttemptSlot,
  GameMode,
  GameResult,
  Round,
  SessionPhase,
  SessionSnapshot,
} from "./types";

export class GameSession {
  private modeState: GameMode | null = null;
  private phaseState: SessionPhase = "idle";
  private roundState: Round | null = null;
  private attemptState = 0;
  private roundNumberState = 0;
  private guessesState = 0;
  private correctState = 0;
  private currentSlotState: AttemptSlot | null = null;
  private historyState: AttemptSlot[] = [];
  private previousTrackIdState: number | null = null;
  private readonly failedTrackIdsState = new Set<number>();
  private readonly guessedTrackIdsState = new Set<number>();
  private resultState: GameResult | null = null;
  private playbackRequestedState = false;
  private nextSlotId = 0;

  get snapshot(): SessionSnapshot {
    return {
      mode: this.modeState,
      phase: this.phaseState,
      round: this.roundState,
      attempt: this.attemptState,
      roundNumber: this.roundNumberState,
      guesses: this.guessesState,
      correct: this.correctState,
      currentSlot: this.currentSlotState,
      history: this.historyState,
      previousTrackId: this.previousTrackIdState,
      failedTrackIds: this.failedTrackIdsState,
      guessedTrackIds: this.guessedTrackIdsState,
      result: this.resultState,
      playbackRequested: this.playbackRequestedState,
    };
  }

  reset(mode: GameMode, resumedAttempt = 0): void {
    this.modeState = mode;
    this.phaseState = "idle";
    this.roundState = null;
    this.attemptState = resumedAttempt;
    this.roundNumberState = 0;
    this.guessesState = 0;
    this.correctState = 0;
    this.currentSlotState = null;
    this.historyState = [];
    this.failedTrackIdsState.clear();
    this.guessedTrackIdsState.clear();
    this.resultState = null;
    this.playbackRequestedState = false;
  }

  beginPreparing(round: Round): void {
    if (this.roundNumberState === 0) this.roundNumberState = 1;
    this.phaseState = "preparing";
    this.playbackRequestedState = true;
    this.currentSlotState = this.prompt();
  }

  beginPlaying(round: Round): void {
    this.roundState = round;
    this.phaseState = "playing";
    this.playbackRequestedState = true;
    round.hasPlayed = true;
    if (this.modeState !== "daily") this.previousTrackIdState = round.track.dailyNumber;
    this.guessedTrackIdsState.clear();
    this.currentSlotState = this.prompt();
  }

  setPlaybackState(phase: "playing" | "paused" | "preparing", requested: boolean): void {
    this.phaseState = phase;
    this.playbackRequestedState = requested;
  }

  setRetry(): void {
    this.phaseState = "retry";
    this.playbackRequestedState = false;
  }

  showTrackError(message: string): void {
    if (this.currentSlotState) {
      this.currentSlotState = { id: this.currentSlotState.id, text: message, tone: "blink technical" };
    }
  }

  markRoundStopped(): void {
    if (this.roundState) this.roundState.hasPlayed = false;
  }

  setIdle(clearRound = false): void {
    this.phaseState = "idle";
    this.playbackRequestedState = false;
    if (clearRound) this.roundState = null;
  }

  recordGuess(trackNumber: number): boolean {
    if (this.guessedTrackIdsState.has(trackNumber)) return false;
    this.guessedTrackIdsState.add(trackNumber);
    return true;
  }

  recordFailure(trackNumber: number): void {
    this.failedTrackIdsState.add(trackNumber);
  }

  clearFailures(): void {
    this.failedTrackIdsState.clear();
  }

  resolveSixTry(outcome: AttemptOutcome, guessedTitle: string): { finished: boolean } {
    const slot = this.createAttemptSlot(outcome, guessedTitle);
    const finished = outcome === "correct" || this.attemptState === 5;
    if (finished) this.currentSlotState = slot;
    else this.archive(slot);
    if (!finished) {
      this.attemptState += 1;
      this.currentSlotState = this.prompt();
    }
    return { finished };
  }

  resolveTimed(outcome: AttemptOutcome, guessedTitle: string): void {
    this.archive(this.createAttemptSlot(outcome, guessedTitle));
    if (outcome !== "skip") this.guessesState += 1;
    if (outcome === "correct") this.correctState += 1;
    this.roundNumberState += 1;
    this.currentSlotState = this.prompt();
    this.roundState = null;
    this.phaseState = "idle";
    this.playbackRequestedState = false;
  }

  finish(result: GameResult): void {
    this.phaseState = "result";
    this.playbackRequestedState = false;
    if (this.roundState) this.roundState.hasPlayed = false;
    if (isTimedMode(this.modeState)) {
      this.currentSlotState = { id: ++this.nextSlotId, text: "TIME'S UP", tone: "" };
    }
    this.resultState = result;
  }

  private prompt(): AttemptSlot {
    const prompt = isTimedMode(this.modeState)
      ? timedPrompt(this.roundNumberState)
      : sixTryPrompt(this.attemptState);
    return { id: ++this.nextSlotId, ...prompt };
  }

  private createAttemptSlot(outcome: AttemptOutcome, title: string): AttemptSlot {
    let text = title;
    if (outcome === "skip") {
      if (isTimedMode(this.modeState)) text = "SKIPPED";
      else {
        const finalGuess = this.attemptState === 5;
        const added = finalGuess ? 0 : [1, 2, 4, 8, 16, 32][this.attemptState + 1]! - [1, 2, 4, 8, 16, 32][this.attemptState]!;
        text = finalGuess
          ? "FINAL GUESS SKIPPED"
          : `GUESS ${this.attemptState + 1} SKIPPED, ${added} SECOND${added === 1 ? "" : "S"} ADDED`;
      }
    }
    return { id: ++this.nextSlotId, text, tone: outcome };
  }

  private archive(slot: AttemptSlot): void {
    const timed = isTimedMode(this.modeState);
    const id = timed ? this.roundNumberState : this.attemptState + 1;
    this.historyState.unshift({ ...slot, id });
    if (timed && this.historyState.length > 19) this.historyState.length = 19;
  }
}
