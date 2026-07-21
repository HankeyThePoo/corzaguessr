import type { Round } from "../domain/types";

export type AudioRole = "active" | "standby";

export interface AudioFailure {
  role: AudioRole;
  round: Round;
  error: unknown;
}

export interface AudioPlayerCallbacks {
  onPlaying(round: Round): void;
  onWaiting(round: Round): void;
  onEnded(round: Round): void;
  onBlocked(round: Round): void;
  onFailure(failure: AudioFailure): void;
}

interface AudioSlot {
  readonly id: number;
  element: HTMLAudioElement;
  round: Round | null;
  role: AudioRole | "empty";
  generation: number;
  controller: AbortController | null;
  failed: boolean;
}

export interface AudioPlayer {
  prepare(round: Round): boolean;
  preload(round: Round): boolean;
  promote(round: Round): boolean;
  playPrepared(round: Round, restart: boolean): boolean;
  pause(): void;
  releaseActive(): void;
  stop(): void;
  discardStandby(): void;
  suspend(round: Round): void;
  restore(round: Round): void;
}

export class DualSlotAudioPlayer implements AudioPlayer {
  private readonly slots: AudioSlot[];
  private active: AudioSlot | null = null;
  private standby: AudioSlot | null = null;
  private generation = 0;
  private lastActiveSlotId: number | null = null;
  private phase: "empty" | "paused" | "starting" | "buffering" | "playing" | "ended" | "error" = "empty";
  private suspension: {
    generation: number;
    roundId: number;
    terminal: { type: "ended" } | { type: "failed"; error: unknown } | null;
  } | null = null;

  constructor(
    elements: readonly HTMLAudioElement[],
    private readonly sourceForRound: (round: Round) => string,
    private readonly callbacks: AudioPlayerCallbacks,
  ) {
    this.slots = elements.map((element, id) => ({
      id,
      element,
      round: null,
      role: "empty",
      generation: 0,
      controller: null,
      failed: false,
    }));
  }

  prepare(round: Round): boolean {
    return this.assign(round, "active");
  }

  preload(round: Round): boolean {
    return this.assign(round, "standby");
  }

  promote(round: Round): boolean {
    const slot = this.standby;
    if (!slot || slot.round?.id !== round.id) {
      this.callbacks.onFailure({
        role: "active",
        round,
        error: new Error("Prepared audio is unavailable."),
      });
      return false;
    }
    const error = slot.element.error;
    if (slot.failed || error) {
      this.standby = null;
      this.releaseSlot(slot);
      this.callbacks.onFailure({
        role: "active",
        round,
        error: error ?? new Error("Prepared audio failed before promotion."),
      });
      return false;
    }
    const previous = this.active;
    this.active = slot;
    this.standby = null;
    slot.role = "active";
    this.phase = "paused";
    if (previous && previous !== slot) this.releaseSlot(previous);
    return true;
  }

