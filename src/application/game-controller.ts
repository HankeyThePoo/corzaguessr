import { GameSession } from "../domain/game-session";
import {
  COPY,
  isTimedMode,
  MODE_RULES,
  skipLabel,
  snippetSeconds,
  survivalAdjustment,
} from "../domain/mode-rules";
import {
  dailyClipStart,
  isDailyTrackAvailable,
  randomClipStart,
  selectDailyTrack,
  selectRandomTrack,
  type RandomSource,
} from "../domain/track-catalog";
import type {
  AttemptOutcome,
  GameMode,
  GameViewModel,
  Round,
  Track,
} from "../domain/types";
import type { BudapestDateBoundary } from "../platform/budapest-date-boundary";
import type { TrackCatalogRepository } from "../platform/catalog-repository";
import type { GameClock } from "../platform/game-clock";
import type { PlaybackCoordinator } from "../playback/playback-coordinator";
import type { GameView } from "../ui/game-view";
import { ProgressService } from "./progress-service";

export class GameController {
  private readonly session = new GameSession();
  private appStatus: GameViewModel["appStatus"] = "loading";
  private tracks: Track[] = [];
  private budapestDate = "1970-01-01";
  private dailyDate = "1970-01-01";
  private overlay: "result" | "discovery" | null = null;
  private catalogGeneration = 0;
  private catalogRetryTimer = 0;
  private loadingTrackVisible = false;
  private sessionNumber = 0;
  private nextRoundId = 0;
  private pendingRound: Round | null = null;
  private finishing = false;

  constructor(
    private readonly catalog: TrackCatalogRepository,
    private readonly progress: ProgressService,
    private readonly clock: GameClock,
    private readonly playback: PlaybackCoordinator,
    private readonly view: GameView,
    private readonly dailyBoundary: BudapestDateBoundary,
    private readonly random: RandomSource = Math.random,
  ) {}

  bootstrap(date: string): void {
    this.budapestDate = date;
    this.dailyDate = date;
    this.render();
    void this.refreshCatalog(date);
  }

  selectMode(mode: GameMode): void {
    const state = this.session.snapshot;
    if (this.overlay || this.appStatus === "error" || state.mode === mode) return;
    if (mode === "daily") {
      const date = this.dailyBoundary.start();
      this.budapestDate = date;
      this.dailyDate = date;
    } else this.dailyBoundary.stop();
    this.resetForMode(mode);
    this.view.announce(MODE_RULES[mode].description);
    this.view.focusPlay();
  }

  play(): void { this.handlePlay(false); }
  playbackShortcut(): void { this.handlePlay(true); }
  skip(): void { this.resolveAttempt("skip", null); }

  guess(dailyNumber: number): void {
    const state = this.session.snapshot;
    const round = state.round;
    if (!round || !["playing", "paused"].includes(state.phase) || this.overlay || state.guessedTrackIds.has(dailyNumber)) return;
    const guessed = this.tracks.find((track) => track.dailyNumber === dailyNumber);
    if (!guessed || (isTimedMode(state.mode) && !round.hasPlayed)) return;
    if (!this.session.recordGuess(dailyNumber)) return;
    this.resolveAttempt(dailyNumber === round.track.dailyNumber ? "correct" : "wrong", guessed);
  }

  newGame(): void {
    const mode = this.session.snapshot.mode;
    if (!mode) return;
    if (this.overlay === "result") {
      this.view.modal.close("result", this.view.playButton, () => this.resetForMode(mode), () => {
        this.overlay = null;
        this.prime();
        this.render();
        this.view.focusPlay();
      });
      return;
    }
    this.resetForMode(mode);
  }

  openDiscovery(): void {
    if (this.overlay === "discovery") { this.closeDiscovery(); return; }
    if (this.overlay || this.session.snapshot.phase === "result") return;
    const round = this.session.snapshot.round;
    if (round) {
      this.clock.pause();
      this.playback.suspend(round);
      if (this.session.snapshot.phase === "playing") this.session.setPlaybackState("paused", false);
    }
    this.overlay = "discovery";
    this.view.resetTransientUi();
    this.render();
    this.view.modal.openDiscovery();
  }

