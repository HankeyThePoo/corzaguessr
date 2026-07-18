"use strict";

(() => {
  const ATTEMPT_SECONDS = [1, 2, 4, 8, 16, 32];
  const LAST_ATTEMPT_INDEX = ATTEMPT_SECONDS.length - 1;
  const MAX_SNIPPET_SECONDS = ATTEMPT_SECONDS.at(-1);
  const MAX_HISTORY_ENTRIES = 19;
  const TIMED_CLIP_SECONDS = 60;
  const FIRST_LOADING_NOTICE_MS = 180;
  const NEXT_LOADING_NOTICE_MS = 700;
  const AUDIO_WATCHDOG_MS = 10_000;
  const MAX_AUDIO_RECOVERY_ATTEMPTS = 2;
  const MAX_STANDBY_FAILURES = 2;
  const HAVE_METADATA = 1;

  const STORAGE_KEYS = {
    discoveries: "corzaguessrDiscovered",
    daily: "corzaguessrDaily",
    personalBests: "corzaguessrPersonalBests"
  };

  const TEXT = {
    modePrompt: "SELECT A MODE TO BEGIN",
    loadingTrack: "LOADING TRACK...",
    trackError: "COULD NOT PLAY TRACK, PRESS PLAY TO RETRY!",
    discovery: "REVEAL TRACKS YOU'VE GUESSED CORRECTLY AND TRACK YOUR DISCOVERY PROGRESS"
  };

  const MODE_CONFIG = {
    classic: {
      timed: false,
      description: "GUESS THE TRACK IN SIX TRIES AS MORE AUDIO IS REVEALED"
    },
    daily: {
      timed: false,
      description: "ONE SHARED TRACK EACH DAY, GUESS IT IN SIX TRIES"
    },
    blitz: {
      timed: true,
      initialTimeMs: 60_000,
      description: "GUESS AS MANY TRACKS AS POSSIBLE BEFORE THE TIMER RUNS OUT"
    },
    survival: {
      timed: true,
      initialTimeMs: 30_000,
      description: "CORRECT GUESSES ADD TIME; MISTAKES AND SKIPS DRAIN IT"
    }
  };

  const BUDAPEST_DATE_FORMATTER = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const PLAYBACK_ICON_PATHS = {
    play: "M8 5v14l11-7z",
    pause: "M6 5h4v14H6zM14 5h4v14h-4z",
    stop: "M7 7h10v10H7z"
  };

  function isTimedMode(mode) {
    return MODE_CONFIG[mode]?.timed === true;
  }

  function isValidDateKey(value) {
    if (typeof value !== "string") return false;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1) return false;

    const daysPerMonth = [
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
      31
    ];
    return day <= daysPerMonth[month - 1];
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function getAttemptSeconds(attempt) {
    const index = Math.max(0, Math.min(LAST_ATTEMPT_INDEX, attempt));
    return ATTEMPT_SECONDS[index];
  }

  function getSkipText(mode, attempt) {
    if (isTimedMode(mode)) return "SKIP";
    if (attempt >= LAST_ATTEMPT_INDEX) return "GIVE UP";
    return `ADD ${ATTEMPT_SECONDS[attempt + 1] - ATTEMPT_SECONDS[attempt]}S`;
  }

  function createSixTryPrompt(attempt) {
    const isLastAttempt = attempt === LAST_ATTEMPT_INDEX;
    return {
      text: isLastAttempt ? "LAST CHANCE TO GUESS" : `GUESS ${attempt + 1} OUT OF ${ATTEMPT_SECONDS.length}`,
      tone: isLastAttempt ? "blink prompt" : "prompt"
    };
  }

  function createTimedPrompt(roundNumber) {
    return {
      text: `GUESS #${roundNumber}`,
      tone: "prompt"
    };
  }

  function getSurvivalTimeChangeMs(outcome) {
    return outcome === "correct" ? 3_000 : outcome === "wrong" ? -1_000 : -2_000;
  }

  function calculateAccuracy(correct, guesses) {
    return guesses > 0 ? Math.round(correct * 100 / guesses) : 0;
  }

  function normalizeNonNegativeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  function normalizeAccuracy(value) {
    return Number.isSafeInteger(value) && value >= 0 && value <= 100 ? value : null;
  }

  function sanitizeDailyProgress(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const date = typeof source.date === "string" && isValidDateKey(source.date) ? source.date : "";
    const dailyNumber = Number.isSafeInteger(source.dailyNumber) && source.dailyNumber > 0
      ? source.dailyNumber
      : null;
    const hasIdentity = date !== "" && dailyNumber !== null;
    const started = source.started === true && hasIdentity;
    const completed = started && source.completed === true;
    const step = Number.isSafeInteger(source.step) && source.step >= 0 && source.step < ATTEMPT_SECONDS.length
      ? source.step
      : 0;

    return {
      date: hasIdentity ? date : "",
      dailyNumber: hasIdentity ? dailyNumber : null,
      started,
      completed,
      won: completed && source.won === true,
      step
    };
  }

  function sanitizePersonalBests(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const classicSource = source.classic && typeof source.classic === "object" && !Array.isArray(source.classic)
      ? source.classic
      : {};

    let current = normalizeNonNegativeInteger(classicSource.current);
    let snippetTotal = normalizeNonNegativeInteger(classicSource.snippetTotal);
    if (snippetTotal < current || snippetTotal > current * MAX_SNIPPET_SECONDS) {
      current = 0;
      snippetTotal = 0;
    }

    const best = Math.max(current, normalizeNonNegativeInteger(classicSource.best));
    let bestSnippetTotal = normalizeNonNegativeInteger(classicSource.bestSnippetTotal);
    if (bestSnippetTotal < best || bestSnippetTotal > best * MAX_SNIPPET_SECONDS) {
      bestSnippetTotal = current === best ? snippetTotal : 0;
    }

    const sanitizeTimedBest = entry => {
      const timedSource = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
      return {
        score: normalizeNonNegativeInteger(timedSource.score),
        accuracy: normalizeAccuracy(timedSource.accuracy)
      };
    };

    const survival = sanitizeTimedBest(source.survival);
    survival.score = Math.floor(survival.score / 1_000) * 1_000;

    return {
      classic: {
        current,
        best,
        snippetTotal,
        bestSnippetTotal
      },
      daily: normalizeNonNegativeInteger(source.daily),
      blitz: sanitizeTimedBest(source.blitz),
      survival
    };
  }

  function updateDailyBest(personalBests, won, attempts) {
    if (!won || personalBests.daily && attempts >= personalBests.daily) return false;
    personalBests.daily = attempts;
    return true;
  }

  function updateClassicBest(personalBests, won, attempt) {
    const classic = personalBests.classic;
    if (won) {
      classic.current += 1;
      classic.snippetTotal += getAttemptSeconds(attempt);
      const average = classic.snippetTotal / classic.current;
      const newPersonalBest = classic.current > classic.best || (
        classic.current === classic.best && (!classic.bestSnippetTotal || classic.snippetTotal < classic.bestSnippetTotal)
      );

      if (newPersonalBest) {
        classic.best = classic.current;
        classic.bestSnippetTotal = classic.snippetTotal;
      }

      return {
        changed: true,
        newPersonalBest,
        streak: classic.current,
        average
      };
    }

    const streak = classic.current;
    const average = classic.current ? classic.snippetTotal / classic.current : 0;
    const changed = classic.current !== 0 || classic.snippetTotal !== 0;
    classic.current = 0;
    classic.snippetTotal = 0;

    return {
      changed,
      newPersonalBest: false,
      streak,
      average
    };
  }

  function updateTimedBest(personalBests, mode, score, accuracy) {
    const currentBest = personalBests[mode];
    const higherScore = score > currentBest.score;
    const betterBlitzTie = mode === "blitz" && score > 0 && score === currentBest.score &&
      accuracy > (currentBest.accuracy ?? -1);

    if (!higherScore && !betterBlitzTie) return false;
    personalBests[mode] = { score, accuracy };
    return true;
  }

  function getBudapestDateKey(date = new Date()) {
    const parts = Object.fromEntries(BUDAPEST_DATE_FORMATTER.formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function getDailyProgressState(progress, date) {
    if (progress.date !== date || !progress.started) return "not-started";
    if (!progress.completed) return "in-progress";
    return progress.won ? "won" : "lost";
  }

  function createGameState(mode) {
    const config = mode ? MODE_CONFIG[mode] : null;
    return {
      mode,
      run: !config ? null : config.timed ? {
        kind: "timed",
        next: null,
        roundNumber: 0,
        guesses: 0,
        correct: 0,
        nextFailures: 0
      } : {
        kind: "six-try",
        attempt: 0
      },
      current: null,
      currentSlot: null,
      history: [],
      previousTrackId: null,
      failedTrackIds: new Set(),
      guessedTrackIds: new Set(),
      result: null
    };
  }

  function isAudioBusy(phase) {
    return phase === "starting" || phase === "playing" || phase === "buffering";
  }

  function canResolveAttempt(phase, round) {
    return phase === "playing" || (
      (phase === "paused" || phase === "starting" || phase === "buffering") && round.playedOnce
    );
  }

  class ProgressService {
    discoveries = new Set();
    daily = sanitizeDailyProgress();
    personalBests = sanitizePersonalBests();
    discoveryRevision = 0;

    constructor(repository, announce) {
      this.repository = repository;
      this.announce = announce;
    }

    load() {
      const saved = this.repository.load();
      this.discoveries = saved.discoveries;
      this.daily = saved.daily;
      this.personalBests = saved.personalBests;
      this.discoveryRevision += 1;
    }

    dailyState(date) {
      return getDailyProgressState(this.daily, date);
    }

    dailyInProgress(date) {
      return this.dailyState(date) === "in-progress";
    }

    dailyComplete(date) {
      const state = this.dailyState(date);
      return state === "won" || state === "lost";
    }

    dailyCompletionText(date) {
      const attempts = this.daily.step + 1;
      const result = this.dailyState(date) === "won" ? "COMPLETED" : "FAILED";
      return `${result} IN ${attempts} ATTEMPT${attempts === 1 ? "" : "S"}, COME BACK TOMORROW`;
    }

    markDailyStarted(date, dailyNumber, step) {
      if (this.dailyState(date) !== "not-started") return;
      this.daily = {
        date,
        dailyNumber,
        started: true,
        completed: false,
        won: false,
        step
      };
      this.saveDaily();
    }

    updateDailyStep(date, step) {
      if (!this.dailyInProgress(date) || this.daily.step === step) return;
      this.daily = { ...this.daily, step };
      this.saveDaily();
    }

    recordDiscovery(dailyNumber) {
      if (this.discoveries.has(dailyNumber)) return;
      this.discoveries.add(dailyNumber);
      this.discoveryRevision += 1;
      if (!this.repository.saveDiscoveries(this.discoveries)) {
        this.announce("DISCOVERY PROGRESS COULD NOT BE SAVED IN THIS BROWSER.");
      }
    }

    resetDiscoveries() {
      if (!this.repository.saveDiscoveries(new Set())) return false;
      this.discoveries.clear();
      this.discoveryRevision += 1;
      return true;
    }

    buildResult(mode, run) {
      let result;
      let personalBestChanged = false;

      if (mode === "daily") {
        const won = run.won === true;
        this.daily = {
          date: run.dailyDate,
          dailyNumber: run.track.dailyNumber,
          started: true,
          completed: true,
          won,
          step: run.attempt
        };
        this.saveDaily();

        const newPersonalBest = updateDailyBest(this.personalBests, won, run.attempt + 1);
        personalBestChanged = newPersonalBest;
        result = {
          mode,
          won,
          trackTitle: run.track.title,
          spotify: run.track.spotify,
          newPersonalBest,
          attempts: run.attempt + 1,
          bestAttempts: this.personalBests.daily
        };
      } else if (mode === "classic") {
        const won = run.won === true;
        const update = updateClassicBest(this.personalBests, won, run.attempt);
        const classic = this.personalBests.classic;
        personalBestChanged = update.changed;
        result = {
          mode,
          won,
          trackTitle: run.track.title,
          spotify: run.track.spotify,
          newPersonalBest: update.newPersonalBest,
          streak: update.streak,
          average: update.average,
          bestStreak: classic.best,
          bestAverage: classic.best ? classic.bestSnippetTotal / classic.best : 0
        };
      } else if (mode === "blitz") {
        const accuracy = calculateAccuracy(run.correct, run.guesses);
        const newPersonalBest = updateTimedBest(this.personalBests, mode, run.correct, accuracy);
        personalBestChanged = newPersonalBest;
        result = {
          mode,
          newPersonalBest,
          correct: run.correct,
          accuracy,
          bestCorrect: this.personalBests.blitz.score,
          bestAccuracy: this.personalBests.blitz.accuracy
        };
      } else {
        const elapsedMs = Math.floor(run.elapsedMs / 1_000) * 1_000;
        const accuracy = calculateAccuracy(run.correct, run.guesses);
        const newPersonalBest = updateTimedBest(this.personalBests, mode, elapsedMs, accuracy);
        personalBestChanged = newPersonalBest;
        result = {
          mode,
          newPersonalBest,
          elapsedMs,
          accuracy,
          bestElapsedMs: this.personalBests.survival.score,
          bestAccuracy: this.personalBests.survival.accuracy
        };
      }

      if (personalBestChanged) this.savePersonalBests();
      return result;
    }

    saveDaily() {
      if (!this.repository.saveDaily(this.daily)) {
        this.announce("DAILY PROGRESS COULD NOT BE SAVED IN THIS BROWSER.");
      }
    }

    savePersonalBests() {
      if (!this.repository.savePersonalBests(this.personalBests)) {
        this.announce("PERSONAL BESTS COULD NOT BE SAVED IN THIS BROWSER.");
      }
    }
  }

  class PlaybackCoordinator {
    status = "";
    loadingTimer = 0;
    loadingAnnouncementRoundId = null;
    watchdog = null;
    recoveryAttempts = null;

    constructor({ clock, audio, announce, onStatusChanged, onWatchdogFailure, getCurrentRound, getAudioPhase }) {
      this.clock = clock;
      this.audio = audio;
      this.announce = announce;
      this.onStatusChanged = onStatusChanged;
      this.onWatchdogFailure = onWatchdogFailure;
      this.getCurrentRound = getCurrentRound;
      this.getAudioPhase = getAudioPhase;
    }

    halt({
      pauseClock = true,
      pauseAudio = false,
      stopAudio = false,
      releaseActivePhase,
      cancelWatchdog = true,
      clearStatus = true
    } = {}) {
      if (pauseClock) this.clock.pause();
      if (stopAudio) this.audio.stop();
      else if (releaseActivePhase !== undefined) this.audio.releaseActive(releaseActivePhase);
      else if (pauseAudio) this.audio.pause();
      if (cancelWatchdog) this.cancelWatchdog();
      if (clearStatus) this.clearStatus();
    }

    setStatus(status, announce = false) {
      this.clearStatus();
      this.status = status;
      if (announce) this.announce(status);
    }

    beginLoadingNotice(round, delayMs) {
      this.clearStatus();
      this.loadingTimer = window.setTimeout(() => {
        this.loadingTimer = 0;
        const current = this.getCurrentRound();
        const phase = this.getAudioPhase();
        if (current?.id === round.id && (phase === "starting" || phase === "buffering")) {
          this.status = TEXT.loadingTrack;
          this.onStatusChanged();
        }
      }, delayMs);
    }

    revealLoading() {
      if (this.loadingTimer) clearTimeout(this.loadingTimer);
      this.loadingTimer = 0;
      this.status = TEXT.loadingTrack;
    }

    clearStatus() {
      if (this.loadingTimer) clearTimeout(this.loadingTimer);
      this.loadingTimer = 0;
      this.status = "";
    }

    announceLoading(round) {
      if (this.loadingAnnouncementRoundId === round.id) return;
      this.loadingAnnouncementRoundId = round.id;
      this.announce("TRACK IS LOADING.");
    }

    resetLoadingAnnouncement() {
      this.loadingAnnouncementRoundId = null;
    }

    armWatchdog(round) {
      this.cancelWatchdog();
      const timer = window.setTimeout(() => {
        if (!this.watchdog || this.watchdog.timer !== timer) return;
        this.watchdog = null;
        const current = this.getCurrentRound();
        const phase = this.getAudioPhase();
        if (current?.id === round.id && (phase === "starting" || phase === "buffering")) {
          this.onWatchdogFailure({
            role: "active",
            roundId: round.id,
            trackId: round.track.dailyNumber,
            previousPhase: phase
          });
        }
      }, AUDIO_WATCHDOG_MS);
      this.watchdog = { timer };
    }

    cancelWatchdog() {
      if (this.watchdog) clearTimeout(this.watchdog.timer);
      this.watchdog = null;
    }

    claimRecovery() {
      if (this.recoveryAttempts === null) this.recoveryAttempts = 0;
      if (this.recoveryAttempts >= MAX_AUDIO_RECOVERY_ATTEMPTS) return false;
      this.recoveryAttempts += 1;
      return true;
    }

    endRecovery() {
      this.recoveryAttempts = null;
    }

    stop({ pauseClock = true } = {}) {
      this.halt({ pauseClock, stopAudio: true });
      this.endRecovery();
    }
  }

  class GameController {
    model = createGameState(null);
    dailyDate = "1970-01-01";
    nextRoundId = 0;
    historySequence = 0;
    historyRevision = 0;
    currentSlotRevision = 0;
    guessedRevision = 0;
    finishing = false;

    constructor({ catalog, progress, clock, audio, view, dailyBoundary }) {
      this.catalog = catalog;
      this.progress = progress;
      this.clock = clock;
      this.audio = audio;
      this.view = view;
      this.dailyBoundary = dailyBoundary;
      this.playback = new PlaybackCoordinator({
        clock,
        audio,
        announce: message => view.announce(message),
        onStatusChanged: () => this.render(),
        onWatchdogFailure: failure => this.onAudioFailure(failure),
        getCurrentRound: () => this.model.current,
        getAudioPhase: () => audio.phase
      });
    }

    get modeConfig() {
      return this.model.mode ? MODE_CONFIG[this.model.mode] : null;
    }

    get timedRun() {
      return this.model.run?.kind === "timed" ? this.model.run : null;
    }

    get sixTryRun() {
      return this.model.run?.kind === "six-try" ? this.model.run : null;
    }

    get attempt() {
      return this.sixTryRun?.attempt ?? 0;
    }

    set attempt(value) {
      if (this.sixTryRun) this.sixTryRun.attempt = value;
    }

    get roundNumber() {
      return this.timedRun?.roundNumber ?? 0;
    }

    get isResult() {
      return this.model.result !== null;
    }

    get isDailyComplete() {
      return this.model.mode === "daily" && this.progress.dailyComplete(this.dailyDate);
    }

    bootstrap(date) {
      this.progress.load();
      this.dailyDate = date;
      this.render();
      this.view.focusMode("daily");
    }

    selectMode(mode) {
      if (this.view.modal.isBlocking || this.model.mode === mode) return;
      if (mode === "daily") this.dailyDate = this.dailyBoundary.start();
      else this.dailyBoundary.stop();
      this.resetForMode(mode);
      this.view.announce(MODE_CONFIG[mode].description);
      this.focusRecommendedPrimary();
    }

    play() {
      this.handlePlay(false);
    }

    playbackShortcut() {
      this.handlePlay(true);
    }

    skip() {
      const round = this.model.current;
      if (round && this.modeConfig?.timed && !round.playedOnce && isAudioBusy(this.audio.phase)) {
        this.playback.announceLoading(round);
        return;
      }
      this.resolveAttempt("skip", null);
    }

    guess(dailyNumber) {
      const round = this.model.current;
      if (!round || this.view.modal.isBlocking) return;

      if (!round.playedOnce && (this.audio.phase === "paused" || isAudioBusy(this.audio.phase))) {
        if (this.modeConfig?.timed && this.model.currentSlot) this.playback.announceLoading(round);
        return;
      }

      if (!canResolveAttempt(this.audio.phase, round) || this.model.guessedTrackIds.has(dailyNumber)) return;
      const track = this.catalog.get(dailyNumber);
      if (!track) return;

      this.model.guessedTrackIds.add(dailyNumber);
      this.guessedRevision += 1;
      this.resolveAttempt(dailyNumber === round.track.dailyNumber ? "correct" : "wrong", track);
    }

    newGame() {
      if (!this.model.mode) return;
      if (this.view.modal.openKind === "result") {
        this.view.modal.close("result", {
          beforeClose: () => this.resetAfterResult(),
          afterClose: () => {
            this.render();
            this.focusRecommendedPrimary(true);
          }
        });
        return;
      }
      this.resetForMode(this.model.mode);
    }

    openDiscovery() {
      if (this.view.modal.openKind === "discovery") {
        this.closeDiscovery();
        return;
      }
      if (this.view.modal.isBlocking || this.isResult) return;

      const round = this.model.current;
      if (round) {
        if (isAudioBusy(this.audio.phase)) this.playback.halt();
        this.audio.suspend(round.id);
      }
      this.view.modal.openDiscovery();
      this.view.resetTransientUi();
      this.render();
    }

    closeDiscovery() {
      if (this.view.modal.openKind !== "discovery") return;
      this.view.modal.close("discovery", {
        afterClose: () => {
          const round = this.model.current;
          if (round) {
            const terminal = this.audio.restore(round.id);
            if (terminal?.type === "ended") this.onAudioEnded(round.id, false);
            else if (terminal?.type === "failed") {
              this.onAudioFailure({
                role: "active",
                roundId: round.id,
                trackId: round.track.dailyNumber,
                previousPhase: terminal.previousPhase
              });
            }
          }
          this.prefetchNextRound();
          this.render();
          if (this.model.mode) this.focusRecommendedPrimary(true);
        }
      });
    }

    resetDiscovery() {
      if (this.view.modal.openKind !== "discovery") return;
      if (!this.progress.resetDiscoveries()) {
        this.view.announce("DISCOVERY COULD NOT BE RESET IN THIS BROWSER.");
        return;
      }
      this.view.announce("DISCOVERY RESET.");
      this.render();
    }

    openSpotify() {
      const result = this.model.result;
      const spotify = result?.mode === "classic" || result?.mode === "daily" ? result.spotify : "";
      if (spotify) window.open(`https://open.spotify.com/track/${spotify}`, "_blank", "noopener,noreferrer");
    }

    handleDateChanged(date) {
      if (this.model.mode !== "daily" || this.isResult) return;
      this.dailyDate = date;
      this.resetForMode("daily");
    }

    handleVisibilityVisible() {
      if (this.model.mode === "daily") this.dailyBoundary.reconcile();
    }

    handleVisibilityHidden() {
      const round = this.model.current;
      if (!round || !isAudioBusy(this.audio.phase) || this.isResult) return;
      this.playback.halt({ pauseAudio: true });
      this.render();
    }

    onAudioPlaying(roundId) {
      const round = this.model.current;
      if (!round || round.id !== roundId || this.audio.phase !== "playing") return;

      round.playedOnce = true;
      this.playback.cancelWatchdog();
      this.playback.clearStatus();
      this.playback.endRecovery();
      this.model.failedTrackIds.clear();
      if (this.model.mode !== "daily") this.model.previousTrackId = round.track.dailyNumber;
      this.model.guessedTrackIds.clear();
      this.guessedRevision += 1;
      this.showCurrentPrompt();
      this.clock.start();
      this.render();
      this.view.focusGuess();
    }

    onAudioWaiting({ roundId }) {
      const round = this.model.current;
      if (!round || round.id !== roundId || this.audio.phase !== "buffering") return;

      const wasRunning = this.clock.isRunning;
      this.clock.pause();
      if (wasRunning) this.playback.armWatchdog(round);

      const delayedTimedLoad = this.modeConfig?.timed && this.roundNumber > 1 && !round.playedOnce &&
        this.playback.loadingTimer !== 0;
      if (!delayedTimedLoad && this.playback.status !== TEXT.loadingTrack) this.playback.revealLoading();
      this.render();
    }

    onAudioBlocked(roundId) {
      const round = this.model.current;
      if (!round || round.id !== roundId) return;
      this.playback.halt({ clearStatus: false });
      this.playback.setStatus("PRESS PLAY TO START THE AUDIO.", true);
      this.render();
    }

    onAudioEnded(roundId, autoplayNext = true) {
      const round = this.model.current;
      if (!round || round.id !== roundId || !round.playedOnce || this.isResult) return;
      this.playback.halt({ pauseAudio: true });
      if (this.modeConfig?.timed) this.resolveAttempt("skip", null, { autoplayNext });
      else this.render();
    }

    onAudioFailure(failure) {
      const timedRun = this.timedRun;
      if (failure.role === "standby") {
        if (timedRun?.next?.id !== failure.roundId) return;
        timedRun.next = null;
        if (failure.trackId !== null) this.model.failedTrackIds.add(failure.trackId);
        timedRun.nextFailures += 1;
        if (timedRun.nextFailures < MAX_STANDBY_FAILURES) queueMicrotask(() => this.prefetchNextRound());
        return;
      }

      const round = this.model.current;
      if (!round || round.id !== failure.roundId || this.isResult) return;
      const wasBusy = isAudioBusy(failure.previousPhase);
      this.playback.halt({ releaseActivePhase: "failed" });
      if (this.model.mode !== "daily") this.model.failedTrackIds.add(round.track.dailyNumber);

      const canReplace = this.model.mode !== "daily" && !(this.model.mode === "classic" && round.playedOnce) &&
        this.playback.claimRecovery();
      if (canReplace) {
        this.view.announce("THE SELECTED TRACK COULD NOT BE PLAYED. TRYING ANOTHER.");
        if (this.replaceCurrent(round, wasBusy)) return;
      }
      this.enterFailedState();
    }

    onClockTick(snapshot) {
      this.view.renderClock(this.createClockView(snapshot));
    }

    onClockExpired() {
      if (this.finishing || this.isResult || !this.model.current) return;
      if (this.modeConfig?.timed) this.finishGame();
      else {
        this.playback.halt({ pauseClock: false, pauseAudio: true });
        this.render();
      }
    }

    finishIfExpired(snapshot) {
      if (!snapshot.expired) return false;
      this.finishGame();
      return true;
    }

    handlePlay(restartShortcut) {
      if (this.model.mode === "daily") this.dailyBoundary.reconcile();
      const round = this.model.current;
      if (!this.model.mode || !round || this.view.modal.isBlocking || this.isDailyComplete || this.isResult) return;

      if (this.audio.phase === "failed") {
        this.playback.endRecovery();
        this.showCurrentPrompt();
        if (!this.stageRound(round, "prepare")) return;
        this.requestPreparedPlayback(round, false, FIRST_LOADING_NOTICE_MS);
        return;
      }

      if (!round.playedOnce && this.audio.phase === "paused") {
        this.showCurrentPrompt();
        this.requestPreparedPlayback(round, false, FIRST_LOADING_NOTICE_MS);
        return;
      }

      if (this.modeConfig?.timed) this.handleTimedPlayback(round);
      else this.handleSixTryPlayback(round, restartShortcut);
    }

    handleSixTryPlayback(round, restartShortcut) {
      if (restartShortcut && round.playedOnce && ["playing", "paused", "buffering", "starting"].includes(this.audio.phase)) {
        const elapsedMs = this.clock.pauseAndSnapshot().elapsedMs;
        this.audio.pause();
        this.playback.cancelWatchdog();
        this.restartUntimedPlayback(round, getAttemptSeconds(this.attempt) * 1_000, elapsedMs);
        return;
      }

      if (isAudioBusy(this.audio.phase)) {
        this.playback.halt({ pauseAudio: true });
        this.view.beginProgressReset(true);
        this.clock.restartClassic(getAttemptSeconds(this.attempt) * 1_000);
        this.render();
        this.view.focusGuess();
        return;
      }

      if (this.audio.phase !== "paused") return;
      const elapsedMs = this.clock.snapshot().elapsedMs;
      this.restartUntimedPlayback(round, getAttemptSeconds(this.attempt) * 1_000, elapsedMs);
    }

    handleTimedPlayback(round) {
      if (isAudioBusy(this.audio.phase)) {
        this.playback.halt({ pauseAudio: true });
        this.render();
        this.view.focusGuess();
        return;
      }
      if (this.audio.phase === "paused") {
        this.requestPreparedPlayback(round, false, FIRST_LOADING_NOTICE_MS);
      }
    }

    resolveAttempt(outcome, guessedTrack, options = {}) {
      const round = this.model.current;
      const mode = this.model.mode;
      if (!round || !mode || !canResolveAttempt(this.audio.phase, round) || this.view.modal.isBlocking || this.finishing) {
        return;
      }

      if (this.modeConfig?.timed && this.finishIfExpired(this.clock.pauseAndSnapshot())) return;
      if (outcome === "correct") this.progress.recordDiscovery(round.track.dailyNumber);

      if (this.modeConfig?.timed) {
        this.resolveTimedAttempt(mode, outcome, guessedTrack, options.autoplayNext !== false);
      } else {
        this.resolveSixTryAttempt(round, mode, outcome, guessedTrack);
      }
    }

    resolveSixTryAttempt(round, mode, outcome, guessedTrack) {
      const slot = this.createAttemptSlot(mode, outcome, guessedTrack?.title ?? "");
      const isFinal = outcome === "correct" || this.attempt === LAST_ATTEMPT_INDEX;

      if (isFinal) this.setCurrentSlot(slot);
      else this.archiveAttempt(slot);

      this.view.announce(
        outcome === "correct" ? "CORRECT." : outcome === "wrong" ? "INCORRECT. TRY AGAIN." : "SKIPPED. MORE TIME ADDED."
      );

      if (isFinal) {
        this.finishGame(outcome === "correct");
        return;
      }

      const clock = this.clock.snapshot();
      this.attempt += 1;
      this.showCurrentPrompt();
      if (mode === "daily") this.progress.updateDailyStep(this.dailyDate, this.attempt);
      const nextLimitMs = getAttemptSeconds(this.attempt) * 1_000;

      if (clock.running) {
        this.clock.extendClassic(nextLimitMs);
        this.render();
        this.view.focusGuess();
        return;
      }
      this.restartUntimedPlayback(round, nextLimitMs, clock.elapsedMs);
    }

    resolveTimedAttempt(mode, outcome, guessedTrack, autoplayNext) {
      const run = this.timedRun;
      if (!run) return;

      this.archiveAttempt(this.createAttemptSlot(mode, outcome, guessedTrack?.title ?? ""));
      this.view.announce(outcome === "correct" ? "CORRECT." : outcome === "wrong" ? "INCORRECT." : "SKIPPED.");
      this.playback.halt({ pauseClock: false, pauseAudio: true });

      if (outcome !== "skip") run.guesses += 1;
      if (outcome === "correct") run.correct += 1;

      if (mode === "survival") {
        const changeMs = getSurvivalTimeChangeMs(outcome);
        this.view.flashSurvivalChange(changeMs / 1_000);
        if (this.finishIfExpired(this.clock.adjust(changeMs))) return;
      }

      run.roundNumber += 1;
      this.advanceTimedRound(autoplayNext);
    }

    advanceTimedRound(autoplay = true) {
      const current = this.model.current;
      const run = this.timedRun;
      if (!current || !run) return;

      const prepared = run.next;
      const next = prepared ?? this.createRound(current.track.dailyNumber);
      this.model.current = next;
      run.next = null;
      run.nextFailures = 0;
      this.showCurrentPrompt();

      if (!this.stageRound(next, prepared ? "promote" : "prepare")) return;
      if (this.model.current.id !== next.id) return;

      this.prefetchNextRound();
      if (autoplay) this.requestPreparedPlayback(next, false, NEXT_LOADING_NOTICE_MS);
      else this.render();
    }

    restartUntimedPlayback(round, limitMs, elapsedMs) {
      if (elapsedMs > 0) this.view.beginProgressReset(true);
      this.clock.restartClassic(limitMs);
      if (this.model.current?.id === round.id && !this.isResult && !this.view.modal.isBlocking) {
        this.requestPreparedPlayback(round, true, FIRST_LOADING_NOTICE_MS);
      }
    }

    finishGame(won) {
      const round = this.model.current;
      const mode = this.model.mode;
      if (!round || !mode || this.isResult || this.finishing) return;

      this.finishing = true;
      try {
        const clock = this.clock.pauseAndSnapshot();
        const timedRun = this.timedRun;
        if (timedRun) timedRun.next = null;
        this.playback.stop({ pauseClock: false });

        if (this.modeConfig?.timed) {
          this.setCurrentSlot({ text: "TIME'S UP", tone: "" });
        }

        this.model.result = this.progress.buildResult(mode, {
          won: won === true,
          track: round.track,
          attempt: this.attempt,
          correct: timedRun?.correct ?? 0,
          guesses: timedRun?.guesses ?? 0,
          elapsedMs: clock.elapsedMs,
          dailyDate: this.dailyDate
        });

        this.view.modal.openResult();
        this.view.resetTransientUi();
        this.render();
      } finally {
        this.finishing = false;
      }
    }

    resetAfterResult() {
      const mode = this.model.mode;
      if (!mode) return;
      if (mode === "daily") this.dailyDate = this.dailyBoundary.current();
      this.resetForMode(mode);
    }

    resetForMode(mode) {
      const previousTrackId = this.model.previousTrackId;
      this.playback.stop({ pauseClock: false });
      this.model = createGameState(mode);
      this.model.previousTrackId = previousTrackId;
      this.historyRevision += 1;
      this.currentSlotRevision += 1;
      this.guessedRevision += 1;

      if (mode === "daily" && this.progress.dailyInProgress(this.dailyDate)) {
        this.attempt = this.progress.daily.step;
      }

      const config = MODE_CONFIG[mode];
      const initialMs = config.initialTimeMs ?? getAttemptSeconds(this.attempt) * 1_000;
      this.view.beginProgressReset();
      this.clock.configure({
        kind: config.timed ? "timed" : "classic",
        initialMs,
        limitMs: config.timed ? undefined : initialMs
      });
      this.view.resetTransientUi();
      if (!this.isDailyComplete) this.primeCurrent();
      this.render();
    }

    stageRound(round, operation) {
      if (operation === "promote") return this.audio.promote(round.id);
      if (operation === "preload") return this.audio.preload(round);
      return this.audio.prepare(round);
    }

    primeCurrent() {
      if (!this.model.mode || this.model.current || this.view.modal.blocksRoundPreparation) return;
      const round = this.createRound();
      this.model.current = round;
      if (!this.stageRound(round, "prepare")) return;
      if (this.model.current?.id === round.id) this.prefetchNextRound();
    }

    prefetchNextRound() {
      const run = this.timedRun;
      const current = this.model.current;
      if (!run || !current || run.next || run.nextFailures >= MAX_STANDBY_FAILURES ||
          this.view.modal.blocksRoundPreparation || this.isResult) {
        return;
      }

      const next = this.createRound(current.track.dailyNumber);
      run.next = next;
      this.stageRound(next, "preload");
    }

    replaceCurrent(failedRound, autoplay) {
      const run = this.timedRun;
      const prepared = run?.next ?? null;
      const replacement = prepared ?? this.createRound(failedRound.track.dailyNumber);
      this.model.current = replacement;
      if (run && prepared) run.next = null;
      if (run) run.nextFailures = 0;
      this.playback.resetLoadingAnnouncement();

      if (!this.stageRound(replacement, prepared ? "promote" : "prepare")) {
        return this.model.current?.id !== replacement.id;
      }

      if (this.model.current?.id === replacement.id) {
        this.prefetchNextRound();
        if (autoplay) this.requestPreparedPlayback(replacement, false, FIRST_LOADING_NOTICE_MS);
        else {
          this.render();
          this.view.focusPlay();
        }
      }
      return true;
    }

    createRound(previousTrackId = this.model.previousTrackId) {
      const mode = this.model.mode;
      const track = mode === "daily"
        ? this.catalog.dailyTrack(
          this.dailyDate,
          this.progress.dailyInProgress(this.dailyDate) ? this.progress.daily.dailyNumber : null
        )
        : this.catalog.randomTrack(this.model.failedTrackIds, previousTrackId);

      return {
        id: ++this.nextRoundId,
        track,
        clipStart: mode === "daily"
          ? this.catalog.dailyClipStart(track, this.dailyDate)
          : this.catalog.randomClipStart(track, this.modeConfig?.timed === true),
        playedOnce: false
      };
    }

    createAttemptSlot(mode, outcome, guessedTitle) {
      let text = guessedTitle;
      if (outcome === "skip") {
        if (isTimedMode(mode)) text = "SKIPPED";
        else {
          const isLastAttempt = this.attempt === LAST_ATTEMPT_INDEX;
          const secondsAdded = isLastAttempt ? 0 : getAttemptSeconds(this.attempt + 1) - getAttemptSeconds(this.attempt);
          text = isLastAttempt
            ? "FINAL GUESS SKIPPED"
            : `GUESS ${this.attempt + 1} SKIPPED, ${secondsAdded} SECOND${secondsAdded === 1 ? "" : "S"} ADDED`;
        }
      }
      return { text, tone: outcome };
    }

    archiveAttempt(slot) {
      const history = this.model.history;
      history.unshift({
        key: `history-${++this.historySequence}`,
        ...slot
      });
      if (this.modeConfig?.timed && history.length > MAX_HISTORY_ENTRIES) history.length = MAX_HISTORY_ENTRIES;
      this.historyRevision += 1;
      this.view.resetTransientUi();
    }

    setCurrentSlot(slot) {
      const current = this.model.currentSlot;
      if (current?.text === slot?.text && current?.tone === slot?.tone) return;
      this.model.currentSlot = slot;
      this.currentSlotRevision += 1;
    }

    showCurrentPrompt() {
      if (!this.model.mode) return;
      const run = this.timedRun;
      if (run && run.roundNumber === 0) run.roundNumber = 1;
      this.setCurrentSlot(run ? createTimedPrompt(run.roundNumber) : createSixTryPrompt(this.attempt));
    }

    requestPreparedPlayback(round, restart, loadingDelayMs) {
      if (this.model.current?.id !== round.id) return false;
      if (this.model.mode === "daily") {
        this.progress.markDailyStarted(this.dailyDate, round.track.dailyNumber, this.attempt);
      }
      this.playback.resetLoadingAnnouncement();
      this.playback.beginLoadingNotice(round, loadingDelayMs);
      this.playback.armWatchdog(round);
      const started = this.audio.playPrepared(round, restart);
      this.render();
      return started;
    }

    enterFailedState() {
      this.playback.cancelWatchdog();
      this.playback.setStatus(TEXT.trackError);
      this.view.announce("THE SELECTED TRACK COULD NOT BE PLAYED. PRESS PLAY TO RETRY.");
      this.render();
      this.view.focusPlay();
    }

    currentRulesText() {
      if (this.isDailyComplete && !this.isResult) return this.progress.dailyCompletionText(this.dailyDate);
      const mode = this.model.mode;
      if (!mode) return TEXT.modePrompt;
      if (mode === "daily" && this.progress.dailyInProgress(this.dailyDate)) {
        return `DAILY IN PROGRESS, CONTINUE FROM ATTEMPT ${this.progress.daily.step + 1}`;
      }
      return MODE_CONFIG[mode].description;
    }

    isPlayEnabled() {
      const mode = this.model.mode;
      const round = this.model.current;
      const playablePhase = ["paused", "playing", "starting", "buffering", "failed"].includes(this.audio.phase);
      return Boolean(
        mode && round && !this.view.modal.isBlocking && playablePhase && !this.isResult && !this.isDailyComplete
      );
    }

    render() {
      this.view.render(this.createViewState(), this.model.guessedTrackIds, {
        guessed: this.guessedRevision,
        history: this.historyRevision,
        currentSlot: this.currentSlotRevision,
        discoveries: this.progress.discoveryRevision
      });
    }

    createViewState() {
      const mode = this.model.mode;
      const round = this.model.current;
      const phase = this.audio.phase;
      const modalKind = this.view.modal.openKind;
      const inputVisible = Boolean(round && this.model.currentSlot);
      const canSkipLoadingTimedRound = Boolean(
        round && this.modeConfig?.timed && !round.playedOnce && (phase === "starting" || phase === "buffering") &&
        this.roundNumber > 1 && this.playback.status !== TEXT.loadingTrack
      );
      const guessEnabled = Boolean(
        round && inputVisible && !this.view.modal.isBlocking && phase !== "failed" && !this.isResult && !this.isDailyComplete
      );
      const skipEnabled = Boolean(guessEnabled && (canResolveAttempt(phase, round) || canSkipLoadingTimedRound));
      const snippetSeconds = getAttemptSeconds(this.attempt);

      return {
        mode,
        timed: this.modeConfig?.timed === true,
        rulesText: this.currentRulesText(),
        transportStatus: this.playback.status,
        inputVisible,
        playEnabled: this.isPlayEnabled(),
        guessEnabled,
        skipEnabled,
        playbackIcon: isAudioBusy(phase) ? this.modeConfig?.timed ? "pause" : "stop" : "play",
        snippetSeconds,
        snippetProgress: snippetSeconds / MAX_SNIPPET_SECONDS,
        skipText: getSkipText(mode, this.attempt),
        currentSlot: this.model.currentSlot,
        history: this.model.history,
        result: this.model.result,
        dailyProgress: this.progress.daily,
        dailyDate: this.dailyDate,
        discoveries: this.progress.discoveries,
        modalKind,
        clock: this.createClockView(this.clock.snapshot())
      };
    }

    createClockView(snapshot) {
      const mode = this.model.mode;
      let nowText = "0:00";
      let endText = "0:01";
      let progress = 0;

      if (mode && this.modeConfig?.timed) {
        const survival = mode === "survival";
        const initialTimeMs = MODE_CONFIG[mode].initialTimeMs;
        endText = formatTime(survival ? Math.ceil(snapshot.remainingMs / 1_000) : initialTimeMs / 1_000);
        const nowSeconds = (survival ? snapshot.elapsedMs : snapshot.remainingMs) / 1_000;
        const scaleMs = survival ? snapshot.maxRemainingMs : initialTimeMs;
        nowText = formatTime(nowSeconds);
        progress = scaleMs ? snapshot.remainingMs / scaleMs : 0;
      } else if (mode) {
        const inputVisible = Boolean(this.model.current && this.model.currentSlot);
        const snippetSeconds = getAttemptSeconds(this.attempt);
        const nowSeconds = mode === "daily" && !inputVisible && this.progress.daily.date === this.dailyDate &&
          this.progress.daily.started ? snippetSeconds : snapshot.elapsedMs / 1_000;
        endText = `0:${String(snippetSeconds).padStart(2, "0")}`;
        nowText = formatTime(nowSeconds);
        progress = nowSeconds ? nowSeconds / MAX_SNIPPET_SECONDS + 0.0025 : 0;
      }

      return { nowText, endText, progress };
    }

    focusRecommendedPrimary(defer = false) {
      const focus = () => {
        if (this.isPlayEnabled()) this.view.focusPlay();
        else if (this.isDailyComplete) this.view.focusMode("blitz");
        else if (!this.model.mode) this.view.focusMode("daily");
      };
      if (defer) queueMicrotask(focus);
      else focus();
    }
  }

  const TRACKS = [{
    dailyNumber: 1,
    title: "Boogie Bros - Fight For Your Right (Justin Corza remix)",
    spotify: "3BgtD7BjXdM8yGylzVOQVn",
    duration: 233
  }, {
    dailyNumber: 2,
    title: "DJ Lawless vs. Oliver Swab - Push It Again 2.1 (Justin Corza meets Greg Blast remix)",
    spotify: "4Hwxd1HfOfakZYlILEGE0z",
    duration: 157
  }, {
    dailyNumber: 3,
    title: "FM Audio - Rock & Roll Angels (Justin Corza meets Greg Blast remix)",
    spotify: "2ZO7Xi31U0J9hRWEuZN2gn",
    duration: 212
  }, {
    dailyNumber: 4,
    title: "2 Raverz - With The Crowd (Justin Corza meets Greg Blast remix)",
    spotify: "5MENvtLe2m8HgrWeAUascg",
    duration: 168
  }, {
    dailyNumber: 5,
    title: "Pete Sheppibone - The Highjacker (Justin Corza meets Greg Blast remix)",
    spotify: "1cyC3iC1i0wJhZlHZtgwV2",
    duration: 209
  }, {
    dailyNumber: 6,
    title: "Big City Angels - Top Of The Stars (Justin Corza meets Greg Blast remix)",
    spotify: "1gLU40RPcWAKbGykigDiPb",
    duration: 190
  }, {
    dailyNumber: 7,
    title: "Marc Kiss - High On Emotion (Justin Corza meets Greg Blast remix)",
    spotify: "42seWVZo8TMSJHGb1Iqxoy",
    duration: 267
  }, {
    dailyNumber: 8,
    title: "Emvace vs. Tierra - Hot (Justin Corza meets Greg Blast remix)",
    spotify: "5iAw0ivarRFxGHPaQGsBkc",
    duration: 209
  }, {
    dailyNumber: 9,
    title: "Dual Playaz - Every Day I See You (Justin Corza meets Greg Blast remix)",
    spotify: "5sBwF1KfmfE72DE0vA7nUM",
    duration: 260
  }, {
    dailyNumber: 10,
    title: "Dino & Rocker - Breakfast At Tiffany's (Justin Corza meets Greg Blast remix)",
    spotify: "6eRoSbMhmqhNnoiDIbAX9q",
    duration: 261
  }, {
    dailyNumber: 11,
    title: "2 Raverz - Into My World (Justin Corza meets Greg Blast remix)",
    spotify: "7Bi6rlQ8BRHfyLKCcSm9qv",
    duration: 184
  }, {
    dailyNumber: 12,
    title: "Limelight - Touch Me (Justin Corza meets Greg Blast remix)",
    spotify: "1OUvXMkcMpGAMPSB1Xchym",
    duration: 260
  }, {
    dailyNumber: 13,
    title: "Justin Corza & Greg Blast vs. Addicted Craze - Could It Be Love (Justin Corza meets Greg Blast mix)",
    spotify: "59FrUkEBM3d52xTyM4XwFV",
    duration: 242
  }, {
    dailyNumber: 14,
    title: "Jeany Kiss & Sunray ft. Gemma B. - My Heart Beats Like A Drum (Justin Corza meets Greg Blast remix)",
    spotify: "6CL4hwEkz6JKU92cm3OJYM",
    duration: 204
  }, {
    dailyNumber: 15,
    title: "Giga Dance vs. Rainy - Like An Angel (Justin Corza meets Greg Blast remix)",
    spotify: "18NbotjS2JQmx3UDqzJQMU",
    duration: 229
  }, {
    dailyNumber: 16,
    title: "Empyre One - Mirrors (Justin Corza meets Greg Blast remix)",
    spotify: "4uVQDpbUANNuLioOs6itDl",
    duration: 214
  }, {
    dailyNumber: 17,
    title: "Dual Playaz - Alone Again (Justin Corza meets Greg Blast remix)",
    spotify: "2kNnNdIvzOqfyiOsGGsGZq",
    duration: 265
  }, {
    dailyNumber: 18,
    title: "The Circus - Start It Now (Justin Corza meets Greg Blast remix)",
    spotify: "35uWDWU5adpfRalZrV1PCa",
    duration: 195
  }, {
    dailyNumber: 19,
    title: "Danny Dope ft. Hayley - Everyday Is Gonna Be All Right (Justin Corza meets Greg Blast remix)",
    spotify: "2hdshIg0kczPt126OXV7Qk",
    duration: 234
  }, {
    dailyNumber: 20,
    title: "ThomTree - When The Sun Comes Out (Justin Corza meets Greg Blast remix)",
    spotify: "59npfoAsZXdVSguyCmufR0",
    duration: 206
  }, {
    dailyNumber: 21,
    title: "Addicted Craze - Fighting (Justin Corza meets Greg Blast remix)",
    spotify: "1Sc7FhvFMHqFSQQbJOzbad",
    duration: 201
  }, {
    dailyNumber: 22,
    title: "DJ THT meets Scarlet - Live 2 Dance (Justin Corza meets Greg Blast remix)",
    spotify: "1OPuFlMdr74QvAQaJeFlS7",
    duration: 212
  }, {
    dailyNumber: 23,
    title: "Crazy & Corza - Wildfire (Radio edit)",
    spotify: "6bWyRa45B2a7bzkuicT4x6",
    duration: 180
  }, {
    dailyNumber: 24,
    title: "Crazy & Corza - Pegasus (Radio edit)",
    spotify: "6BC8L5saCUWnLxnzLfqWhF",
    duration: 169
  }, {
    dailyNumber: 25,
    title: "Alex M. vs. Marc Van Damme - Technodisco 2.0 (Justin Corza meets Phillerz remix)",
    spotify: "1lc16jnQbgIxJGDkIBKnOt",
    duration: 170
  }, {
    dailyNumber: 26,
    title: "Alex M. vs. Marc Van Damme - Technodisco 2.0 (Justin Corza meets Phillerz Classic mix)",
    spotify: "2TEkigFuqwa8tTaQTdtCX0",
    duration: 170
  }, {
    dailyNumber: 27,
    title: "Quickdrop ft. Toni Fox - 24 Hours Happiness (Justin Corza remix)",
    spotify: "16E0I5OnAog7lPkNSQSvOr",
    duration: 197
  }, {
    dailyNumber: 28,
    title: "Otto Le Blanc & Alain Prideux - Loco (Justin Corza remix)",
    spotify: "5Qrynxe6LZKm5ZHoFSRiGI",
    duration: 144
  }, {
    dailyNumber: 29,
    title: "NDS vs. Tom E ft. Ella - Stronger (Justin Corza meets Phillerz remix)",
    spotify: "0sJJhnFdgIYLYw7ewvwfAj",
    duration: 172
  }, {
    dailyNumber: 30,
    title: "DJ Gollum ft. DJ Cap - I've Got The Key (Triforce remix)",
    spotify: "2vzeGxOHSN47g50RMexsDG",
    duration: 207
  }, {
    dailyNumber: 31,
    title: "Commercial Club Crew - Dance In The Rain (Triforce remix)",
    spotify: "5AEX9xy0bM2oihoUC2YQXg",
    duration: 217
  }, {
    dailyNumber: 32,
    title: "Beat Bangerz - Doop Re-Washed (Crazy & Corza remix)",
    spotify: "3fnRx64akl41QGpGYtxa5c",
    duration: 175
  }, {
    dailyNumber: 33,
    title: "DJ Gollum ft. DJ Cap - Give Me Five (Triforce remix)",
    spotify: "0YYL7QBDDz0W2IcLtWjQBn",
    duration: 212
  }, {
    dailyNumber: 34,
    title: "Giorno - Happiness (Justin Corza remix)",
    spotify: "6yfoORvzDHvgeHwrP7gUt3",
    duration: 174
  }, {
    dailyNumber: 35,
    title: "Aeons Ago - Celebrate The Beat (Radio edit)",
    duration: 174
  }, {
    dailyNumber: 36,
    title: "DJ THT meets Scarlet - Stay With Me (Justin Corza remix)",
    spotify: "7v26sK7Y0MjJqP9cgjr75r",
    duration: 261
  }, {
    dailyNumber: 37,
    title: "Quickdrop - Come Back (Triforce remix)",
    spotify: "7dWAwx7daSxeBjEZ4fAzBD",
    duration: 181
  }, {
    dailyNumber: 38,
    title: "Tale & Dutch - Even If My Heart Dies (Justin Corza remix)",
    spotify: "6g6MFuvhOY8jTVSTypfpCs",
    duration: 229
  }, {
    dailyNumber: 39,
    title: "Chant Le Grand ft. Romy - Party Once Again (Justin Corza meets Phillerz remix)",
    spotify: "1jhdl351XAnYvAVd3XLm3H",
    duration: 169
  }, {
    dailyNumber: 40,
    title: "DJ Gollum ft. DJ Cap vs. Nicco - Together Forever (Triforce remix)",
    spotify: "1tZJzPdldZD2m2zAHFIhbC",
    duration: 242
  }, {
    dailyNumber: 41,
    title: "Dual Playaz - Sax & Bass & Crazy Beats (Justin Corza meets Morty Simmons remix)",
    spotify: "2F1QnuW8D2s12l7NVjYIUf",
    duration: 217
  }, {
    dailyNumber: 42,
    title: "DJ Gollum ft. DJ Cap vs. 89ers - Heart Ahead (Phillerz & Corza remix)",
    spotify: "6kLhjgwpfoZHivLNvRPNyF",
    duration: 232
  }, {
    dailyNumber: 43,
    title: "Justin Corza & Morty Simmons - Headshot (Radio edit)",
    spotify: "7uWRZGmKpGVN8MYkWFoiFc",
    duration: 161
  }, {
    dailyNumber: 44,
    title: "Justin Corza & 420 - Night Of Fright (Spooky mix)",
    spotify: "4bZQPMg5OyGYFLry9tr2gB",
    duration: 244
  }, {
    dailyNumber: 45,
    title: "Justin Corza & Phillerz - Believe (Radio edit)",
    spotify: "5ppUd8GuROKdFtFPNFDfw1",
    duration: 187
  }, {
    dailyNumber: 46,
    title: "Mindblast & Withard - Rise (Justin Corza & Morty Simmons remix)",
    spotify: "1kGDqNzRDDDRuUC3348MMa",
    duration: 200
  }, {
    dailyNumber: 47,
    title: "DJ Gollum ft. DJ Cap vs. Mark Breeze - Electronic Universe (Triforce remix)",
    spotify: "4WNk6NBCJuYbjksCsCtHod",
    duration: 231
  }, {
    dailyNumber: 48,
    title: "DJ THT, Justin Corza & Commercial Club Crew - We Own The Night (Justin Corza mix)",
    spotify: "0lg1HRriRTsw8hczDs1SpS",
    duration: 230
  }, {
    dailyNumber: 49,
    title: "Quickdrop x Stolen Valor - Broke Inside",
    spotify: "5yBXcWR58dBrehPue4L5mK",
    duration: 195
  }, {
    dailyNumber: 50,
    dailyFrom: "2026-07-14",
    title: "Hr. Troels x DJ THT x Stolen Valor x Albin Lo\xE1n - Where I Belong",
    spotify: "7elrT6nhqjusapljogEgc1",
    duration: 157,
    isNew: !0
  }, {
    dailyNumber: 51,
    dailyFrom: "2026-07-14",
    title: "K-Fox ft. Sahara - Thank You (Aeons Ago remix)",
    duration: 153,
    isNew: !0
  }].map(r => ({
    dailyFrom: "1970-01-01",
    spotify: "",
    ...r
  }));

  class TrackCatalog {
    constructor(tracks) {
      this.tracks = tracks;
      this.byId = new Map(tracks.map(track => [track.dailyNumber, track]));
      this.searchEntries = tracks.map(track => ({
        track,
        normalizedTitle: track.title.toLocaleLowerCase()
      }));
      this.discoveryTracks = [...tracks].sort((left, right) => right.dailyNumber - left.dailyNumber);
    }

    get(dailyNumber) {
      return this.byId.get(dailyNumber);
    }

    search(query, unavailable, limit) {
      const results = [];
      for (const entry of this.searchEntries) {
        if (unavailable.has(entry.track.dailyNumber) || !entry.normalizedTitle.includes(query)) continue;
        results.push(entry.track);
        if (results.length === limit) break;
      }
      return results;
    }

    dailyTrack(date, savedDailyNumber) {
      if (savedDailyNumber !== null) {
        return this.tracks.find(track => track.dailyFrom <= date && track.dailyNumber === savedDailyNumber);
      }

      let selected = null;
      let selectedHash = 0;
      for (const track of this.tracks) {
        if (track.dailyFrom > date) continue;
        const hash = hashString(`corzaguessr-daily:${date}:${track.dailyNumber}`);
        if (selected === null || hash > selectedHash) {
          selected = track;
          selectedHash = hash;
        }
      }
      return selected;
    }

    dailyClipStart(track, date) {
      const maximumStart = Math.floor(track.duration - MAX_SNIPPET_SECONDS);
      return hashString(`corzaguessr-daily-clip:${date}:${track.dailyNumber}`) % (maximumStart + 1);
    }

    randomTrack(excluded, previousTrackId) {
      const candidates = [];
      for (const track of this.tracks) {
        if (!excluded.has(track.dailyNumber) && track.dailyNumber !== previousTrackId) candidates.push(track);
      }
      return candidates[Math.floor(Math.random() * candidates.length)];
    }

    randomClipStart(track, timed) {
      const clipSeconds = timed ? TIMED_CLIP_SECONDS : MAX_SNIPPET_SECONDS;
      const maximumStart = Math.floor(track.duration - clipSeconds);
      return Math.floor(Math.random() * (maximumStart + 1));
    }
  }

  class LocalProgressRepository {
    constructor() {
      try {
        this.storage = window.localStorage;
      } catch {
        this.storage = null;
      }
    }

    load() {
      const discoveries = this.readUnknown(STORAGE_KEYS.discoveries);
      return {
        discoveries: new Set(
          (Array.isArray(discoveries) ? discoveries : []).filter(
            value => typeof value === "number" && Number.isSafeInteger(value) && value > 0
          )
        ),
        daily: sanitizeDailyProgress(this.readUnknown(STORAGE_KEYS.daily)),
        personalBests: sanitizePersonalBests(this.readUnknown(STORAGE_KEYS.personalBests))
      };
    }

    saveDiscoveries(discoveries) {
      const sorted = [...discoveries].sort((left, right) => left - right);
      try {
        if (!this.storage) return false;
        if (sorted.length) this.storage.setItem(STORAGE_KEYS.discoveries, JSON.stringify(sorted));
        else this.storage.removeItem(STORAGE_KEYS.discoveries);
        return true;
      } catch {
        return false;
      }
    }

    saveDaily(progress) {
      return this.write(STORAGE_KEYS.daily, progress);
    }

    savePersonalBests(personalBests) {
      return this.write(STORAGE_KEYS.personalBests, personalBests);
    }

    readUnknown(key) {
      try {
        if (!this.storage) return undefined;
        const value = this.storage.getItem(key);
        return value === null ? undefined : JSON.parse(value);
      } catch {
        return undefined;
      }
    }

    write(key, value) {
      try {
        if (!this.storage) return false;
        this.storage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    }
  }

  class GameClock {
    kind = "classic";
    limitMs = 1_000;
    running = false;
    anchorMs = null;
    elapsedMs = 0;
    remainingMs = 1_000;
    maxRemainingMs = 1_000;
    expired = false;
    frame = 0;
    timer = 0;
    generation = 0;

    constructor(callbacks) {
      this.callbacks = callbacks;
    }

    get isRunning() {
      return this.running;
    }

    configure({ kind, initialMs, limitMs }) {
      this.reset(kind, initialMs, limitMs ?? initialMs);
    }

    reset(kind, initialMs, limitMs) {
      this.cancelScheduled();
      this.kind = kind;
      this.limitMs = limitMs;
      this.running = false;
      this.anchorMs = null;
      this.elapsedMs = 0;
      this.remainingMs = initialMs;
      this.maxRemainingMs = initialMs;
      this.expired = false;
      this.generation += 1;
    }

    start() {
      if (this.running || this.expired) return;
      this.running = true;
      this.anchorMs = performance.now();
      this.schedule();
    }

    pause() {
      if (!this.running) return;
      this.commit();
      this.running = false;
      this.anchorMs = null;
      this.generation += 1;
      this.cancelScheduled();
    }

    pauseAndSnapshot() {
      this.pause();
      return this.snapshot();
    }

    restartClassic(limitMs) {
      this.reset("classic", limitMs, limitMs);
    }

    extendClassic(limitMs) {
      const wasRunning = this.running;
      this.commit();
      this.kind = "classic";
      this.limitMs = limitMs;
      this.remainingMs = Math.max(0, limitMs - this.elapsedMs);
      this.maxRemainingMs = Math.max(this.maxRemainingMs, limitMs);
      this.expired = this.remainingMs === 0;
      this.anchorMs = wasRunning && !this.expired ? performance.now() : null;
      this.running = wasRunning && !this.expired;
      this.generation += 1;
      this.cancelScheduled();
      if (this.running) this.schedule();
    }

    adjust(changeMs) {
      this.commit();
      this.remainingMs = Math.max(0, this.remainingMs + changeMs);
      this.maxRemainingMs = Math.max(this.maxRemainingMs, this.remainingMs);
      this.expired = this.remainingMs === 0;
      if (this.running && !this.expired) this.anchorMs = performance.now();

      if (this.expired) {
        this.running = false;
        this.anchorMs = null;
        this.cancelScheduled();
      } else if (this.running) {
        this.generation += 1;
        this.cancelScheduled();
        this.schedule();
      }
      return this.snapshot();
    }

    snapshot() {
      const projected = this.project(performance.now());
      return {
        running: this.running,
        elapsedMs: projected.elapsedMs,
        remainingMs: projected.remainingMs,
        maxRemainingMs: this.maxRemainingMs,
        expired: this.expired || projected.remainingMs <= 0
      };
    }

    project(nowMs) {
      if (!this.running || this.anchorMs === null) {
        return { elapsedMs: this.elapsedMs, remainingMs: this.remainingMs };
      }

      const deltaMs = Math.max(0, nowMs - this.anchorMs);
      const elapsedMs = this.elapsedMs + deltaMs;
      return {
        elapsedMs,
        remainingMs: this.kind === "classic"
          ? Math.max(0, this.limitMs - elapsedMs)
          : Math.max(0, this.remainingMs - deltaMs)
      };
    }

    commit() {
      if (!this.running || this.anchorMs === null) return;
      const nowMs = performance.now();
      const projected = this.project(nowMs);
      this.elapsedMs = projected.elapsedMs;
      this.remainingMs = projected.remainingMs;
      this.anchorMs = nowMs;
      if (this.remainingMs <= 0) this.expired = true;
    }

    schedule() {
      const generation = this.generation;
      const tick = () => {
        if (!this.running || generation !== this.generation) return;
        const snapshot = this.snapshot();
        this.callbacks.onTick(snapshot);
        if (snapshot.remainingMs > 0) this.frame = requestAnimationFrame(tick);
      };

      this.frame = requestAnimationFrame(tick);
      this.timer = window.setTimeout(() => {
        if (!this.running || generation !== this.generation) return;
        this.commit();
        this.running = false;
        this.anchorMs = null;
        this.remainingMs = 0;
        this.expired = true;
        this.cancelScheduled();
        this.callbacks.onExpired();
      }, Math.max(0, this.remainingMs));
    }

    cancelScheduled() {
      if (this.frame) cancelAnimationFrame(this.frame);
      if (this.timer) clearTimeout(this.timer);
      this.frame = 0;
      this.timer = 0;
    }
  }

  class AudioDeck {
    active = null;
    standby = null;
    lastActiveSlot = null;
    phase = "empty";
    suspension = null;

    constructor(elements, sourceForRound, callbacks) {
      this.sourceForRound = sourceForRound;
      this.callbacks = callbacks;
      this.slots = elements.map(element => ({
        element,
        round: null,
        generation: 0,
        controller: null,
        failed: false
      }));
    }

    prepare(round) {
      return this.assign(round, "active");
    }

    preload(round) {
      return this.assign(round, "standby");
    }

    promote(roundId) {
      const slot = this.standby;
      if (!slot || slot.round?.id !== roundId) {
        this.phase = "failed";
        this.callbacks.onFailure({
          role: "active",
          roundId,
          trackId: slot?.round?.track.dailyNumber ?? null,
          previousPhase: "paused"
        });
        return false;
      }

      if (slot.failed || slot.element.error) {
        const trackId = slot.round.track.dailyNumber;
        this.standby = null;
        this.releaseSlot(slot, true);
        this.phase = "failed";
        this.callbacks.onFailure({
          role: "active",
          roundId,
          trackId,
          previousPhase: "paused"
        });
        return false;
      }

      const previousActive = this.active;
      this.active = slot;
      this.standby = null;
      this.phase = "paused";
      if (previousActive && previousActive !== slot) this.releaseSlot(previousActive);
      return true;
    }

    playPrepared(round, restart) {
      const slot = this.active;
      if (!slot || slot.round?.id !== round.id) {
        this.callbacks.onFailure({
          role: "active",
          roundId: round.id,
          trackId: round.track.dailyNumber,
          previousPhase: this.phase
        });
        return false;
      }

      const generation = slot.generation;
      if (restart) {
        slot.element.pause();
        this.seek(slot);
      } else {
        this.correctSeekBeforePlay(slot);
      }
      this.phase = "starting";

      try {
        slot.element.play()?.catch(error => {
          if (!this.isLive(slot, generation, round.id) || slot !== this.active) return;
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (error instanceof DOMException && error.name === "NotAllowedError") {
            this.phase = "paused";
            this.callbacks.onBlocked(round.id);
          } else {
            this.fail(slot, "active");
          }
        });
      } catch {
        if (this.isLive(slot, generation, round.id) && slot === this.active) this.fail(slot, "active");
        return false;
      }
      return true;
    }

    pause() {
      if (!this.active || this.phase === "empty" || this.phase === "failed") return;
      this.phase = "paused";
      this.active.element.pause();
    }

    releaseActive(phase = null) {
      if (!this.active) {
        if (phase) this.phase = phase;
        return;
      }

      const slot = this.active;
      this.lastActiveSlot = slot;
      this.active = null;
      this.suspension = null;
      this.releaseSlot(slot);
      this.phase = phase ?? (this.standby ? "paused" : "empty");
    }

    stop() {
      this.releaseActive();
      this.discardStandby();
      this.suspension = null;
      this.phase = "empty";
    }

    discardStandby() {
      if (!this.standby) return;
      this.releaseSlot(this.standby);
      this.standby = null;
    }

    suspend(roundId) {
      if (!this.active || this.active.round?.id !== roundId) return;
      this.suspension = {
        generation: this.active.generation,
        roundId,
        terminal: null
      };
      this.pause();
    }

    restore(roundId) {
      const suspension = this.suspension;
      this.suspension = null;
      if (!suspension || !this.active || this.active.round?.id !== roundId || suspension.roundId !== roundId ||
          suspension.generation !== this.active.generation) {
        return null;
      }
      return suspension.terminal;
    }

    assign(round, role) {
      const otherRole = role === "active" ? this.standby : this.active;
      const currentRole = role === "active" ? this.active : this.standby;
      const slot = currentRole ??
        this.slots.filter(candidate => candidate !== otherRole).find(candidate => candidate !== this.lastActiveSlot) ??
        this.slots.find(candidate => candidate !== otherRole) ??
        null;

      if (!slot) {
        this.callbacks.onFailure({
          role,
          roundId: round.id,
          trackId: round.track.dailyNumber,
          previousPhase: this.phase
        });
        return false;
      }

      if (role === "active") this.active = null;
      else this.standby = null;

      if (slot.round === null) slot.generation += 1;
      else this.releaseSlot(slot);
      slot.round = round;
      const generation = slot.generation;

      if (role === "active") {
        this.active = slot;
        this.phase = "paused";
      } else {
        this.standby = slot;
      }

      this.bind(slot);
      slot.element.preload = "auto";
      slot.element.src = this.sourceForRound(round);
      slot.element.load();

      if (!this.isLive(slot, generation, round.id)) return false;
      if (slot.element.error) {
        this.fail(slot, role);
        return false;
      }
      return true;
    }

    bind(slot) {
      const controller = new AbortController();
      const generation = slot.generation;
      const roundId = slot.round.id;
      slot.controller = controller;
      const isCurrent = () => this.isLive(slot, generation, roundId);

      slot.element.addEventListener("loadedmetadata", () => {
        if (isCurrent()) this.seek(slot);
      }, { signal: controller.signal });

      slot.element.addEventListener("playing", () => {
        if (!isCurrent() || slot !== this.active || !["starting", "buffering"].includes(this.phase)) return;
        this.phase = "playing";
        this.callbacks.onPlaying(roundId);
      }, { signal: controller.signal });

      slot.element.addEventListener("waiting", () => {
        if (!isCurrent() || slot !== this.active || ["paused", "buffering", "failed"].includes(this.phase)) return;
        this.phase = "buffering";
        this.callbacks.onWaiting({ roundId });
      }, { signal: controller.signal });

      slot.element.addEventListener("ended", () => {
        if (!isCurrent() || slot !== this.active) return;
        this.phase = "ended";
        if (this.suspension && this.suspension.roundId === roundId) {
          this.suspension.terminal = { type: "ended" };
        } else {
          this.callbacks.onEnded(roundId);
        }
      }, { signal: controller.signal });

      slot.element.addEventListener("error", () => {
        if (isCurrent() && slot.element.error) this.fail(slot, slot === this.standby ? "standby" : "active");
      }, { signal: controller.signal });
    }

    fail(slot, role) {
      if (slot.failed || !slot.round) return;
      slot.failed = true;
      const round = slot.round;
      const previousPhase = this.phase;

      if (role === "standby") {
        if (this.standby === slot) this.standby = null;
        this.releaseSlot(slot);
        this.callbacks.onFailure({
          role,
          roundId: round.id,
          trackId: round.track.dailyNumber,
          previousPhase
        });
        return;
      }

      this.phase = "failed";
      if (this.suspension && this.suspension.roundId === round.id) {
        this.suspension.terminal = { type: "failed", previousPhase };
        return;
      }

      this.callbacks.onFailure({
        role,
        roundId: round.id,
        trackId: round.track.dailyNumber,
        previousPhase
      });
    }

    seekTarget(slot) {
      const duration = Number.isFinite(slot.element.duration) ? slot.element.duration : slot.round.track.duration;
      return Math.min(slot.round.clipStart, Math.max(0, duration - 0.05));
    }

    seek(slot) {
      if (!slot.round || slot.element.readyState < HAVE_METADATA) return;
      try {
        slot.element.currentTime = this.seekTarget(slot);
      } catch {}
    }

    correctSeekBeforePlay(slot) {
      if (!slot.round || slot.element.readyState < HAVE_METADATA) return;
      const target = this.seekTarget(slot);
      if (!Number.isFinite(slot.element.currentTime) || slot.element.currentTime + 0.35 < target) this.seek(slot);
    }

    isLive(slot, generation, roundId) {
      return slot.generation === generation && slot.round?.id === roundId;
    }

    releaseSlot(slot, replaceElement = slot.failed) {
      if (!slot.round && !slot.controller && !slot.element.getAttribute("src")) return;
      slot.controller?.abort();
      slot.controller = null;
      slot.generation += 1;

      const element = slot.element;
      element.pause();
      element.removeAttribute("src");
      element.load();

      if (replaceElement) {
        const replacement = element.cloneNode(false);
        replacement.preload = "auto";
        element.replaceWith(replacement);
        slot.element = replacement;
      }

      slot.round = null;
      slot.failed = false;
    }
  }

  class DailyBoundaryTimer {
    timer = 0;
    currentDate = "";
    active = false;

    constructor(onDateChanged) {
      this.onDateChanged = onDateChanged;
    }

    current() {
      if (!this.currentDate) this.currentDate = getBudapestDateKey();
      return this.currentDate;
    }

    start() {
      this.active = true;
      this.currentDate = getBudapestDateKey();
      this.scheduleNextBoundary();
      return this.currentDate;
    }

    reconcile() {
      const date = getBudapestDateKey();
      if (date !== this.currentDate) {
        this.currentDate = date;
        this.onDateChanged(date);
      }
      if (this.active) this.scheduleNextBoundary();
      return date;
    }

    stop() {
      this.active = false;
      if (this.timer) clearTimeout(this.timer);
      this.timer = 0;
    }

    scheduleNextBoundary() {
      if (!this.active) return;
      if (this.timer) clearTimeout(this.timer);
      this.timer = 0;

      const now = Date.now();
      const currentDate = getBudapestDateKey(new Date(now));
      let beforeBoundary = now;
      let afterBoundary = now + 1_800 * 60 * 1_000;

      while (getBudapestDateKey(new Date(afterBoundary)) === currentDate) {
        afterBoundary += 360 * 60 * 1_000;
      }

      while (afterBoundary - beforeBoundary > 1) {
        const midpoint = Math.floor((beforeBoundary + afterBoundary) / 2);
        if (getBudapestDateKey(new Date(midpoint)) === currentDate) beforeBoundary = midpoint;
        else afterBoundary = midpoint;
      }

      this.timer = window.setTimeout(() => this.reconcile(), Math.max(1, afterBoundary - now));
    }
  }

  class AutocompleteController {
    unavailable = new Set();
    unavailableRevision = -1;
    suggestions = [];
    selectedIndex = -1;

    constructor(input, list, catalog, onGuess, onPlaybackShortcut) {
      this.input = input;
      this.list = list;
      this.catalog = catalog;
      this.onGuess = onGuess;
      this.onPlaybackShortcut = onPlaybackShortcut;

      input.addEventListener("input", () => this.update());
      input.addEventListener("keydown", event => this.handleKeydown(event));
      list.addEventListener("pointerover", event => {
        const option = event.target instanceof Element ? event.target.closest("[role=option]") : null;
        if (!option) return;
        const index = Number(option.dataset.index);
        if (Number.isSafeInteger(index)) this.select(index);
      });
      list.addEventListener("click", event => {
        const option = event.target instanceof Element ? event.target.closest("[role=option]") : null;
        if (!option) return;
        const index = Number(option.dataset.index);
        const suggestion = this.suggestions[index];
        if (suggestion) this.onGuess(suggestion.dailyNumber);
      });
    }

    setUnavailable(unavailable, revision) {
      if (revision === this.unavailableRevision) return;
      const selectedId = this.suggestions[this.selectedIndex]?.dailyNumber ?? null;
      this.unavailable = unavailable;
      this.unavailableRevision = revision;
      if (this.input.value.trim()) this.update(selectedId);
    }

    reset() {
      const alreadyReset = this.input.value === "" && this.suggestions.length === 0 && this.selectedIndex === -1 &&
        this.list.children.length === 0 && this.list.style.display === "none" &&
        this.input.getAttribute("aria-expanded") === "false" &&
        !this.input.hasAttribute("aria-activedescendant");
      if (alreadyReset) return;
      this.input.value = "";
      this.suggestions = [];
      this.selectedIndex = -1;
      this.render();
    }

    update(selectedId = null) {
      const query = this.input.value.trim().toLocaleLowerCase();
      this.suggestions = query ? this.catalog.search(query, this.unavailable, 8) : [];
      const preservedIndex = selectedId === null
        ? -1
        : this.suggestions.findIndex(track => track.dailyNumber === selectedId);
      this.selectedIndex = preservedIndex >= 0 ? preservedIndex : this.suggestions.length ? 0 : -1;
      this.render();
    }

    select(index) {
      if (!this.suggestions.length) return;
      this.selectedIndex = (index % this.suggestions.length + this.suggestions.length) % this.suggestions.length;
      this.renderSelection();
    }

    syncActiveDescendant() {
      if (this.suggestions.length && this.selectedIndex >= 0) {
        this.input.setAttribute("aria-activedescendant", `corzaguessr-option-${this.selectedIndex}`);
      } else {
        this.input.removeAttribute("aria-activedescendant");
      }
    }

    renderSelection() {
      [...this.list.children].forEach((option, index) => {
        const active = index === this.selectedIndex;
        option.classList.toggle("active", active);
        option.setAttribute("aria-selected", String(active));
      });
      this.syncActiveDescendant();
    }

    handleKeydown(event) {
      if (event.key === "Escape") {
        this.reset();
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!this.suggestions.length) return;
        event.preventDefault();
        this.select(this.selectedIndex + (event.key === "ArrowDown" ? 1 : -1));
        return;
      }

      if (event.key !== "Enter") return;
      event.preventDefault();
      if (!this.input.value.trim()) {
        this.onPlaybackShortcut();
        return;
      }

      const suggestion = this.suggestions[this.selectedIndex];
      if (suggestion) this.onGuess(suggestion.dailyNumber);
    }

    render() {
      const options = this.suggestions.map((track, index) => {
        const option = document.createElement("button");
        option.type = "button";
        option.tabIndex = -1;
        option.id = `corzaguessr-option-${index}`;
        option.dataset.index = String(index);
        option.textContent = track.title;
        option.setAttribute("role", "option");
        const active = index === this.selectedIndex;
        option.setAttribute("aria-selected", String(active));
        if (active) option.className = "active";
        return option;
      });

      this.list.replaceChildren(...options);
      const expanded = options.length > 0;
      this.list.style.display = expanded ? "block" : "none";
      this.input.setAttribute("aria-expanded", String(expanded));
      this.syncActiveDescendant();
    }
  }

  class ModalController {
    state = "closed";
    returnFocus = null;
    lockedScroll = null;
    closeTimer = 0;
    openFrame = 0;
    transitionGeneration = 0;

    constructor(root, elements, durations, reducedMotion, announce) {
      this.root = root;
      this.elements = elements;
      this.durations = durations;
      this.reducedMotion = reducedMotion;
      this.announce = announce;
    }

    get openKind() {
      if (this.state.includes("discovery")) return "discovery";
      if (this.state.includes("result")) return "result";
      return null;
    }

    get isBlocking() {
      return this.state !== "closed";
    }

    get blocksRoundPreparation() {
      return this.state !== "closed" && this.state !== "closing-result";
    }

    get discoveryLayoutActive() {
      return this.state === "opening-discovery" || this.state === "discovery";
    }

    openResult() {
      if (this.isBlocking) return;
      const generation = this.beginOpen();
      this.state = "opening-result";
      this.captureReturnFocus();
      this.lockScroll();
      this.elements.card.classList.add("modal-open");
      this.elements.result.setAttribute("aria-hidden", "false");
      this.openFrame = requestAnimationFrame(() => {
        this.openFrame = 0;
        if (!this.transitionMatches("opening-result", generation)) return;
        this.state = "result";
        this.elements.card.classList.add("modal-visible");
        this.elements.next.focus({ preventScroll: true });
        this.announce(this.elements.resultMeta.dataset.announcement || "RESULT");
      });
    }

    openDiscovery() {
      if (this.isBlocking) return;
      const generation = this.beginOpen();
      this.state = "opening-discovery";
      this.captureReturnFocus();
      this.lockScroll();
      this.root.classList.add("discovery-open");
      this.elements.discoveryModal.setAttribute("aria-hidden", "false");
      this.elements.discoveryButton.setAttribute("aria-expanded", "true");
      this.elements.discoveryShell.style.height = "0px";
      this.elements.discoveryShell.offsetHeight;
      this.openFrame = requestAnimationFrame(() => {
        this.openFrame = 0;
        if (!this.transitionMatches("opening-discovery", generation)) return;
        this.state = "discovery";
        this.root.classList.add("discovery-visible");
        this.elements.discoveryShell.style.height = `${this.elements.discoveryPanel.offsetHeight}px`;
        this.elements.discoveryClose.focus({ preventScroll: true });
      });
    }

    close(kind, options = {}) {
      if (this.openKind !== kind || this.state === `closing-${kind}`) return;
      this.state = `closing-${kind}`;
      const generation = ++this.transitionGeneration;
      window.cancelAnimationFrame(this.openFrame);
      this.openFrame = 0;
      window.clearTimeout(this.closeTimer);

      if (kind === "result") {
        this.elements.card.classList.add("modal-closing");
        this.elements.card.classList.remove("modal-visible");
      } else {
        this.root.classList.remove("discovery-visible");
        this.elements.discoveryShell.style.height = `${this.elements.discoveryShell.offsetHeight}px`;
        this.elements.discoveryShell.offsetHeight;
        this.elements.discoveryShell.style.height = "0px";
        this.elements.discoveryButton.setAttribute("aria-expanded", "false");
      }
      options.beforeClose?.();

      const duration = this.reducedMotion.matches
        ? 0
        : kind === "result" ? this.durations.result : this.durations.discovery;
      this.closeTimer = window.setTimeout(() => {
        this.closeTimer = 0;
        if (this.state !== `closing-${kind}` || this.transitionGeneration !== generation) return;

        if (kind === "result") {
          this.elements.card.classList.remove("modal-open", "modal-visible", "modal-closing");
          this.elements.result.setAttribute("aria-hidden", "true");
        } else {
          this.root.classList.remove("discovery-open", "discovery-visible");
          this.elements.discoveryModal.setAttribute("aria-hidden", "true");
          this.elements.discoveryShell.style.height = "";
        }

        this.state = "closed";
        this.unlockScroll();
        options.afterClose?.();

        const returnFocus = this.returnFocus;
        this.returnFocus = null;
        const fallback = kind === "result" ? this.elements.play : this.elements.discoveryButton;
        const target = returnFocus && this.canFocus(returnFocus) ? returnFocus : fallback;
        if (this.canFocus(target)) target.focus({ preventScroll: true });
      }, duration);
    }

    trapFocus(event) {
      const kind = this.openKind;
      if (event.key !== "Tab" || !kind) return;
      const container = kind === "result" ? this.elements.result : this.elements.discoveryPanel;
      const focusable = [...container.querySelectorAll("button:not([disabled]), input:not([disabled])")]
        .filter(element => !element.hidden && element.offsetParent !== null);
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable.at(-1);
      if (!container.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    lockScroll() {
      if (this.lockedScroll) return;
      this.lockedScroll = {
        htmlOverflow: document.documentElement.style.overflow,
        htmlScrollbarGutter: document.documentElement.style.scrollbarGutter,
        bodyOverflow: document.body.style.overflow
      };
      document.documentElement.style.scrollbarGutter = "stable";
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
    }

    unlockScroll() {
      if (!this.lockedScroll) return;
      document.documentElement.style.overflow = this.lockedScroll.htmlOverflow;
      document.documentElement.style.scrollbarGutter = this.lockedScroll.htmlScrollbarGutter;
      document.body.style.overflow = this.lockedScroll.bodyOverflow;
      this.lockedScroll = null;
    }

    canFocus(element) {
      return element.isConnected && element.disabled !== true && !element.hidden && !element.closest("[inert]");
    }

    captureReturnFocus() {
      this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }

    beginOpen() {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = 0;
      window.cancelAnimationFrame(this.openFrame);
      this.openFrame = 0;
      return ++this.transitionGeneration;
    }

    transitionMatches(state, generation) {
      return this.state === state && this.transitionGeneration === generation;
    }
  }

  class GameView {
    reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    finePointer = matchMedia("(pointer: fine)");
    handlers = null;
    state = null;
    preview = null;
    renderedHistoryRevision = -1;
    historyRenderGeneration = 0;
    renderedDiscoveryRevision = -1;
    renderedResult = null;
    renderedRulesText = null;
    renderedRulesScroll = null;
    renderedCurrentSlotRevision = -1;
    renderedTransportStatus = null;
    renderedNowText = null;
    renderedEndText = null;
    announcementFrame = 0;
    slotTimer = 0;
    progressTransitionTimer = 0;
    progressRewindActive = false;

    constructor(root, catalog) {
      this.root = root;
      this.catalog = catalog;
      this.inputModality = this.finePointer.matches ? "pointer-fine" : "pointer-coarse";
      root.dataset.corzaguessrReady = "true";
      root.innerHTML = this.markup();
      this.elements = this.queryElements();
      this.modeButtons = this.elements.modeButtons;

      const styles = getComputedStyle(root);
      this.durations = {
        slot: this.duration(styles, "--duration-slot"),
        result: this.duration(styles, "--duration-result"),
        discovery: this.duration(styles, "--duration-discovery"),
        progress: this.duration(styles, "--duration-progress"),
        rewind: this.duration(styles, "--duration-rewind")
      };

      this.modal = new ModalController(root, this.elements, this.durations, this.reducedMotion, message => {
        this.announce(message);
      });
      this.autocomplete = new AutocompleteController(
        this.elements.guess,
        this.elements.suggest,
        catalog,
        dailyNumber => this.handlers?.guess(dailyNumber),
        () => this.handlers?.playbackShortcut()
      );

      this.elements.timeChangeText.addEventListener("animationend", event => {
        if (event.animationName === "corzaguessr-survival-hit") this.clearSurvivalFeedback();
      });
      new ResizeObserver(() => {
        if (this.modal.discoveryLayoutActive) {
          this.elements.discoveryShell.style.height = `${this.elements.discoveryPanel.offsetHeight}px`;
        }
      }).observe(this.elements.discoveryPanel);
    }

    get audioPlayers() {
      return this.elements.audioPlayers;
    }

    bind(handlers) {
      this.handlers = handlers;
      this.elements.play.addEventListener("click", handlers.play);
      this.elements.skip.addEventListener("click", handlers.skip);
      this.elements.next.addEventListener("click", handlers.newGame);
      this.elements.spotify.addEventListener("click", handlers.openSpotify);
      this.elements.discoveryButton.addEventListener("click", handlers.openDiscovery);
      this.elements.discoveryClose.addEventListener("click", handlers.closeDiscovery);
      this.elements.discoveryReset.addEventListener("click", () => {
        if (window.confirm("RESET DISCOVERY? THIS HIDES ALL DISCOVERED TRACKS.")) handlers.resetDiscovery();
      });
      this.elements.discoveryModal.addEventListener("click", event => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target?.closest(".discovery-panel")) handlers.closeDiscovery();
      });

      for (const [mode, button] of Object.entries(this.modeButtons)) {
        button.addEventListener("click", () => handlers.selectMode(mode));
        this.bindPreview(button, mode);
      }
      this.bindPreview(this.elements.discoveryButton, "discovery");
      this.root.addEventListener("keydown", event => this.handleRootKeydown(event), true);
      this.root.addEventListener("pointerdown", event => this.handlePointerDown(event));
    }

    render(state, unavailable, revisions) {
      this.state = state;
      this.root.classList.toggle("rules-visible", !state.inputVisible);
      this.root.classList.toggle("timed", state.timed);

      const noMode = state.mode === null;
      this.elements.modePrompt.setAttribute("aria-hidden", String(!noMode));
      this.elements.play.disabled = !state.playEnabled;
      this.elements.skip.disabled = !state.skipEnabled;
      this.elements.guess.disabled = !state.guessEnabled;

      const modalOpen = state.modalKind !== null;
      this.elements.headerAction.inert = modalOpen;
      this.elements.modes.inert = modalOpen;
      this.elements.board.inert = modalOpen || noMode;
      this.elements.currentSlot.inert = modalOpen || noMode;
      this.elements.slots.inert = modalOpen || noMode;

      for (const [mode, button] of Object.entries(this.modeButtons)) {
        const selected = mode === state.mode;
        button.disabled = selected || state.modalKind === "discovery";
        button.setAttribute("aria-pressed", String(selected));
      }

      this.elements.icon.setAttribute("d", PLAYBACK_ICON_PATHS[state.playbackIcon]);
      this.elements.play.setAttribute(
        "aria-label",
        state.playbackIcon === "play" ? "PLAY" : state.playbackIcon === "pause" ? "PAUSE" : "STOP"
      );
      this.elements.skip.textContent = state.skipText;
      this.elements.snippet.style.width = `${state.snippetProgress * 100}%`;
      this.renderTransportStatus(state.transportStatus);
      this.renderRules();
      this.renderCurrentSlot(state.currentSlot, revisions.currentSlot);
      this.renderHistory(state.history, revisions.history);
      this.autocomplete.setUnavailable(unavailable, revisions.guessed);
      this.renderDiscovery(state.discoveries, revisions.discoveries, state.modalKind);
      this.renderResult(state.result);
      this.renderClock(state.clock);
    }

    renderClock({ nowText, endText, progress }) {
      if (this.renderedEndText !== endText) {
        this.renderedEndText = endText;
        this.elements.endtime.textContent = endText;
      }
      this.setProgress(nowText, progress);
    }

    announce(message) {
      window.cancelAnimationFrame(this.announcementFrame);
      this.announcementFrame = 0;
      this.elements.status.textContent = "";
      if (!message) return;
      this.announcementFrame = requestAnimationFrame(() => {
        this.announcementFrame = 0;
        this.elements.status.textContent = message;
      });
    }

    flashSurvivalChange(seconds) {
      if (!seconds) return;
      const className = seconds > 0 ? "survival-reward" : "survival-penalty";
      this.clearSurvivalFeedback();
      this.elements.timeChangeText.textContent = seconds > 0 ? `+${seconds}S` : `${seconds}S`;
      this.elements.feedback.offsetWidth;
      this.elements.feedback.classList.add(className);
      this.elements.timeChange.classList.add("survival-change");
      if (this.reducedMotion.matches) this.clearSurvivalFeedback();
    }

    beginProgressReset(rewind = false) {
      if (rewind && this.progressRewindActive) return;
      window.clearTimeout(this.progressTransitionTimer);
      this.progressTransitionTimer = 0;
      this.progressRewindActive = false;
      this.elements.timeline.classList.remove("progress-rewinding");
      this.elements.timeline.style.removeProperty("--rewind-from");
      this.elements.fill.style.transition = "";

      if (rewind) {
        const scale = this.progressScale();
        this.renderedNowText = "0:00";
        this.elements.now.textContent = "0:00";
        this.elements.fill.style.transform = "scaleX(0)";
        this.elements.feedback.style.transform = "scaleX(0)";
        if (this.reducedMotion.matches || scale <= 0.0001) return;

        this.elements.timeline.style.setProperty("--rewind-from", String(scale));
        this.elements.timeline.offsetWidth;
        this.progressRewindActive = true;
        this.elements.timeline.classList.add("progress-rewinding");
        this.progressTransitionTimer = window.setTimeout(() => {
          this.progressTransitionTimer = 0;
          this.progressRewindActive = false;
          this.elements.timeline.classList.remove("progress-rewinding");
          this.elements.timeline.style.removeProperty("--rewind-from");
        }, this.durations.rewind);
        return;
      }

      if (this.reducedMotion.matches) return;
      this.elements.fill.offsetWidth;
      this.elements.fill.style.transition = "transform var(--duration-progress) ease-out";
      this.progressTransitionTimer = window.setTimeout(() => {
        this.elements.fill.style.transition = "";
        this.progressTransitionTimer = 0;
      }, this.durations.progress);
    }

    resetTransientUi() {
      window.cancelAnimationFrame(this.announcementFrame);
      this.announcementFrame = 0;
      this.elements.status.textContent = "";
      this.clearSurvivalFeedback();
      this.preview = null;
      this.autocomplete.reset();
    }

    focusPlay() {
      if (!this.elements.play.disabled && !this.elements.play.closest("[inert]")) {
        this.elements.play.focus({ preventScroll: true });
      }
    }

    focusMode(mode) {
      const button = this.modeButtons[mode];
      if (!button.disabled && !button.closest("[inert]")) button.focus({ preventScroll: true });
    }

    focusGuess() {
      if (this.inputModality === "pointer-coarse" || this.elements.guess.disabled ||
          this.elements.guess.closest("[inert]")) {
        return;
      }
      queueMicrotask(() => this.elements.guess.focus({ preventScroll: true }));
    }

    renderRules() {
      if (!this.state) return;
      const text = !this.preview || this.preview === this.state.mode
        ? this.state.rulesText
        : this.preview === "discovery" ? TEXT.discovery : MODE_CONFIG[this.preview].description;
      const scroll = !this.reducedMotion.matches && !this.state.inputVisible;
      if (text === this.renderedRulesText && scroll === this.renderedRulesScroll) return;

      this.renderedRulesText = text;
      this.renderedRulesScroll = scroll;
      this.elements.modePrompt.textContent = text;
      this.elements.rulesetText.textContent = text;
      this.elements.rulesetCopy.textContent = text;
      this.elements.ruleset.classList.remove("scroll");
      if (scroll) {
        this.elements.ruleset.offsetWidth;
        this.elements.ruleset.classList.add("scroll");
      }
    }

    renderHistory(history, revision) {
      if (revision === this.renderedHistoryRevision) return;
      this.renderedHistoryRevision = revision;
      const generation = ++this.historyRenderGeneration;
      window.clearTimeout(this.slotTimer);
      this.slotTimer = 0;

      if (!history.length) {
        if (!this.elements.slots.children.length) return;
        if (this.reducedMotion.matches) {
          this.elements.slots.replaceChildren();
          this.elements.slots.style.height = "";
          return;
        }

        [...this.elements.slots.children].forEach(slot => slot.classList.add("fade"));
        this.elements.slots.style.height = `${this.elements.slots.offsetHeight}px`;
        this.elements.slots.offsetHeight;
        this.elements.slots.style.height = "0px";
        const duration = this.modal.openKind === "result" ? this.durations.result : this.durations.slot;
        this.slotTimer = window.setTimeout(() => {
          this.slotTimer = 0;
          if (generation === this.historyRenderGeneration) {
            this.elements.slots.replaceChildren();
            this.elements.slots.style.height = "";
          }
        }, duration);
        return;
      }

      const existing = new Map(
        [...this.elements.slots.children].map(slot => [slot.dataset.historyKey ?? "", slot])
      );
      const slots = history.map(entry => {
        let slot = existing.get(entry.key);
        const created = !slot;
        if (!slot) {
          slot = document.createElement("div");
          slot.className = "slot fade";
          slot.dataset.historyKey = entry.key;
        }

        const oldTone = slot.dataset.tone ?? "";
        if (oldTone !== entry.tone) {
          if (oldTone) slot.classList.remove(...oldTone.split(/\s+/));
          if (entry.tone) slot.classList.add(...entry.tone.split(/\s+/));
          slot.dataset.tone = entry.tone;
        }

        if (/^(wrong|skip)$/.test(entry.tone) && oldTone !== entry.tone) {
          slot.classList.add("wiggle");
          slot.addEventListener("animationend", () => slot?.classList.remove("wiggle"), { once: true });
        }
        slot.textContent = entry.text;

        if (created) {
          requestAnimationFrame(() => {
            if (generation === this.historyRenderGeneration) slot?.classList.remove("fade");
          });
        }
        return slot;
      });
      this.elements.slots.replaceChildren(...slots);
    }

    renderCurrentSlot(entry, revision) {
      if (revision === this.renderedCurrentSlotRevision) return;
      this.renderedCurrentSlotRevision = revision;
      const slot = this.elements.currentSlot;
      const oldTone = slot.dataset.tone ?? "";
      if (oldTone) slot.classList.remove(...oldTone.split(/\s+/));

      if (!entry) {
        slot.dataset.tone = "";
        slot.textContent = "";
        slot.hidden = true;
        return;
      }

      if (entry.tone) slot.classList.add(...entry.tone.split(/\s+/));
      slot.dataset.tone = entry.tone;
      slot.textContent = entry.text;
      if (slot.hidden) {
        slot.classList.add("fade");
        slot.hidden = false;
        requestAnimationFrame(() => slot.classList.remove("fade"));
      }
    }

    renderTransportStatus(status) {
      if (status === this.renderedTransportStatus) return;
      this.renderedTransportStatus = status;
      this.elements.transportStatus.textContent = status;
    }

    renderDiscovery(discoveries, revision, modalKind) {
      if (modalKind !== "discovery" || revision === this.renderedDiscoveryRevision) return;
      this.renderedDiscoveryRevision = revision;
      const tracks = this.catalog.discoveryTracks;
      const discoveredCount = tracks.reduce(
        (total, track) => total + Number(discoveries.has(track.dailyNumber)),
        0
      );
      const percentage = Math.round(discoveredCount * 100 / tracks.length);
      this.elements.discoveryCount.textContent = `${discoveredCount} / ${tracks.length} (${percentage}%)`;
      this.elements.discoveryItems.replaceChildren(...tracks.map(track => {
        const discovered = discoveries.has(track.dailyNumber);
        const item = document.createElement("div");
        item.className = "discovery-item";
        item.setAttribute("role", "listitem");

        if (track.isNew && !discovered) {
          item.classList.add("discovery-item-new");
          const badge = document.createElement("span");
          badge.className = "discovery-new";
          badge.textContent = "NEW";
          badge.setAttribute("aria-hidden", "true");
          const title = document.createElement("span");
          title.className = "discovery-track";
          title.textContent = "?".repeat(20);
          item.append(badge, title, badge.cloneNode(true));
          item.setAttribute("aria-label", "NEW UNDISCOVERED TRACK");
        } else {
          item.textContent = discovered ? track.title : "?".repeat(20);
          if (!discovered) item.setAttribute("aria-hidden", "true");
        }
        return item;
      }));
    }

    renderResult(result) {
      if (result === this.renderedResult) return;
      this.renderedResult = result;
      if (!result) {
        this.elements.resultTitle.textContent = "";
        this.elements.resultMeta.replaceChildren();
        return;
      }

      if (result.mode === "blitz" || result.mode === "survival") {
        this.elements.resultTitle.innerHTML = '&#9201;&#65039; <span class="end">TIME IS UP</span> &#9201;&#65039;';
      } else {
        this.elements.resultTitle.innerHTML =
          `${result.won ? "&#127881;" : "&#10060;"} <span class="end">${result.won ? "YOU GOT IT" : "YOU GOT IT ALL WRONG"}</span> ${result.won ? "&#127881;" : "&#10060;"}`;
      }

      const rows = buildResultRows(result);
      this.elements.resultMeta.replaceChildren(...rows.map(row => createResultModule(row, result.newPersonalBest)));
      this.elements.resultMeta.dataset.announcement = buildResultAnnouncement(result, rows);
      const spotify = result.mode === "classic" || result.mode === "daily" ? result.spotify : "";
      this.elements.spotify.hidden = !spotify;
    }

    setProgress(nowText, progress) {
      const scale = Math.max(0, Math.min(1, Number(progress) || 0));
      if (this.renderedNowText !== nowText) {
        this.renderedNowText = nowText;
        this.elements.now.textContent = nowText;
      }
      this.elements.fill.style.transform = `scaleX(${scale})`;
      this.elements.feedback.style.transform = `scaleX(${scale})`;
    }

    progressScale() {
      const computed = getComputedStyle(this.elements.fill).transform;
      const transform = computed && computed !== "none" ? computed : this.elements.fill.style.transform;
      const scaleMatch = /scaleX\(([^)]+)\)/.exec(transform);
      const matrixMatch = /^matrix(?:3d)?\(([^)]+)\)$/.exec(transform);
      const scale = scaleMatch
        ? Number.parseFloat(scaleMatch[1] ?? "")
        : matrixMatch ? Number.parseFloat(matrixMatch[1]?.split(",")[0] ?? "") : 0;
      return Number.isFinite(scale) ? Math.max(0, Math.min(1, scale)) : 0;
    }

    bindPreview(element, preview) {
      element.addEventListener("pointerenter", () => {
        if (this.previewAllowed()) {
          this.preview = preview;
          this.renderRules();
        }
      });
      element.addEventListener("pointerleave", () => {
        if (this.preview === preview) {
          this.preview = null;
          this.renderRules();
        }
      });
      element.addEventListener("focus", () => {
        if (this.inputModality === "keyboard" && this.state && this.state.modalKind === null && this.previewAllowed()) {
          this.preview = preview;
          this.renderRules();
        }
      });
      element.addEventListener("blur", () => {
        if (this.preview === preview) {
          this.preview = null;
          this.renderRules();
        }
      });
    }

    previewAllowed() {
      return Boolean(this.state && this.state.modalKind === null && !this.state.inputVisible);
    }

    handleRootKeydown(event) {
      if (!this.handlers || !this.state) return;
      this.inputModality = "keyboard";
      const modalKind = this.state.modalKind;

      if (modalKind) {
        if (event.key === "Escape") {
          event.preventDefault();
          if (modalKind === "discovery") this.handlers.closeDiscovery();
          else this.handlers.newGame();
          return;
        }
        if (modalKind === "result" && event.key === "Enter" && document.activeElement !== this.elements.spotify) {
          event.preventDefault();
          this.handlers.newGame();
          return;
        }
        if (this.isArrowKey(event.key)) {
          event.preventDefault();
          this.moveModalFocus(modalKind, event.key);
          return;
        }
        this.modal.trapFocus(event);
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      if (this.isArrowKey(event.key)) {
        if (target === this.elements.guess && this.state.inputVisible) return;
        if (this.state.inputVisible && this.state.guessEnabled) {
          event.preventDefault();
          this.focusGuess();
          return;
        }
        event.preventDefault();
        this.movePrimaryFocus(event.key);
        return;
      }

      if (event.key === "Enter" && this.state.mode !== null && !target?.closest("button, input, a, .suggest")) {
        event.preventDefault();
        this.handlers.playbackShortcut();
      }
    }

    isArrowKey(key) {
      return key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight";
    }

    moveModalFocus(kind, direction) {
      const elements = kind === "result"
        ? [this.elements.next, this.elements.spotify]
        : [this.elements.discoveryClose, this.elements.discoveryReset];
      this.cycleFocus(elements, direction, elements[0]);
    }

    movePrimaryFocus(direction) {
      const elements = [
        this.elements.discoveryButton,
        this.modeButtons.daily,
        this.modeButtons.blitz,
        this.modeButtons.classic,
        this.modeButtons.survival,
        this.elements.play
      ];
      const preferred = this.state?.mode === "daily" && this.state.dailyProgress.date === this.state.dailyDate &&
        this.state.dailyProgress.completed
        ? this.modeButtons.blitz
        : this.state?.mode ? this.elements.play : this.modeButtons.daily;
      this.cycleFocus(elements, direction, preferred);
    }

    cycleFocus(elements, direction, preferred) {
      const available = elements.filter(element => this.canNavigateTo(element));
      if (!available.length) return;
      const currentIndex = available.indexOf(document.activeElement);
      if (currentIndex < 0) {
        (available.includes(preferred) ? preferred : available[0]).focus({ preventScroll: true });
        return;
      }

      const change = direction === "ArrowLeft" || direction === "ArrowUp" ? -1 : 1;
      available[(currentIndex + change + available.length) % available.length].focus({ preventScroll: true });
    }

    canNavigateTo(element) {
      if (!element.isConnected || element.hidden || element.closest("[inert]") ||
          element instanceof HTMLButtonElement && element.disabled) {
        return false;
      }
      return element.offsetParent !== null;
    }

    handlePointerDown(event) {
      if (!this.handlers || !this.state) return;
      const modality = event.pointerType === "mouse" && this.finePointer.matches
        ? "pointer-fine"
        : "pointer-coarse";
      this.inputModality = modality;
      const target = event.target instanceof Element ? event.target : null;

      if (modality === "pointer-fine" && document.activeElement === this.elements.guess &&
          target?.closest(".skip") === this.elements.skip) {
        event.preventDefault();
        return;
      }

      if (this.state.playEnabled && !this.state.inputVisible && !target?.closest("button, input, a, .suggest")) {
        event.preventDefault();
        this.focusPlay();
        return;
      }

      if (!this.state.guessEnabled || this.state.modalKind !== null || target?.closest("button, input, a, .suggest")) {
        return;
      }
      this.elements.guess.focus({ preventScroll: true });
    }

    markup() {
      return `
      <div class="wrap">
        <h1>CORZAGUESSR&#10022;</h1>
        <div class="row header-action"><button type="button" class="button discovery-button" aria-controls="corzaguessr-discovery" aria-expanded="false">DISCOVERY</button></div>
        <div class="modes" aria-label="GAME MODE">
          <button type="button" class="mode" data-mode="daily" aria-pressed="false">DAILY</button>
          <button type="button" class="mode" data-mode="blitz" aria-pressed="false">BLITZ</button>
          <button type="button" class="mode" data-mode="classic" aria-pressed="false">CLASSIC</button>
          <button type="button" class="mode" data-mode="survival" aria-pressed="false">SURVIVAL</button>
        </div>
        <div class="card glass">
          <div class="stack">
            <div class="board">
              <div class="controls">
                <div class="time"><span class="now">0:00</span></div>
                <button type="button" class="play" aria-label="PLAY" disabled><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${PLAYBACK_ICON_PATHS.play}"></path></svg></button>
                <div class="time"><span class="endtime">0:01</span></div>
              </div>
              <div class="timeline" aria-hidden="true">
                <div class="snippet"></div><div class="fill"></div><div class="feedback"></div><div class="time-change"><span></span></div>
                <i class="tick" style="left:3.125%"></i><i class="tick" style="left:6.25%"></i><i class="tick" style="left:12.5%"></i><i class="tick" style="left:25%"></i><i class="tick" style="left:50%"></i>
              </div>
              <div class="auto">
                <label class="sr-only" for="corzaguessr-guess">SEARCH FOR A TRACK</label>
                <input id="corzaguessr-guess" class="guess" placeholder="HAVE A GUESS? SEARCH FOR IT HERE!" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="corzaguessr-suggestions" aria-expanded="false" disabled>
                <div class="ruleset" aria-hidden="true"><div class="ruleset-track"><span class="ruleset-text">${TEXT.modePrompt}</span><span class="ruleset-copy">${TEXT.modePrompt}</span></div></div>
                <div id="corzaguessr-suggestions" class="suggest" role="listbox"></div>
              </div>
              <div class="row"><button type="button" class="button skip" disabled>ADD 1S</button></div>
            </div>
            <div class="history" aria-live="polite" aria-relevant="additions text">
              <div class="slot current-slot" hidden></div>
              <div class="slots"></div>
            </div>
          </div>
          <div class="result-modal"><div class="result-shell"><div class="corzaguessr-modal glass" role="dialog" aria-modal="true" aria-labelledby="corzaguessr-result-title" aria-describedby="corzaguessr-result-meta" aria-hidden="true">
            <h3 id="corzaguessr-result-title" class="modal-title"></h3><div id="corzaguessr-result-meta" class="result-meta"></div>
            <div class="actions"><button type="button" class="button next">NEW GAME</button><button type="button" class="button spotify">SPOTIFY</button></div>
          </div></div></div>
          <p class="mode-prompt" role="status" aria-hidden="false">${TEXT.modePrompt}</p>
          <div id="corzaguessr-discovery" class="discovery-modal" role="dialog" aria-modal="true" aria-labelledby="corzaguessr-discovery-title" aria-hidden="true" tabindex="-1">
            <div class="discovery-shell"><div class="discovery-panel glass">
              <h3 id="corzaguessr-discovery-title" class="discovery-title"><span>DISCOVERY</span><small>0 / 0 (0%)</small></h3>
              <div class="discovery-items" role="list"></div>
              <div class="actions"><button type="button" class="button discovery-close">CLOSE</button><button type="button" class="button discovery-reset">RESET</button></div>
            </div></div>
          </div>
        </div>
      </div>
      <p class="sr-only status" aria-live="polite"></p>
      <p class="transport-status" role="status" aria-live="polite" aria-atomic="true"></p>
      <audio class="audio" preload="metadata" playsinline aria-hidden="true" hidden></audio>
      <audio class="audio" preload="metadata" playsinline aria-hidden="true" hidden></audio>
    `;
    }

    queryElements() {
      const audioPlayers = [...this.root.querySelectorAll(".audio")];
      if (audioPlayers.length !== 2) throw new Error("Corzaguessr requires two audio elements.");

      const modeButtons = {};
      for (const button of this.root.querySelectorAll("[data-mode]")) {
        modeButtons[button.dataset.mode] = button;
      }
      for (const mode of ["daily", "blitz", "classic", "survival"]) {
        if (!modeButtons[mode]) throw new Error(`Missing required Corzaguessr mode: ${mode}`);
      }

      return {
        modeButtons,
        headerAction: this.required(".header-action"),
        modes: this.required(".modes"),
        card: this.required(".card"),
        board: this.required(".board"),
        currentSlot: this.required(".current-slot"),
        slots: this.required(".slots"),
        play: this.required(".play"),
        skip: this.required(".skip"),
        guess: this.required(".guess"),
        suggest: this.required(".suggest"),
        ruleset: this.required(".ruleset"),
        rulesetText: this.required(".ruleset-text"),
        rulesetCopy: this.required(".ruleset-copy"),
        feedback: this.required(".feedback"),
        timeline: this.required(".timeline"),
        timeChange: this.required(".time-change"),
        timeChangeText: this.required(".time-change span"),
        fill: this.required(".fill"),
        snippet: this.required(".snippet"),
        now: this.required(".now"),
        endtime: this.required(".endtime"),
        spotify: this.required(".spotify"),
        next: this.required(".next"),
        result: this.required(".corzaguessr-modal"),
        resultTitle: this.required(".modal-title"),
        resultMeta: this.required(".result-meta"),
        modePrompt: this.required(".mode-prompt"),
        discoveryButton: this.required(".discovery-button"),
        discoveryModal: this.required(".discovery-modal"),
        discoveryShell: this.required(".discovery-shell"),
        discoveryPanel: this.required(".discovery-panel"),
        discoveryCount: this.required("#corzaguessr-discovery-title small"),
        discoveryItems: this.required(".discovery-items"),
        discoveryClose: this.required(".discovery-close"),
        discoveryReset: this.required(".discovery-reset"),
        status: this.required(".status"),
        transportStatus: this.required(".transport-status"),
        icon: this.required(".icon path"),
        audioPlayers
      };
    }

    required(selector) {
      const element = this.root.querySelector(selector);
      if (!element) throw new Error(`Missing required Corzaguessr element: ${selector}`);
      return element;
    }

    clearSurvivalFeedback() {
      this.elements.feedback.classList.remove("survival-penalty", "survival-reward");
      this.elements.timeChange.classList.remove("survival-change");
      this.elements.timeChangeText.textContent = "";
    }

    duration(styles, property) {
      const value = styles.getPropertyValue(property).trim();
      if (value.endsWith("ms")) return Number.parseFloat(value) || 0;
      if (value.endsWith("s")) return (Number.parseFloat(value) || 0) * 1_000;
      return 0;
    }
  }

  function formatTime(seconds) {
    const safeSeconds = Math.max(0, seconds);
    return `${Math.floor(safeSeconds / 60)}:${String(Math.floor(safeSeconds) % 60).padStart(2, "0")}`;
  }

  function formatAccuracy(value) {
    return Number.isSafeInteger(value) ? `${value}%` : "--";
  }

  function formatAttempts(value) {
    return value ? `ATTEMPTS: ${value}` : "ATTEMPTS: --";
  }

  function formatSeconds(value) {
    if (!Number.isFinite(value) || value <= 0) return "--";
    const rounded = Math.round(value * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}S`;
  }

  function createResultModule(row, newPersonalBest) {
    const module = document.createElement("div");
    module.className = "result-module";
    module.replaceChildren(...row.map((text, index) => {
      const part = document.createElement("span");
      part.className = index ? "result-value" : "result-label";
      if (!index && newPersonalBest && text === "NEW PERSONAL BEST:") part.classList.add("blink");
      part.textContent = text;
      return part;
    }));
    return module;
  }

  function buildResultRows(result) {
    const rows = [];
    if (result.mode === "daily") {
      rows.push(
        ["TRACK:", result.trackTitle],
        ["RUN:", formatAttempts(result.attempts)],
        [result.newPersonalBest ? "NEW PERSONAL BEST:" : "PERSONAL BEST:", formatAttempts(result.bestAttempts)]
      );
    } else if (result.mode === "classic") {
      rows.push(
        ["TRACK:", result.trackTitle],
        ["RUN:", `${result.won ? "STREAK" : "STREAK ENDED"}: ${result.streak} · AVERAGE SNIPPET: ${formatSeconds(result.average)}`],
        [result.newPersonalBest ? "NEW PERSONAL BEST:" : "PERSONAL BEST:",
          `STREAK: ${result.bestStreak} · AVERAGE SNIPPET: ${formatSeconds(result.bestAverage)}`]
      );
    } else if (result.mode === "blitz") {
      rows.push(
        ["RUN:", `CORRECT GUESSES: ${result.correct} · ACCURACY: ${formatAccuracy(result.accuracy)}`],
        [result.newPersonalBest ? "NEW PERSONAL BEST:" : "PERSONAL BEST:",
          `CORRECT GUESSES: ${result.bestCorrect} · ACCURACY: ${formatAccuracy(result.bestAccuracy)}`]
      );
    } else {
      rows.push(
        ["RUN:", `TIME SURVIVED: ${formatTime(result.elapsedMs / 1_000)} · ACCURACY: ${formatAccuracy(result.accuracy)}`],
        [result.newPersonalBest ? "NEW PERSONAL BEST:" : "PERSONAL BEST:",
          `TIME SURVIVED: ${formatTime(result.bestElapsedMs / 1_000)} · ACCURACY: ${formatAccuracy(result.bestAccuracy)}`]
      );
    }
    return rows;
  }

  function buildResultAnnouncement(result, rows) {
    const title = result.mode === "blitz" || result.mode === "survival"
      ? "TIME IS UP."
      : result.won ? "YOU GOT IT." : "YOU GOT IT ALL WRONG.";
    const details = rows.map(row => {
      const label = row[0]?.replace(/:$/, "") ?? "RESULT";
      return `${label}. ${row.slice(1).join(". ")}`.trim();
    }).join(". ");
    return `${title} ${details}`.trim();
  }

  const root = document.querySelector("#corzaguessr");
  if (root && !root.dataset.corzaguessrReady) {
    try {
      const catalog = new TrackCatalog(TRACKS);
      const view = new GameView(root, catalog);
      const repository = new LocalProgressRepository();
      const progress = new ProgressService(repository, message => view.announce(message));
      let game;
      const clock = new GameClock({
        onTick: snapshot => game.onClockTick(snapshot),
        onExpired: () => game.onClockExpired()
      });
      const trackBaseUrl = "https://cdn.jsdelivr.net/gh/HankeyThePoo/corzaguessr@main/tracks/";
      const audio = new AudioDeck(view.audioPlayers, round => {
        const url = new URL(`${String(round.track.dailyNumber).padStart(2, "0")}.mp3`, trackBaseUrl);
        url.hash = `t=${round.clipStart}`;
        return url.href;
      }, {
        onPlaying: roundId => game.onAudioPlaying(roundId),
        onWaiting: event => game.onAudioWaiting(event),
        onEnded: roundId => game.onAudioEnded(roundId),
        onBlocked: roundId => game.onAudioBlocked(roundId),
        onFailure: failure => game.onAudioFailure(failure)
      });
      const dailyBoundary = new DailyBoundaryTimer(date => game.handleDateChanged(date));

      game = new GameController({
        catalog,
        progress,
        clock,
        audio,
        view,
        dailyBoundary
      });

      view.bind({
        selectMode: mode => game.selectMode(mode),
        play: () => game.play(),
        playbackShortcut: () => game.playbackShortcut(),
        skip: () => game.skip(),
        guess: dailyNumber => game.guess(dailyNumber),
        newGame: () => game.newGame(),
        openDiscovery: () => game.openDiscovery(),
        closeDiscovery: () => game.closeDiscovery(),
        resetDiscovery: () => game.resetDiscovery(),
        openSpotify: () => game.openSpotify()
      });

      game.bootstrap(dailyBoundary.current());
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) game.handleVisibilityHidden();
        else game.handleVisibilityVisible();
      });
      window.addEventListener("pageshow", () => game.handleVisibilityVisible());
    } catch {
      root.dataset.corzaguessrReady = "error";
      const error = document.createElement("p");
      error.setAttribute("role", "alert");
      error.textContent = "CORZAGUESSR COULD NOT START. PLEASE REFRESH OR TRY AGAIN LATER.";
      root.replaceChildren(error);
    }
  }
})();
