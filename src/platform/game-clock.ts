import type { ClockSnapshot } from "../domain/types";

export interface ClockCallbacks {
  onTick(snapshot: ClockSnapshot): void;
  onExpired(snapshot: ClockSnapshot): void;
}

export interface ClockConfiguration {
  kind: "classic" | "blitz" | "survival";
  initialMs: number;
  limitMs?: number;
}

export interface AnimationScheduler {
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
  setTimer(callback: () => void, delay: number): number;
  clearTimer(handle: number): void;
}

const browserScheduler: AnimationScheduler = {
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  setTimer: (callback, delay) => window.setTimeout(callback, delay),
  clearTimer: (handle) => window.clearTimeout(handle),
};

export class GameClock {
  private config: Required<ClockConfiguration> = {
    kind: "classic",
    initialMs: 1_000,
    limitMs: 1_000,
  };
  private running = false;
  private anchorMs: number | null = null;
  private elapsedMs = 0;
  private remainingMs = 1_000;
  private maxRemainingMs = 1_000;
  private expired = false;
  private frame = 0;
  private timer = 0;
  private generation = 0;

  constructor(
    private readonly callbacks: ClockCallbacks,
    private readonly now: () => number = () => performance.now(),
    private readonly scheduler: AnimationScheduler = browserScheduler,
  ) {}

  configure(configuration: ClockConfiguration): void {
    this.cancelScheduled();
    this.config = {
      ...configuration,
      limitMs: configuration.limitMs ?? configuration.initialMs,
    };
    this.running = false;
    this.anchorMs = null;
    this.elapsedMs = 0;
    this.remainingMs = configuration.initialMs;
    this.maxRemainingMs = configuration.initialMs;
    this.expired = false;
    this.generation += 1;
    this.callbacks.onTick(this.snapshot());
  }

  start(): void {
    if (this.running || this.expired) return;
    this.running = true;
    this.anchorMs = this.now();
    this.schedule();
  }

  pause(): ClockSnapshot {
    this.commit();
    this.running = false;
    this.anchorMs = null;
    this.generation += 1;
    this.cancelScheduled();
    const snapshot = this.snapshot();
    this.callbacks.onTick(snapshot);
    return snapshot;
  }

  restartClassic(milliseconds: number): void {
    this.cancelScheduled();
    this.config = { kind: "classic", initialMs: milliseconds, limitMs: milliseconds };
    this.running = false;
    this.anchorMs = null;
    this.elapsedMs = 0;
    this.remainingMs = milliseconds;
    this.maxRemainingMs = milliseconds;
    this.expired = false;
    this.generation += 1;
    this.callbacks.onTick(this.snapshot());
  }

  extendClassic(milliseconds: number): void {
    const wasRunning = this.running;
    this.commit();
    this.config = { kind: "classic", initialMs: milliseconds, limitMs: milliseconds };
    this.remainingMs = Math.max(0, milliseconds - this.elapsedMs);
    this.maxRemainingMs = Math.max(this.maxRemainingMs, milliseconds);
    this.expired = this.remainingMs === 0;
    this.anchorMs = wasRunning && !this.expired ? this.now() : null;
    this.running = wasRunning && !this.expired;
    this.generation += 1;
    this.cancelScheduled();
    if (this.running) this.schedule();
    this.callbacks.onTick(this.snapshot());
  }

  adjust(milliseconds: number): ClockSnapshot {
    this.commit();
    this.remainingMs = Math.max(0, this.remainingMs + milliseconds);
    this.maxRemainingMs = Math.max(this.maxRemainingMs, this.remainingMs);
    this.expired = this.remainingMs === 0;
    if (this.running && !this.expired) this.anchorMs = this.now();
    if (this.expired) {
      this.running = false;
      this.anchorMs = null;
      this.cancelScheduled();
    } else if (this.running) {
      this.generation += 1;
      this.cancelScheduled();
      this.schedule();
    }
    const snapshot = this.snapshot();
    this.callbacks.onTick(snapshot);
    return snapshot;
  }

  stop(): void {
    this.pause();
  }

  snapshot(): ClockSnapshot {
    const projected = this.project(this.now());
    return {
      kind: this.config.kind,
      running: this.running,
      elapsedMs: projected.elapsedMs,
      remainingMs: projected.remainingMs,
      limitMs: this.config.limitMs,
      maxRemainingMs: this.maxRemainingMs,
      expired: this.expired || projected.remainingMs <= 0,
    };
  }

  private project(at: number): { elapsedMs: number; remainingMs: number } {
    if (!this.running || this.anchorMs === null) {
      return { elapsedMs: this.elapsedMs, remainingMs: this.remainingMs };
    }
    const delta = Math.max(0, at - this.anchorMs);
    return {
      elapsedMs: this.elapsedMs + delta,
      remainingMs:
        this.config.kind === "classic"
          ? Math.max(0, this.config.limitMs - (this.elapsedMs + delta))
          : Math.max(0, this.remainingMs - delta),
    };
  }

  private commit(): void {
    if (!this.running || this.anchorMs === null) return;
    const projected = this.project(this.now());
    this.elapsedMs = projected.elapsedMs;
    this.remainingMs = projected.remainingMs;
    this.anchorMs = this.now();
    if (this.remainingMs <= 0) this.expired = true;
  }

  private schedule(): void {
    const generation = this.generation;
    const tick: FrameRequestCallback = () => {
      if (!this.running || generation !== this.generation) return;
      const snapshot = this.snapshot();
      this.callbacks.onTick(snapshot);
      if (snapshot.remainingMs > 0) this.frame = this.scheduler.requestFrame(tick);
    };
    this.frame = this.scheduler.requestFrame(tick);
    this.timer = this.scheduler.setTimer(() => {
      if (!this.running || generation !== this.generation) return;
      this.commit();
      this.running = false;
      this.anchorMs = null;
      this.remainingMs = 0;
      this.expired = true;
      this.cancelScheduled();
      const snapshot = this.snapshot();
      this.callbacks.onTick(snapshot);
      this.callbacks.onExpired(snapshot);
    }, Math.max(0, this.remainingMs));
  }

  private cancelScheduled(): void {
    if (this.frame) this.scheduler.cancelFrame(this.frame);
    if (this.timer) this.scheduler.clearTimer(this.timer);
    this.frame = 0;
    this.timer = 0;
  }
}