  closeDiscovery(): void {
    if (this.overlay !== "discovery") return;
    this.view.modal.close("discovery", this.view.discoveryButton, () => {}, () => {
      this.overlay = null;
      const round = this.session.snapshot.round;
      if (round) this.playback.restore(round);
      this.prime();
      this.render();
      if (this.session.snapshot.mode) this.view.focusPlay();
    });
  }

  resetDiscovery(): void {
    if (this.overlay !== "discovery") return;
    if (!this.progress.resetDiscoveries()) {
      this.view.announce("DISCOVERY COULD NOT BE RESET IN THIS BROWSER.");
      return;
    }
    this.view.announce("DISCOVERY RESET.");
    this.render();
  }

  openSpotify(): void {
    const result = this.session.snapshot.result;
    const spotify = result && (result.mode === "classic" || result.mode === "daily") ? result.spotify : "";
    if (spotify) window.open(`https://open.spotify.com/track/${spotify}`, "_blank", "noopener,noreferrer");
  }

  handleDateChanged(date: string): void {
    if (this.session.snapshot.mode !== "daily" || date === this.budapestDate) return;
    this.budapestDate = date;
    if (this.session.snapshot.phase !== "result") {
      this.dailyDate = date;
      this.resetForMode("daily");
    }
  }

  handleVisibilityVisible(): void {
    if (this.session.snapshot.mode === "daily") this.dailyBoundary.reconcile();
  }

  handleVisibilityHidden(): void {
    const state = this.session.snapshot;
    const round = state.round;
    if (!round || !state.playbackRequested || state.phase === "result") return;
    this.clock.pause();
    this.playback.pause();
    this.loadingTrackVisible = false;
    this.session.setPlaybackState(round ? "paused" : "preparing", false);
    this.render();
  }

  onPending(round: Round): void {
    this.pendingRound = round;
    this.session.beginPreparing(round);
    if (this.session.snapshot.mode === "daily") {
      this.progress.markDailyStarted(this.dailyDate, round.track, this.session.snapshot.attempt);
    }
    this.render();
  }

  onAudioPlaying(round: Round): void {
    const wasPending = this.pendingRound?.id === round.id;
    this.loadingTrackVisible = false;
    if (wasPending) {
      this.pendingRound = null;
      this.session.beginPlaying(round);
      if (!isTimedMode(this.session.snapshot.mode)) this.clock.restartClassic(snippetSeconds(this.session.snapshot.attempt) * 1_000);
      this.clock.start();
      this.render();
      this.view.focusGuess();
      return;
    }
    if (this.session.snapshot.round?.id === round.id) {
      round.hasPlayed = true;
      this.session.setPlaybackState("playing", true);
      this.clock.start();
      this.render();
    }
  }

  onAudioWaiting(round: Round): void {
    if (this.playback.ownedRound?.id !== round.id) return;
    this.clock.pause();
    this.render();
  }

  onAudioBlocked(round: Round): void {
    if (this.playback.ownedRound?.id !== round.id) return;
    this.clock.pause();
    this.loadingTrackVisible = false;
    this.session.setPlaybackState(this.session.snapshot.round ? "paused" : "preparing", false);
    this.view.announce("PRESS PLAY TO START THE AUDIO.");
    this.render();
  }

  onAudioEnded(round: Round): void {
    const state = this.session.snapshot;
    if (state.round?.id !== round.id || !round.hasPlayed || state.phase === "result") return;
    this.clock.pause();
    round.hasPlayed = false;
    this.session.setPlaybackState("paused", false);
    if (isTimedMode(state.mode)) this.resolveAttempt("skip", null);
    else this.render();
  }