  playPrepared(round: Round, restart: boolean): boolean {
    const slot = this.active;
    if (!slot || slot.round?.id !== round.id) return false;
    const generation = slot.generation;
    if (restart) {
      slot.element.pause();
      this.seek(slot);
    }
    this.phase = "starting";
    try {
      slot.element.play()?.catch((error: unknown) => {
        if (!this.isLive(slot, generation, round) || slot !== this.active) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          this.phase = "paused";
          this.callbacks.onBlocked(round);
        } else {
          this.fail(slot, "active", error);
        }
      });
    } catch (error) {
      if (this.isLive(slot, generation, round) && slot === this.active) {
        this.fail(slot, "active", error);
      }
      return false;
    }
    return true;
  }

  pause(): void {
    if (!this.active) return;
    this.phase = "paused";
    this.active.element.pause();
  }

  releaseActive(): void {
    if (!this.active) return;
    const slot = this.active;
    this.lastActiveSlotId = slot.id;
    this.active = null;
    this.suspension = null;
    this.releaseSlot(slot);
    this.phase = this.standby ? "paused" : "empty";
  }

  stop(): void {
    this.generation += 1;
    this.suspension = null;
    this.releaseActive();
    this.discardStandby();
    this.phase = "empty";
  }

  discardStandby(): void {
    if (!this.standby) return;
    this.releaseSlot(this.standby);
    this.standby = null;
  }

  suspend(round: Round): void {
    if (!this.active || this.active.round?.id !== round.id) return;
    this.suspension = {
      generation: this.active.generation,
      roundId: round.id,
      terminal: null,
    };
    this.pause();
  }

  restore(round: Round): void {
    const suspension = this.suspension;
    this.suspension = null;
    if (
      !suspension ||
      !this.active ||
      this.active.round?.id !== round.id ||
      suspension.roundId !== round.id ||
      suspension.generation !== this.active.generation
    ) return;
    if (suspension.terminal?.type === "ended") this.callbacks.onEnded(round);
    if (suspension.terminal?.type === "failed") {
      this.callbacks.onFailure({ role: "active", round, error: suspension.terminal.error });
    }
  }

  private assign(round: Round, role: AudioRole): boolean {
    const reserved = role === "active" ? this.standby : this.active;
    const existing = role === "active" ? this.active : this.standby;
    if (existing) this.releaseSlot(existing);
    const candidates = this.slots.filter((slot) => slot !== reserved);
    const slot =
      candidates.find((candidate) => candidate.id !== this.lastActiveSlotId) ??
      candidates[0] ??
      null;
    if (!slot) return false;
    this.releaseSlot(slot);
    slot.round = round;
    slot.role = role;
    slot.generation = ++this.generation;
    slot.failed = false;
    if (role === "active") {
      this.active = slot;
      this.phase = "paused";
    } else this.standby = slot;
    this.bind(slot);
    slot.element.preload = "auto";
    slot.element.src = this.sourceForRound(round);
    slot.element.load();
    if (slot.element.error) {
      this.fail(slot, role, slot.element.error);
      return false;
    }
    return true;
  }

  private bind(slot: AudioSlot): void {
    const controller = new AbortController();
    const generation = slot.generation;
    const round = slot.round;
    slot.controller = controller;
    if (!round) return;
    const live = () => this.isLive(slot, generation, round);
    slot.element.addEventListener("loadedmetadata", () => live() && this.seek(slot), { signal: controller.signal });
    slot.element.addEventListener("playing", () => {
      if (!live() || slot !== this.active || !["starting", "buffering"].includes(this.phase)) return;
      this.phase = "playing";
      this.callbacks.onPlaying(round);
    }, { signal: controller.signal });
    slot.element.addEventListener("waiting", () => {
      if (!live() || slot !== this.active || this.phase === "paused") return;
      this.phase = "buffering";
      this.callbacks.onWaiting(round);
    }, { signal: controller.signal });
    slot.element.addEventListener("ended", () => {
      if (!live() || slot !== this.active) return;
      this.phase = "ended";
      if (this.suspension?.roundId === round.id) this.suspension.terminal = { type: "ended" };
      else this.callbacks.onEnded(round);
    }, { signal: controller.signal });
    slot.element.addEventListener("error", () => {
      if (live() && slot.element.error) {
        this.fail(slot, slot === this.standby ? "standby" : "active", slot.element.error);
      }
    }, { signal: controller.signal });
  }

  private fail(slot: AudioSlot, role: AudioRole, error: unknown): void {
    if (slot.failed || !slot.round) return;
    slot.failed = true;
    const round = slot.round;
    if (role === "standby") {
      if (this.standby === slot) this.standby = null;
      this.releaseSlot(slot);
      this.callbacks.onFailure({ role, round, error });
      return;
    }
    this.phase = "error";
    if (this.suspension?.roundId === round.id) {
      this.suspension.terminal = { type: "failed", error };
      return;
    }
    this.callbacks.onFailure({ role, round, error });
  }

  private seek(slot: AudioSlot): void {
    if (!slot.round || slot.element.readyState < HTMLMediaElement.HAVE_METADATA) return;
    try {
      slot.element.currentTime = Math.min(
        slot.round.clipStart,
        Math.max(0, slot.element.duration - 0.05),
      );
    } catch {
      // Browsers can reject a seek before media metadata settles.
    }
  }

  private isLive(slot: AudioSlot, generation: number, round: Round): boolean {
    return slot.generation === generation && slot.role !== "empty" && slot.round?.id === round.id;
  }

  private releaseSlot(slot: AudioSlot): void {
    slot.controller?.abort();
    slot.controller = null;
    const element = slot.element;
    element.pause();
    element.removeAttribute("src");
    element.load();
    const replacement = element.cloneNode(false) as HTMLAudioElement;
    element.replaceWith(replacement);
    slot.element = replacement;
    slot.round = null;
    slot.role = "empty";
    slot.failed = false;
  }
}
