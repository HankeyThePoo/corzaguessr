import { isTimedMode } from "../domain/mode-rules";
import type { GameMode, Round } from "../domain/types";
import type { AudioFailure, AudioPlayer } from "./dual-slot-audio-player";

export interface PlaybackCallbacks {
  onPending(round: Round, seamless: boolean): void;
  onPlaying(round: Round): void;
  onWaiting(round: Round): void;
  onBlocked(round: Round): void;
  onEnded(round: Round): void;
  onRetry(message: string): void;
  onLoading(visible: boolean): void;
}

export type RoundFactory = (
  failedTrackIds: ReadonlySet<number>,
  avoidTrackId: number | null,
) => Round | null;

export class PlaybackCoordinator {
  private prepared: Round | null = null;
  private pending: Round | null = null;
  private standby: Round | null = null;
  private active: Round | null = null;
  private mode: GameMode | null = null;
  private factory: RoundFactory | null = null;
  private previousTrackId: number | null = null;
  private readonly failedTrackIds = new Set<number>();
  private failureTimes: number[] = [];
  private automaticRecoveryBlocked = false;
  private loadingTimer = 0;

  constructor(
    private readonly audio: AudioPlayer,
    private readonly callbacks: PlaybackCallbacks,
    private readonly now: () => number = Date.now,
  ) {}

  get ownedRound(): Round | null {
    return this.active ?? this.pending ?? this.prepared;
  }

  configure(mode: GameMode, factory: RoundFactory, previousTrackId: number | null): void {
    this.stop();
    this.mode = mode;
    this.factory = factory;
    this.previousTrackId = previousTrackId;
    this.resetFailureCircuit();
  }

  prime(): void {
    if (!this.mode || !this.factory || this.prepared || this.pending || this.active) return;
    const round = this.factory(this.failedTrackIds, this.previousTrackId);
    if (!round) return;
    this.prepared = round;
    if (!this.audio.prepare(round)) this.handleRejected(round, "Audio could not be staged before Play.");
    else this.prefetch();
  }

  start(options: { manualRetry?: boolean; seamless?: boolean } = {}): boolean {
    if (!this.mode || !this.factory) return false;
    if (options.manualRetry) this.resetFailureCircuit();
    if (!options.manualRetry && this.automaticRecoveryBlocked) {
      this.callbacks.onRetry("COULD NOT PLAY TRACK, PRESS PLAY TO RETRY!");
      return false;
    }
    let round = this.prepared;
    if (round) {
      this.prepared = null;
    } else if (this.standby) {
      round = this.standby;
      this.standby = null;
      if (!this.audio.promote(round)) return false;
    } else {
      round = this.factory(this.failedTrackIds, this.previousTrackId);
      if (!round) {
        this.callbacks.onRetry("COULD NOT PLAY TRACK, PRESS PLAY TO RETRY!");
        return false;
      }
      if (!this.audio.prepare(round)) return false;
    }
    this.pending = round;
    this.callbacks.onPending(round, options.seamless === true);
    this.showLoading(options.seamless ? 700 : 180);
    const started = this.audio.playPrepared(round, false);
    if (!started) this.handleRejected(round, "Audio could not start.");
    return started;
  }

  replay(round: Round, restart: boolean): boolean {
    this.active = round;
    return this.audio.playPrepared(round, restart);
  }

  pause(): void {
    this.audio.pause();
  }

  suspend(round: Round): void {
    this.audio.suspend(round);
  }

  restore(round: Round): void {
    this.audio.restore(round);
  }

  releaseActive(): void {
    this.audio.releaseActive();
    this.active = null;
  }

  stop(): void {
    this.clearLoading();
    this.audio.stop();
    this.prepared = null;
    this.pending = null;
    this.standby = null;
    this.active = null;
  }

  handlePlaying(round: Round): void {
    if (this.pending?.id === round.id) {
      this.pending = null;
      this.active = round;
      this.previousTrackId = this.mode === "daily" ? this.previousTrackId : round.track.dailyNumber;
      this.failedTrackIds.clear();
      this.resetFailureCircuit();
      this.clearLoading();
      this.callbacks.onPlaying(round);
      this.prefetch();
      return;
    }
    if (this.active?.id === round.id) {
      this.resetFailureCircuit();
      this.callbacks.onPlaying(round);
    }
  }

  handleWaiting(round: Round): void {
    if (this.owns(round)) this.callbacks.onWaiting(round);
  }

  handleBlocked(round: Round): void {
    if (!this.owns(round)) return;
    this.clearLoading();
    this.callbacks.onBlocked(round);
  }

  handleEnded(round: Round): void {
    if (this.active?.id === round.id) this.callbacks.onEnded(round);
  }

  handleFailure(failure: AudioFailure): void {
    const { round, role } = failure;
    if (role === "standby") {
      if (this.standby?.id !== round.id) return;
      this.standby = null;
      if (this.mode !== "daily") {
        this.failedTrackIds.add(round.track.dailyNumber);
        if (this.registerFailure()) queueMicrotask(() => this.prefetch());
      }
      return;
    }
    if (!this.owns(round)) return;
    this.clearLoading();
    if (this.mode !== "daily") this.failedTrackIds.add(round.track.dailyNumber);
    const mayRecover = this.mode !== "daily" && this.registerFailure();
    this.prepared = null;
    this.pending = null;
    this.active = null;
    this.audio.releaseActive();
    if (mayRecover) {
      this.callbacks.onRetry("THE SELECTED TRACK COULD NOT BE PLAYED. TRYING ANOTHER.");
      queueMicrotask(() => this.start());
    } else {
      this.callbacks.onRetry("THE SELECTED TRACK COULD NOT BE PLAYED. PRESS PLAY TO RETRY.");
    }
  }

  private prefetch(): void {
    if (!isTimedMode(this.mode) || !this.factory || this.standby || this.automaticRecoveryBlocked) return;
    const owned = this.active ?? this.pending ?? this.prepared;
    if (!owned) return;
    const round = this.factory(this.failedTrackIds, owned.track.dailyNumber);
    if (!round) return;
    this.standby = round;
    if (!this.audio.preload(round)) this.standby = null;
  }

  private owns(round: Round): boolean {
    return [this.prepared, this.pending, this.active].some((item) => item?.id === round.id);
  }

  private handleRejected(round: Round, message: string): void {
    this.handleFailure({ role: "active", round, error: new Error(message) });
  }

  private registerFailure(): boolean {
    const now = this.now();
    this.failureTimes = this.failureTimes.filter((time) => now - time <= 10_000);
    this.failureTimes.push(now);
    this.automaticRecoveryBlocked = this.failureTimes.length >= 3;
    return !this.automaticRecoveryBlocked;
  }

  private resetFailureCircuit(): void {
    this.failureTimes = [];
    this.automaticRecoveryBlocked = false;
  }

  private showLoading(delay: number): void {
    this.clearLoading();
    this.loadingTimer = window.setTimeout(() => {
      this.loadingTimer = 0;
      this.callbacks.onLoading(true);
    }, delay);
  }

  private clearLoading(): void {
    if (this.loadingTimer) clearTimeout(this.loadingTimer);
    this.loadingTimer = 0;
    this.callbacks.onLoading(false);
  }
}