  onAudioRetry(message: string): void {
    this.clock.pause();
    this.pendingRound = null;
    this.session.setRetry();
    this.session.showTrackError(COPY.trackError);
    this.view.announce(message);
    this.render();
    this.view.focusPlay();
  }

  onLoading(visible: boolean): void {
    this.loadingTrackVisible = visible;
    if (visible) this.render();
  }

  onClockTick(snapshot: Parameters<GameView["renderClock"]>[0]): void { this.view.renderClock(snapshot); }
  onClockExpired(): void {
    const state = this.session.snapshot;
    if (this.finishing || state.phase === "result" || !state.round) return;
    if (isTimedMode(state.mode)) this.finishGame(false);
    else {
      this.playback.pause();
      this.session.setPlaybackState("paused", false);
      this.render();
    }
  }

  private handlePlay(shortcut: boolean): void {
    if (this.session.snapshot.mode === "daily") this.dailyBoundary.reconcile();
    const state = this.session.snapshot;
    if (this.appStatus !== "ready" || !state.mode || this.overlay || this.dailyCatalogPending() || (state.mode === "daily" && this.progress.dailyDone(this.dailyDate) && !state.round)) return;
    if (state.phase === "idle" || state.phase === "retry") {
      this.playback.start({ manualRetry: state.phase === "retry" });
      return;
    }
    if (state.phase === "preparing" && this.pendingRound && !state.playbackRequested) {
      this.session.setPlaybackState("preparing", true);
      this.render();
      this.playback.replay(this.pendingRound, false);
      return;
    }
    const round = state.round;
    if (!round || !["playing", "paused"].includes(state.phase)) return;
    if (isTimedMode(state.mode)) {
      if (state.playbackRequested) {
        this.clock.pause(); this.playback.pause(); this.session.setPlaybackState("paused", false); this.render(); this.view.focusGuess();
      } else {
        this.session.setPlaybackState("paused", true); this.render(); this.playback.replay(round, false); this.view.focusGuess();
      }
      return;
    }
    if (shortcut) {
      const snapshot = this.clock.pause();
      this.playback.pause(); round.hasPlayed = false; this.session.setPlaybackState("paused", true);
      this.clock.restartClassic(snippetSeconds(state.attempt) * 1_000);
      this.playback.replay(round, snapshot.elapsedMs > 0); this.render(); this.view.focusGuess();
    } else if (state.playbackRequested) {
      this.clock.pause(); this.playback.pause(); this.view.beginProgressReset(true);
      this.clock.restartClassic(snippetSeconds(state.attempt) * 1_000);
      this.session.setPlaybackState("paused", false); this.render(); this.view.focusGuess();
    } else {
      const elapsed = this.clock.snapshot().elapsedMs;
      round.hasPlayed = false; this.session.setPlaybackState("paused", true);
      this.clock.restartClassic(snippetSeconds(state.attempt) * 1_000);
      this.playback.replay(round, elapsed > 0); this.render(); this.view.focusGuess();
    }
  }

  private resolveAttempt(outcome: AttemptOutcome, guessed: Track | null): void {
    const state = this.session.snapshot;
    const round = state.round;
    const mode = state.mode;
    if (!round || !mode || !["playing", "paused"].includes(state.phase) || this.overlay || this.finishing) return;
    if (isTimedMode(mode)) {
      const snapshot = this.clock.pause();
      if (snapshot.expired || snapshot.remainingMs <= 0) { this.finishGame(false); return; }
    }
    if (outcome === "correct") this.progress.recordDiscovery(round.track.dailyNumber);
    if (isTimedMode(mode)) {
      this.playback.pause();
      this.session.resolveTimed(outcome, guessed?.title ?? "");
      this.view.announce(outcome === "correct" ? "CORRECT." : outcome === "wrong" ? "INCORRECT." : "SKIPPED.");
      if (mode === "survival") {
        const adjustment = survivalAdjustment(outcome);
        this.view.flashSurvivalChange(adjustment / 1_000);
        const snapshot = this.clock.adjust(adjustment);
        if (snapshot.expired || snapshot.remainingMs <= 0) { this.finishGame(false, round); return; }
      }
      this.render();
      this.playback.start({ seamless: true });
      return;
    }

    const clockWasRunning = state.playbackRequested && this.clock.snapshot().running;
    const resolution = this.session.resolveSixTry(outcome, guessed?.title ?? "");
    this.view.resetTransientUi();
    this.view.announce(outcome === "correct" ? "CORRECT." : outcome === "wrong" ? "INCORRECT. TRY AGAIN." : "SKIPPED. MORE TIME ADDED.");
    if (resolution.finished) { this.finishGame(outcome === "correct"); return; }
    if (mode === "daily" && this.progress.dailyInProgress(this.dailyDate)) this.progress.updateDailyStep(this.session.snapshot.attempt);
    const limit = snippetSeconds(this.session.snapshot.attempt) * 1_000;
    if (clockWasRunning) this.clock.extendClassic(limit);
    else {
      this.clock.restartClassic(limit);
      round.hasPlayed = false;
      this.session.setPlaybackState("paused", true);
      this.playback.replay(round, true);
    }
    this.render();
    this.view.focusGuess();
  }

  private finishGame(won: boolean, fallbackRound: Round | null = null): void {
    const state = this.session.snapshot;
    const round = state.round ?? fallbackRound;
    const mode = state.mode;
    if (!round || !mode || state.phase === "result" || this.finishing) return;
    this.finishing = true;
    const clock = this.clock.pause();
    this.playback.pause();
    const result = this.progress.finish({ mode, won, track: round.track, attempt: state.attempt, correct: state.correct, guesses: state.guesses, elapsedMs: clock.elapsedMs, dailyDate: this.dailyDate });
    this.session.finish(result);
    this.overlay = "result";
    this.view.resetTransientUi();
    this.render();
    this.view.modal.openResult();
    this.finishing = false;
  }

  private resetForMode(mode: GameMode): void {
    const previousTrackId = this.session.snapshot.previousTrackId;
    this.sessionNumber += 1;
    this.playback.stop();
    this.pendingRound = null;
    const resumed = mode === "daily" && this.progress.dailyInProgress(this.dailyDate) ? this.progress.daily.step : 0;
    this.session.reset(mode, resumed);
    const initial = MODE_RULES[mode].initialTimeMs;
    const milliseconds = initial ?? snippetSeconds(resumed) * 1_000;
    this.clock.configure(initial === null
      ? { kind: "classic", initialMs: milliseconds, limitMs: milliseconds }
      : { kind: mode === "survival" ? "survival" : "blitz", initialMs: milliseconds });
    this.playback.configure(mode, (failed, avoid) => this.createRound(mode, failed, avoid), previousTrackId);
    this.appStatus = this.tracks.length ? "ready" : this.appStatus;
    this.view.beginProgressReset();
    this.view.resetTransientUi();
    this.prime();
    this.render();
  }

  private createRound(mode: GameMode, failed: ReadonlySet<number>, avoid: number | null): Round | null {
    let track: Track | null;
    let clipStart: number;
    if (mode === "daily") {
      track = selectDailyTrack(this.tracks, this.dailyDate, this.progress.dailyInProgress(this.dailyDate) ? this.progress.daily.dailyNumber : null);
      if (!track) return null;
      clipStart = dailyClipStart(track, this.dailyDate);
    } else {
      track = selectRandomTrack(this.tracks, failed, avoid, this.random);
      if (!track) return null;
      clipStart = randomClipStart(track, isTimedMode(mode), this.random);
    }
    return { id: ++this.nextRoundId, track, clipStart, hasPlayed: false };
  }

  private prime(): void {
    const state = this.session.snapshot;
    if (!state.mode || !this.tracks.length || this.overlay || this.dailyCatalogPending() || (state.mode === "daily" && this.progress.dailyDone(this.dailyDate))) return;
    this.playback.prime();
  }

  private dailyCatalogPending(): boolean {
    const state = this.session.snapshot;
    return state.mode === "daily" && this.progress.dailyInProgress(this.dailyDate) && this.progress.daily.dailyNumber !== null && !isDailyTrackAvailable(this.tracks, this.dailyDate, this.progress.daily.dailyNumber);
  }

  private currentRulesText(): string {
    const state = this.session.snapshot;
    if (state.mode === "daily" && this.progress.dailyDone(this.dailyDate)) {
      return this.progress.daily.won ? "DAILY COMPLETE, YOU GOT IT!" : "DAILY COMPLETE, BETTER LUCK TOMORROW!";
    }
    if (this.appStatus === "loading") return COPY.loadingCatalog;
    if (this.appStatus === "error") return COPY.catalogError;
    if (!state.mode) return COPY.modePrompt;
    if (state.phase === "preparing" && this.loadingTrackVisible) return COPY.loadingTrack;
    if (state.phase === "retry") return COPY.trackError;
    if (state.mode === "daily") {
      if (this.dailyCatalogPending()) return COPY.trackUnavailable;
      if (this.progress.dailyInProgress(this.dailyDate)) return `DAILY IN PROGRESS, CONTINUE FROM ATTEMPT ${this.progress.daily.step + 1}`;
    }
    return MODE_RULES[state.mode].description;
  }

  private async refreshCatalog(date: string): Promise<void> {
    const generation = ++this.catalogGeneration;
    if (!this.tracks.length) this.appStatus = "loading";
    this.render();
    try {
      const tracks = await this.catalog.load(date);
      if (generation !== this.catalogGeneration) return;
      if (this.catalogRetryTimer) clearTimeout(this.catalogRetryTimer);
      this.tracks = tracks;
      this.appStatus = this.session.snapshot.mode ? "ready" : "awaiting-mode";
      this.prime();
      this.render();
      this.session.snapshot.mode ? this.view.focusPlay() : this.view.focusMode("daily");
    } catch (error) {
      if (generation !== this.catalogGeneration || (error instanceof DOMException && error.name === "AbortError") || this.tracks.length) return;
      this.appStatus = "error";
      this.view.announce(COPY.catalogError);
      if (this.catalogRetryTimer) clearTimeout(this.catalogRetryTimer);
      this.catalogRetryTimer = window.setTimeout(() => { this.catalogRetryTimer = 0; if (!this.tracks.length) void this.refreshCatalog(this.budapestDate); }, 5_000);
      this.render();
    }
  }

  private render(): void {
    const state = this.session.snapshot;
    const dailyBlocked = state.mode === "daily" && (this.dailyCatalogPending() || (this.progress.dailyDone(this.dailyDate) && !state.round));
    const playPhase = ["idle", "playing", "paused", "retry"].includes(state.phase) || (state.phase === "preparing" && this.pendingRound !== null && !state.playbackRequested);
    const inputVisible = !!state.round && ["playing", "paused"].includes(state.phase);
    const viewModel: GameViewModel = {
      appStatus: this.appStatus, mode: state.mode, phase: state.phase, rulesText: this.currentRulesText(), inputVisible,
      playEnabled: !!(this.appStatus === "ready" && state.mode && !this.overlay && !dailyBlocked && playPhase),
      attemptControlsEnabled: !!(this.appStatus === "ready" && state.round && !this.overlay && ["playing", "paused"].includes(state.phase)),
      playbackIcon: state.playbackRequested ? (isTimedMode(state.mode) ? "pause" : "stop") : "play",
      snippetSeconds: snippetSeconds(state.attempt), skipText: skipLabel(state.mode, state.attempt), currentSlot: state.currentSlot,
      history: state.history, clock: this.clock.snapshot(), result: state.result, dailyProgress: this.progress.daily,
      dailyDate: this.dailyDate, discoveries: this.progress.discoveries, tracks: this.tracks, overlay: this.overlay,
    };
    this.view.render(viewModel, String(this.sessionNumber), state.guessedTrackIds);
  }
}
