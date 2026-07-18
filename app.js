"use strict";
(() => {
  const h = Object.freeze([1, 2, 4, 8, 16, 32]),
    F = 19,
    re = 60,
    LAST_ATTEMPT_INDEX = h.length - 1,
    MAX_SNIPPET_SECONDS = h.at(-1),
    v = Object.freeze({
      discoveries: "corzaguessrDiscovered",
      daily: "corzaguessrDaily",
      personalBests: "corzaguessrPersonalBests"
    }),
    p = Object.freeze({
      modePrompt: "SELECT A MODE TO BEGIN",
      loadingTrack: "LOADING TRACK...",
      trackError: "COULD NOT PLAY TRACK, PRESS PLAY TO RETRY!",
      discovery: "REVEAL TRACKS YOU'VE GUESSED CORRECTLY AND TRACK YOUR DISCOVERY PROGRESS"
    }),
    f = Object.freeze({
      classic: Object.freeze({
        timed: !1,
        daily: !1,
        clockKind: "classic",
        initialTimeMs: null,
        description: "GUESS THE TRACK IN SIX TRIES AS MORE AUDIO IS REVEALED"
      }),
      daily: Object.freeze({
        timed: !1,
        daily: !0,
        clockKind: "classic",
        initialTimeMs: null,
        description: "ONE SHARED TRACK EACH DAY, GUESS IT IN SIX TRIES"
      }),
      blitz: Object.freeze({
        timed: !0,
        daily: !1,
        clockKind: "blitz",
        initialTimeMs: 6e4,
        description: "GUESS AS MANY TRACKS AS POSSIBLE BEFORE THE TIMER RUNS OUT"
      }),
      survival: Object.freeze({
        timed: !0,
        daily: !1,
        clockKind: "survival",
        initialTimeMs: 3e4,
        description: "CORRECT GUESSES ADD TIME; MISTAKES AND SKIPS DRAIN IT"
      })
    });

  function modePolicy(r) {
    return r ? f[r] ?? null : null
  }

  function c(r) {
    return modePolicy(r)?.timed === !0
  }

  function ne(r) {
    if (typeof r != "string") return !1;
    let e = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r);
    if (!e) return !1;
    let t = Number(e[1]),
      i = Number(e[2]),
      s = Number(e[3]);
    if (i < 1 || i > 12 || s < 1) return !1;
    let o = [31, t % 4 === 0 && (t % 100 !== 0 || t % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30,
      31
    ];
    return s <= o[i - 1]
  }

  function P(r) {
    let e = 2166136261;
    for (let t = 0; t < r.length; t += 1) e ^= r.charCodeAt(t), e = Math.imul(e, 16777619);
    return e >>> 0
  }

  function y(r) {
    return h[Math.max(0, Math.min(LAST_ATTEMPT_INDEX, r))]
  }

  function U(r, e) {
    return c(r) ? "SKIP" : e >= LAST_ATTEMPT_INDEX ? "GIVE UP" : `ADD ${h[e+1]-h[e]}S`
  }

  function q(r) {
    let e = r === LAST_ATTEMPT_INDEX;
    return {
      text: e ? "LAST CHANCE TO GUESS" : `GUESS ${r+1} OUT OF ${h.length}`,
      tone: e ? "blink prompt" : "prompt"
    }
  }

  function W(r) {
    return {
      text: `GUESS #${r}`,
      tone: "prompt"
    }
  }

  function V(r) {
    return r === "correct" ? 3e3 : r === "wrong" ? -1e3 : -2e3
  }

  function D(r, e) {
    return e > 0 ? Math.round(r * 100 / e) : 0
  }

  function b(r) {
    return Number.isSafeInteger(r) && r >= 0 ? r : 0
  }

  function oe(r) {
    return Number.isSafeInteger(r) && r >= 0 && r <= 100 ? r : null
  }

  function J(r) {
    let e = r && typeof r == "object" && !Array.isArray(r) ? r : {},
      t = typeof e.date == "string" && ne(e.date) ? e.date : "",
      i = Number.isSafeInteger(e.dailyNumber) && e.dailyNumber > 0 ? e.dailyNumber : null,
      s = t !== "" && i !== null,
      n = e.started === !0 && s,
      o = n && e.completed === !0,
      a = Number.isSafeInteger(e.step) && e.step >= 0 && e.step < h.length ? e.step : 0;
    return {
      date: s ? t : "",
      dailyNumber: s ? i : null,
      started: n,
      completed: o,
      won: o && e.won === !0,
      step: a
    }
  }

  function $(r) {
    let e = r && typeof r == "object" && !Array.isArray(r) ? r : {},
      t = e.classic && typeof e.classic == "object" && !Array.isArray(e.classic) ? e.classic : {},
      i = b(t.current),
      s = b(t.snippetTotal);
    (s < i || s > i * MAX_SNIPPET_SECONDS) && (i = 0, s = 0);
    let n = Math.max(i, b(t.best)),
      o = b(t.bestSnippetTotal);
    (o < n || o > n * MAX_SNIPPET_SECONDS) && (o = i === n ? s : 0);
    let a = d => {
        let u = d && typeof d == "object" && !Array.isArray(d) ? d : {};
        return {
          score: b(u.score),
          accuracy: oe(u.accuracy)
        }
      },
      l = a(e.survival);
    return l.score = Math.floor(l.score / 1e3) * 1e3, {
      classic: {
        current: i,
        best: n,
        snippetTotal: s,
        bestSnippetTotal: o
      },
      daily: b(e.daily),
      blitz: a(e.blitz),
      survival: l
    }
  }

  function K(r, e, t) {
    return !e || r.daily && t >= r.daily ? !1 : (r.daily = t, !0)
  }

  function _(r, e, t) {
    let i = r.classic;
    if (e) {
      i.current += 1, i.snippetTotal += y(t);
      let a = i.snippetTotal / i.current,
        l = i.current > i.best || i.current === i.best && (!i.bestSnippetTotal || i.snippetTotal < i
          .bestSnippetTotal);
      return l && (i.best = i.current, i.bestSnippetTotal = i.snippetTotal), {
        changed: !0,
        newPersonalBest: l,
        streak: i.current,
        average: a
      }
    }
    let s = i.current,
      n = i.current ? i.snippetTotal / i.current : 0,
      o = i.current !== 0 || i.snippetTotal !== 0;
    return i.current = 0, i.snippetTotal = 0, {
      changed: o,
      newPersonalBest: !1,
      streak: s,
      average: n
    }
  }

  function N(r, e, t, i) {
    let s = r[e],
      n = t > s.score,
      o = e === "blitz" && t > 0 && t === s.score && i > (s.accuracy ?? -1);
    return !n && !o ? !1 : (r[e] = {
      score: t,
      accuracy: i
    }, !0)
  }

  function g(r = new Date) {
    let e = new Intl.DateTimeFormat("en", {
        timeZone: "Europe/Budapest",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }),
      t = Object.fromEntries(e.formatToParts(r).map(({
        type: i,
        value: s
      }) => [i, s]));
    return `${t.year}-${t.month}-${t.day}`
  }

  const S = 180,
    ae = 700,
    le = 1e4,
    de = 2,
    Y = 2;

  function ce() {
    return {
      date: "",
      dailyNumber: null,
      started: !1,
      completed: !1,
      won: !1,
      step: 0
    }
  }

  function ue() {
    return {
      classic: {
        current: 0,
        best: 0,
        snippetTotal: 0,
        bestSnippetTotal: 0
      },
      daily: 0,
      blitz: {
        score: 0,
        accuracy: null
      },
      survival: {
        score: 0,
        accuracy: null
      }
    }
  }

  function dailyProgressState(r, e) {
    if (r.date !== e || !r.started) return "not-started";
    if (!r.completed) return "in-progress";
    return r.won ? "won" : "lost"
  }

  function j(r) {
    let e = modePolicy(r);
    return {
      mode: r,
      run: !e ? null : e.timed ? {
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
      failedTrackIds: new Set,
      guessedTrackIds: new Set,
      result: null
    }
  }

  function m(r) {
    return r === "starting" || r === "playing" || r === "buffering"
  }

  function L(r, e) {
    return r === "playing" || (r === "paused" || r === "starting" || r === "buffering") && e.playedOnce
  }

  class ProgressCoordinator {
    repository;
    announce;
    discoveries = new Set;
    daily = ce();
    personalBests = ue();
    discoveryRevision = 0;
    constructor(r, e) {
      this.repository = r, this.announce = e
    }
    load() {
      let r = this.repository.load();
      this.discoveries = r.discoveries, this.daily = r.daily, this.personalBests = r.personalBests, this
        .discoveryRevision += 1
    }
    dailyState(r) {
      return dailyProgressState(this.daily, r)
    }
    dailyInProgress(r) {
      return this.dailyState(r) === "in-progress"
    }
    dailyComplete(r) {
      let e = this.dailyState(r);
      return e === "won" || e === "lost"
    }
    dailyCompletionText(r) {
      let e = this.daily.step + 1;
      return `${this.dailyState(r)==="won"?"COMPLETED":"FAILED"} IN ${e} ATTEMPT${e===1?"":"S"}, COME BACK TOMORROW`
    }
    markDailyStarted(r, e, t) {
      this.dailyState(r) !== "not-started" || (this.daily = {
        date: r,
        dailyNumber: e,
        started: !0,
        completed: !1,
        won: !1,
        step: t
      }, this.saveDaily())
    }
    updateDailyStep(r, e) {
      this.dailyInProgress(r) && this.daily.step !== e && (this.daily = {
        ...this.daily,
        step: e
      }, this.saveDaily())
    }
    recordDiscovery(r) {
      if (this.discoveries.has(r)) return;
      this.discoveries.add(r), this.discoveryRevision += 1, this.repository.saveDiscoveries(this.discoveries) || this
        .announce("DISCOVERY PROGRESS COULD NOT BE SAVED IN THIS BROWSER.")
    }
    resetDiscoveries() {
      let r = new Set;
      if (!this.repository.saveDiscoveries(r)) return !1;
      this.discoveries.clear(), this.discoveryRevision += 1;
      return !0
    }
    buildResult(r, e) {
      let t, i = !1;
      if (r === "daily") {
        let s = e.won === !0;
        this.daily = {
          date: e.dailyDate,
          dailyNumber: e.track.dailyNumber,
          started: !0,
          completed: !0,
          won: s,
          step: e.attempt
        }, this.saveDaily();
        let n = K(this.personalBests, s, e.attempt + 1);
        i = n, t = {
          mode: r,
          won: s,
          trackTitle: e.track.title,
          spotify: e.track.spotify,
          newPersonalBest: n,
          attempts: e.attempt + 1,
          bestAttempts: this.personalBests.daily
        }
      } else if (r === "classic") {
        let s = e.won === !0,
          n = _(this.personalBests, s, e.attempt),
          o = this.personalBests.classic;
        i = n.changed, t = {
          mode: r,
          won: s,
          trackTitle: e.track.title,
          spotify: e.track.spotify,
          newPersonalBest: n.newPersonalBest,
          streak: n.streak,
          average: n.average,
          bestStreak: o.best,
          bestAverage: o.best ? o.bestSnippetTotal / o.best : 0
        }
      } else if (r === "blitz") {
        let s = D(e.correct, e.guesses),
          n = N(this.personalBests, r, e.correct, s);
        i = n, t = {
          mode: r,
          newPersonalBest: n,
          correct: e.correct,
          accuracy: s,
          bestCorrect: this.personalBests.blitz.score,
          bestAccuracy: this.personalBests.blitz.accuracy
        }
      } else {
        let s = Math.floor(e.elapsedMs / 1e3) * 1e3,
          n = D(e.correct, e.guesses),
          o = N(this.personalBests, r, s, n);
        i = o, t = {
          mode: r,
          newPersonalBest: o,
          elapsedMs: s,
          accuracy: n,
          bestElapsedMs: this.personalBests.survival.score,
          bestAccuracy: this.personalBests.survival.accuracy
        }
      }
      return i && this.savePersonalBests(), t
    }
    saveDaily() {
      this.repository.saveDaily(this.daily) || this.announce("DAILY PROGRESS COULD NOT BE SAVED IN THIS BROWSER.")
    }
    savePersonalBests() {
      this.repository.savePersonalBests(this.personalBests) || this.announce(
        "PERSONAL BESTS COULD NOT BE SAVED IN THIS BROWSER.")
    }
  }

  class TransportCoordinator {
    clock;
    audio;
    announce;
    onStatusChanged;
    onWatchdogFailure;
    getCurrentRound;
    getAudioPhase;
    status = "";
    loadingTimer = 0;
    loadingAnnouncementRoundId = null;
    watchdog = null;
    recoveryAttempts = null;
    constructor(r) {
      this.clock = r.clock, this.audio = r.audio, this.announce = r.announce, this.onStatusChanged = r.onStatusChanged,
        this.onWatchdogFailure = r.onWatchdogFailure, this.getCurrentRound = r.getCurrentRound, this.getAudioPhase =
        r.getAudioPhase
    }
    quiesce(r = {}) {
      let {
        pauseClock: e = !0,
        pauseAudio: t = !1,
        stopAudio: i = !1,
        releaseActivePhase: s,
        cancelWatchdog: n = !0,
        clearStatus: o = !0
      } = r;
      e && this.clock.pause(), i ? this.audio.stop() : s !== void 0 ? this.audio.releaseActive(s) : t && this.audio
        .pause(), n && this.cancelWatchdog(), o && this.clearStatus()
    }
    setStatus(r, e = !1) {
      this.clearStatus(), this.status = r, e && this.announce(r)
    }
    beginLoadingNotice(r, e) {
      this.clearStatus(), this.loadingTimer = window.setTimeout(() => {
        this.loadingTimer = 0;
        let t = this.getCurrentRound();
        t?.id === r.id && ["starting", "buffering"].includes(this.getAudioPhase()) && (this.status = p.loadingTrack,
          this.onStatusChanged())
      }, e)
    }
    revealLoading() {
      this.loadingTimer && clearTimeout(this.loadingTimer), this.loadingTimer = 0, this.status = p.loadingTrack
    }
    clearStatus() {
      this.loadingTimer && clearTimeout(this.loadingTimer), this.loadingTimer = 0, this.status = ""
    }
    announceLoading(r) {
      this.loadingAnnouncementRoundId !== r.id && (this.loadingAnnouncementRoundId = r.id, this.announce(
        "TRACK IS LOADING."))
    }
    resetLoadingAnnouncement() {
      this.loadingAnnouncementRoundId = null
    }
    armWatchdog(r) {
      this.cancelWatchdog();
      let e = window.setTimeout(() => {
        if (!this.watchdog || this.watchdog.timer !== e) return;
        this.watchdog = null;
        let t = this.getCurrentRound();
        t?.id === r.id && ["starting", "buffering"].includes(this.getAudioPhase()) && this.onWatchdogFailure({
          role: "active",
          roundId: r.id,
          trackId: r.track.dailyNumber,
          previousPhase: this.getAudioPhase()
        })
      }, le);
      this.watchdog = {
        timer: e,
        roundId: r.id
      }
    }
    cancelWatchdog() {
      this.watchdog && clearTimeout(this.watchdog.timer), this.watchdog = null
    }
    claimRecovery() {
      this.recoveryAttempts === null && (this.recoveryAttempts = 0);
      return this.recoveryAttempts >= de ? !1 : (this.recoveryAttempts += 1, !0)
    }
    endRecovery() {
      this.recoveryAttempts = null
    }
  }

  class GamePresenter {
    view;
    clock;
    constructor(r, e) {
      this.view = r, this.clock = e
    }
    render(r, e, t) {
      this.view.render({
        ...r,
        clock: this.clock.snapshot()
      }, e, t)
    }
  }

  class E {
    catalog;
    progress;
    clock;
    audio;
    view;
    dailyBoundary;
    presenter;
    transport;
    model = j(null);
    budapestDate = "1970-01-01";
    dailyDate = "1970-01-01";
    nextRoundId = 0;
    historySequence = 0;
    historyRevision = 0;
    currentSlotRevision = 0;
    guessedRevision = 0;
    finishing = !1;
    constructor(r) {
      this.catalog = r.catalog, this.progress = r.progress, this.clock = r.clock, this.audio = r.audio, this.view = r
        .view, this.dailyBoundary = r.dailyBoundary ?? null, this.presenter = new GamePresenter(this.view, this.clock),
        this.transport = new TransportCoordinator({
          clock: this.clock,
          audio: this.audio,
          announce: e => this.view.announce(e),
          onStatusChanged: () => this.render(),
          onWatchdogFailure: e => this.onAudioFailure(e),
          getCurrentRound: () => this.model.current,
          getAudioPhase: () => this.audio.phase
        })
    }
    get policy() {
      return modePolicy(this.model.mode)
    }
    get timedRun() {
      return this.model.run?.kind === "timed" ? this.model.run : null
    }
    get sixTryRun() {
      return this.model.run?.kind === "six-try" ? this.model.run : null
    }
    get attempt() {
      return this.sixTryRun?.attempt ?? 0
    }
    set attempt(r) {
      this.sixTryRun && (this.sixTryRun.attempt = r)
    }
    get roundNumber() {
      return this.timedRun?.roundNumber ?? 0
    }
    get isResult() {
      return this.model.result !== null
    }
    get isDailyComplete() {
      return this.model.mode === "daily" && this.progress.dailyComplete(this.dailyDate)
    }
    bootstrap(r) {
      this.budapestDate = r, this.progress.load(), this.dailyDate = r, this.render(), this.view.focusMode("daily")
    }
    selectMode(r) {
      if (this.view.modal.isBlocking || this.model.mode === r) return;
      if (r === "daily") {
        let e = this.dailyBoundary?.start() ?? this.budapestDate;
        this.budapestDate = e, this.dailyDate = e
      } else this.dailyBoundary?.stop();
      this.resetForMode(r), this.view.announce(f[r].description), this.focusRecommendedPrimary()
    }
    play() {
      this.handlePlay(!1)
    }
    playbackShortcut() {
      this.handlePlay(!0)
    }
    skip() {
      let r = this.model.current;
      if (r && this.policy?.timed && !r.playedOnce && m(this.audio.phase)) {
        this.transport.announceLoading(r);
        return
      }
      this.resolveAttempt("skip", null)
    }
    guess(r) {
      let e = this.model.current;
      if (!e || this.view.modal.isBlocking) return;
      if (!e.playedOnce && (this.audio.phase === "paused" || m(this.audio.phase))) {
        this.policy?.timed && this.model.currentSlot && this.transport.announceLoading(e);
        return
      }
      if (!L(this.audio.phase, e) || this.model.guessedTrackIds.has(r)) return;
      let t = this.catalog.get(r);
      t && (this.model.guessedTrackIds.add(r), this.guessedRevision += 1, this.resolveAttempt(r === e.track.dailyNumber ?
        "correct" : "wrong", t))
    }
    newGame() {
      if (!this.model.mode) return;
      if (this.view.modal.openKind === "result") {
        this.view.modal.close("result", {
          beforeClose: () => this.resetAfterResult(),
          afterClose: () => {
            this.render(), this.focusRecommendedPrimary(!0)
          }
        });
        return
      }
      this.resetForMode(this.model.mode)
    }
    openDiscovery() {
      if (this.view.modal.openKind === "discovery") {
        this.closeDiscovery();
        return
      }
      if (this.view.modal.isBlocking || this.isResult) return;
      let r = this.model.current;
      r && (m(this.audio.phase) && this.transport.quiesce(), this.audio.suspend(r.id)), this.view.modal
        .openDiscovery(), this.view.resetTransientUi(), this.render()
    }
    closeDiscovery() {
      this.view.modal.openKind === "discovery" && this.view.modal.close("discovery", {
        afterClose: () => {
          let r = this.model.current;
          if (r) {
            let e = this.audio.restore(r.id);
            e?.type === "ended" ? this.onAudioEnded(r.id, !1) : e?.type === "failed" && this.onAudioFailure({
              role: "active",
              roundId: r.id,
              trackId: r.track.dailyNumber,
              previousPhase: e.previousPhase
            })
          }
          this.prefetchNextRound(), this.render(), this.model.mode && this.focusRecommendedPrimary(!0)
        }
      })
    }
    resetDiscovery() {
      if (this.view.modal.openKind !== "discovery") return;
      if (!this.progress.resetDiscoveries()) {
        this.view.announce("DISCOVERY COULD NOT BE RESET IN THIS BROWSER.");
        return
      }
      this.view.announce("DISCOVERY RESET."), this.render()
    }
    openSpotify() {
      let r = this.model.result,
        e = r?.mode === "classic" || r?.mode === "daily" ? r.spotify : "";
      e && window.open(`https://open.spotify.com/track/${e}`, "_blank", "noopener,noreferrer")
    }
    handleDateChanged(r) {
      this.model.mode !== "daily" || r === this.budapestDate || (this.budapestDate = r, !this.isResult && (this
        .dailyDate = r, this.resetForMode("daily")))
    }
    handleVisibilityVisible() {
      this.model.mode === "daily" && this.dailyBoundary?.reconcile()
    }
    handleVisibilityHidden() {
      let r = this.model.current;
      !r || !m(this.audio.phase) || this.isResult || (this.transport.quiesce({
        pauseAudio: !0
      }), this.render())
    }
    onAudioPlaying(r) {
      let e = this.model.current;
      if (!e || e.id !== r || this.audio.phase !== "playing") return;
      e.playedOnce = !0, this.transport.cancelWatchdog(), this.transport.clearStatus(), this.transport.endRecovery(),
        this.model.failedTrackIds.clear(), this.model.mode !== "daily" && (this.model.previousTrackId = e.track
          .dailyNumber), this.model.guessedTrackIds.clear(), this.guessedRevision += 1, this.showCurrentPrompt(), this
        .clock.start(), this.render(), this.view.focusGuess()
    }
    onAudioWaiting(r) {
      let e = this.model.current;
      if (!e || e.id !== r.roundId || this.audio.phase !== "buffering") return;
      let t = this.clock.isRunning;
      this.clock.pause(), t && this.transport.armWatchdog(e), !(this.policy?.timed && this.roundNumber > 1 && !e
        .playedOnce && this.transport.loadingTimer !== 0) && this.transport.status !== p.loadingTrack && this
        .transport.revealLoading(), this.render()
    }
    onAudioBlocked(r) {
      let e = this.model.current;
      !e || e.id !== r || (this.transport.quiesce(), this.transport.setStatus("PRESS PLAY TO START THE AUDIO.", !0),
        this.render())
    }
    onAudioEnded(r, e = !0) {
      let t = this.model.current;
      !t || t.id !== r || !t.playedOnce || this.isResult || (this.transport.quiesce({
        pauseAudio: !0
      }), this.policy?.timed ? this.resolveAttempt("skip", null, {
        autoplayNext: e
      }) : this.render())
    }
    onAudioFailure(r) {
      let e = this.timedRun;
      if (r.role === "standby") {
        if (e?.next?.id !== r.roundId) return;
        e.next = null, r.trackId !== null && this.model.failedTrackIds.add(r.trackId), e.nextFailures += 1, e
          .nextFailures < Y && queueMicrotask(() => this.prefetchNextRound());
        return
      }
      let t = this.model.current;
      if (!t || t.id !== r.roundId || this.isResult) return;
      let i = m(r.previousPhase);
      this.transport.quiesce({
        releaseActivePhase: "failed"
      }), this.model.mode !== "daily" && this.model.failedTrackIds.add(t.track.dailyNumber), !(!(this.model.mode ===
        "daily" || this.model.mode === "classic" && t.playedOnce) && this.transport.claimRecovery() && (this.view
        .announce("THE SELECTED TRACK COULD NOT BE PLAYED. TRYING ANOTHER."), this.replaceCurrent(t, i))) && this
        .enterFailedState()
    }
    onClockTick(r) {
      this.view.renderClock(r)
    }
    onClockExpired() {
      this.finishing || this.isResult || !this.model.current || (this.policy?.timed ? this.finishGame() : (this
        .transport.quiesce({
          pauseClock: !1,
          pauseAudio: !0
        }), this.render()))
    }
    finishIfExpired(r) {
      return r.expired || r.remainingMs <= 0 ? (this.finishGame(), !0) : !1
    }
    handlePlay(r) {
      this.model.mode === "daily" && this.dailyBoundary?.reconcile();
      let e = this.model.current;
      if (!this.model.mode || !e || this.view.modal.isBlocking || this.isDailyComplete || this.isResult) return;
      if (this.audio.phase === "failed") {
        this.transport.endRecovery(), this.showCurrentPrompt();
        if (!this.stageRound(e, "prepare", "Audio could not be staged for retry.")) return;
        this.requestPreparedPlayback(e, !1, S);
        return
      }
      if (!e.playedOnce && this.audio.phase === "paused") {
        this.showCurrentPrompt(), this.requestPreparedPlayback(e, !1, S);
        return
      }
      this.policy?.timed ? this.handleTimedPlayback(e) : this.handleSixTryPlayback(e, r)
    }
    handleSixTryPlayback(r, e) {
      if (e && r.playedOnce && ["playing", "paused", "buffering", "starting"].includes(this.audio.phase)) {
        let t = this.clock.pauseAndSnapshot().elapsedMs;
        this.audio.pause(), this.transport.cancelWatchdog(), this.restartUntimedPlayback(r, y(this.attempt) * 1e3,
          t);
        return
      }
      if (m(this.audio.phase)) {
        this.transport.quiesce({
          pauseAudio: !0
        }), this.view.beginProgressReset(!0), this.clock.restartClassic(y(this.attempt) * 1e3), this.render(), this
          .view.focusGuess();
        return
      }
      if (this.audio.phase !== "paused") return;
      let t = this.clock.snapshot().elapsedMs;
      this.restartUntimedPlayback(r, y(this.attempt) * 1e3, t)
    }
    handleTimedPlayback(r) {
      if (m(this.audio.phase)) {
        this.transport.quiesce({
          pauseAudio: !0
        }), this.render(), this.view.focusGuess();
        return
      }
      this.audio.phase === "paused" && this.requestPreparedPlayback(r, !1, S)
    }
    resolveAttempt(r, e, t = {}) {
      let i = this.model.current,
        s = this.model.mode;
      if (!i || !s || !L(this.audio.phase, i) || this.view.modal.isBlocking || this.finishing) return;
      if (this.policy?.timed && this.finishIfExpired(this.clock.pauseAndSnapshot())) return;
      r === "correct" && this.progress.recordDiscovery(i.track.dailyNumber), this.policy?.timed ? this
        .resolveTimedAttempt(s, r, e, t.autoplayNext !== !1) : this.resolveSixTryAttempt(i, s, r, e)
    }
    resolveSixTryAttempt(r, e, t, i) {
      let s = this.createAttemptSlot(e, t, i?.title ?? ""),
        n = t === "correct" || this.attempt === LAST_ATTEMPT_INDEX;
      if (n ? (this.setCurrentSlot(s), this.view.resetTransientUi()) : this.archiveAttempt(s), this.view.announce(t ===
          "correct" ? "CORRECT." : t === "wrong" ? "INCORRECT. TRY AGAIN." : "SKIPPED. MORE TIME ADDED."), n) {
        this.finishGame(t === "correct");
        return
      }
      let o = this.clock.snapshot();
      this.attempt += 1, this.showCurrentPrompt(), e === "daily" && this.progress.updateDailyStep(this.dailyDate, this
        .attempt);
      let a = y(this.attempt) * 1e3;
      if (o.running) {
        this.clock.extendClassic(a), this.render(), this.view.focusGuess();
        return
      }
      this.restartUntimedPlayback(r, a, o.elapsedMs)
    }
    resolveTimedAttempt(r, e, t, i) {
      let s = this.timedRun;
      if (!s) return;
      if (this.archiveAttempt(this.createAttemptSlot(r, e, t?.title ?? "")), this.view.announce(e === "correct" ?
          "CORRECT." : e === "wrong" ? "INCORRECT." : "SKIPPED."), this.transport.quiesce({
          pauseClock: !1,
          pauseAudio: !0
        }), e !== "skip" && (s.guesses += 1), e === "correct" && (s.correct += 1), r === "survival") {
        let n = V(e);
        this.view.flashSurvivalChange(n / 1e3);
        if (this.finishIfExpired(this.clock.adjust(n))) return
      }
      s.roundNumber += 1, this.advanceTimedRound(i)
    }
    advanceTimedRound(r = !0) {
      let e = this.model.current,
        t = this.timedRun;
      if (!e || !t) return;
      let i = t.next,
        s = i ?? this.createRound(e.track.dailyNumber);
      if (this.model.current = s, t.next = null, t.nextFailures = 0, this.showCurrentPrompt(), !this.stageRound(s, i ?
          "promote" : "prepare", i ? "Prepared standby audio could not be promoted." :
          "Audio could not be staged for the next round.")) return;
      this.model.current.id === s.id && (this.prefetchNextRound(), r ? this.requestPreparedPlayback(s, !1, ae) : this
        .render())
    }
    restartUntimedPlayback(r, e, t) {
      t > 0 && this.view.beginProgressReset(!0), this.clock.restartClassic(e), !(this.model.current?.id !== r.id ||
        this.isResult || this.view.modal.isBlocking) && this.requestPreparedPlayback(r, !0, S)
    }
    finishGame(r) {
      let e = this.model.current,
        t = this.model.mode;
      if (!e || !t || this.isResult || this.finishing) return;
      this.finishing = !0;
      try {
        let i = this.clock.pauseAndSnapshot(),
          s = this.timedRun;
        this.audio.stop(), s && (s.next = null), this.transport.cancelWatchdog(), this.transport.clearStatus(), this
          .transport.endRecovery(), this.policy?.timed && this.setCurrentSlot({
            text: "TIME'S UP",
            tone: ""
          }), this.model.result = this.progress.buildResult(t, {
            won: r === !0,
            track: e.track,
            attempt: this.attempt,
            correct: s?.correct ?? 0,
            guesses: s?.guesses ?? 0,
            elapsedMs: i.elapsedMs,
            dailyDate: this.dailyDate
          }), this.view.modal.openResult(), this.view.resetTransientUi(), this.render()
      } finally {
        this.finishing = !1
      }
    }
    resetAfterResult() {
      let r = this.model.mode;
      r && (r === "daily" && this.dailyDate !== this.budapestDate && (this.dailyDate = this.budapestDate), this
        .resetForMode(r))
    }
    resetForMode(r) {
      let e = this.model.previousTrackId;
      this.transport.quiesce({
        pauseClock: !1,
        stopAudio: !0
      }), this.transport.endRecovery(), this.model = j(r), this.model.previousTrackId = e, this.historyRevision += 1,
        this.currentSlotRevision += 1, this.guessedRevision += 1, r === "daily" && this.progress.dailyInProgress(this
          .dailyDate) && (this.attempt = this.progress.daily.step);
      let t = f[r],
        i = t.initialTimeMs ?? y(this.attempt) * 1e3;
      this.view.beginProgressReset(), this.clock.configure({
        kind: t.clockKind,
        initialMs: i,
        limitMs: t.timed ? void 0 : i
      }), this.view.resetTransientUi(), this.isDailyComplete || this.primeCurrent(), this.render()
    }
    stageRound(r, e, t) {
      let i = e === "promote" ? this.audio.promote(r.id) : e === "preload" ? this.audio.preload(r) : this.audio
        .prepare(r);
      return i || this.reportRejectedAudioOperation(r, t, e === "preload" ? "standby" : "active"), i
    }
    primeCurrent() {
      if (!this.model.mode || this.model.current || this.view.modal.blocksRoundPreparation) return;
      let r = this.createRound();
      if (this.model.current = r, !this.stageRound(r, "prepare", "Audio could not be staged before Play.")) return;
      this.model.current?.id === r.id && this.prefetchNextRound()
    }
    prefetchNextRound() {
      let r = this.timedRun,
        e = this.model.current;
      if (!r || !e || r.next || r.nextFailures >= Y || this.view.modal.blocksRoundPreparation || this.isResult) return;
      let t = this.createRound(e.track.dailyNumber);
      r.next = t, this.stageRound(t, "preload", "Standby audio could not be staged.")
    }
    replaceCurrent(r, e) {
      let t = this.timedRun,
        i = t?.next ?? null,
        s = i ?? this.createRound(r.track.dailyNumber);
      this.model.current = s, t && i && (t.next = null), t && (t.nextFailures = 0), this.transport
        .resetLoadingAnnouncement();
      let n = this.stageRound(s, i ? "promote" : "prepare", i ? "Prepared standby audio could not be promoted." :
        "Replacement audio could not be staged.");
      return n ? (this.model.current?.id !== s.id || (this.prefetchNextRound(), e ? this.requestPreparedPlayback(s, !1,
        S) : (this.render(), this.view.focusPlay())), !0) : this.model.current?.id !== s.id
    }
    createRound(r = this.model.previousTrackId) {
      let e = this.model.mode,
        t = e === "daily" ? this.catalog.dailyTrack(this.dailyDate, this.progress.dailyInProgress(this.dailyDate) ?
          this.progress.daily.dailyNumber : null) : this.catalog.randomTrack(this.model.failedTrackIds, r);
      return {
        id: ++this.nextRoundId,
        track: t,
        clipStart: e === "daily" ? this.catalog.dailyClipStart(t, this.dailyDate) : this.catalog.randomClipStart(t,
          this.policy?.timed === !0),
        playedOnce: !1
      }
    }
    createAttemptSlot(r, e, t) {
      let i = t;
      if (e === "skip")
        if (modePolicy(r)?.timed) i = "SKIPPED";
        else {
          let s = this.attempt === LAST_ATTEMPT_INDEX,
            n = s ? 0 : y(this.attempt + 1) - y(this.attempt);
          i = s ? "FINAL GUESS SKIPPED" :
            `GUESS ${this.attempt+1} SKIPPED, ${n} SECOND${n===1?"":"S"} ADDED`
        }
      return {
        text: i,
        tone: e
      }
    }
    archiveAttempt(r) {
      let e = this.model.history;
      e.unshift({
        key: `history-${++this.historySequence}`,
        ...r
      }), this.policy?.timed && e.length > F && (e.length = F), this.historyRevision += 1, this.view
        .resetTransientUi()
    }
    setCurrentSlot(r) {
      let e = this.model.currentSlot;
      e?.text === r?.text && e?.tone === r?.tone || (this.model.currentSlot = r, this.currentSlotRevision += 1)
    }
    showCurrentPrompt() {
      if (!this.model.mode) return;
      let r = this.timedRun;
      r && r.roundNumber === 0 && (r.roundNumber = 1), this.setCurrentSlot(r ? W(r.roundNumber) : q(this.attempt))
    }
    requestPreparedPlayback(r, e, t) {
      if (this.model.current?.id !== r.id) return !1;
      this.model.mode === "daily" && this.progress.markDailyStarted(this.dailyDate, r.track.dailyNumber, this.attempt),
        this.transport.resetLoadingAnnouncement(), this.transport.beginLoadingNotice(r, t), this.transport
        .armWatchdog(r);
      let i = this.audio.playPrepared(r.id, e);
      return i || this.reportRejectedAudioOperation(r, "Prepared audio could not start playback."), this.render(), i
    }
    reportRejectedAudioOperation(r, e, t = "active") {
      (t === "standby" ? this.timedRun?.next?.id === r.id : this.model.current?.id === r.id) && this.onAudioFailure({
        role: t,
        roundId: r.id,
        trackId: r.track.dailyNumber,
        previousPhase: this.audio.phase
      })
    }
    enterFailedState() {
      this.transport.cancelWatchdog(), this.transport.setStatus(p.trackError), this.view.announce(
        "THE SELECTED TRACK COULD NOT BE PLAYED. PRESS PLAY TO RETRY."), this.render(), this.view.focusPlay()
    }
    currentRulesText() {
      if (this.isDailyComplete && !this.isResult) return this.progress.dailyCompletionText(this.dailyDate);
      let r = this.model.mode;
      return r ? r === "daily" && this.progress.dailyInProgress(this.dailyDate) ?
        `DAILY IN PROGRESS, CONTINUE FROM ATTEMPT ${this.progress.daily.step+1}` : f[r].description : p.modePrompt
    }
    isPlayEnabled() {
      let r = this.model.mode,
        e = this.model.current,
        t = ["paused", "playing", "starting", "buffering", "failed"].includes(this.audio.phase);
      return !!(r && e && !this.view.modal.isBlocking && t && !this.isResult && !this.isDailyComplete)
    }
    render() {
      this.presenter.render(this.createViewState(), this.model.guessedTrackIds, {
        guessed: this.guessedRevision,
        history: this.historyRevision,
        currentSlot: this.currentSlotRevision,
        discoveries: this.progress.discoveryRevision
      })
    }
    createViewState() {
      let r = this.model.mode,
        e = this.model.current,
        t = this.audio.phase,
        i = this.view.modal.openKind,
        s = !!(e && this.model.currentSlot),
        n = !!(e && this.policy?.timed && !e.playedOnce && (t === "starting" || t === "buffering")) && this
          .roundNumber > 1 && this.transport.status !== p.loadingTrack,
        o = !!(e && s && !this.view.modal.isBlocking && t !== "failed" && !this.isResult && !this.isDailyComplete),
        a = !!(o && (L(t, e) || n));
      return {
        mode: r,
        rulesText: this.currentRulesText(),
        transportStatus: this.transport.status,
        inputVisible: s,
        playEnabled: this.isPlayEnabled(),
        guessEnabled: o,
        skipEnabled: a,
        playbackIcon: m(t) ? this.policy?.timed ? "pause" : "stop" : "play",
        snippetSeconds: y(this.attempt),
        skipText: U(r, this.attempt),
        currentSlot: this.model.currentSlot,
        history: this.model.history,
        result: this.model.result,
        dailyProgress: this.progress.daily,
        dailyDate: this.dailyDate,
        discoveries: this.progress.discoveries,
        modalKind: i
      }
    }
    focusRecommendedPrimary(r = !1) {
      let e = () => {
        this.isPlayEnabled() ? this.view.focusPlay() : this.isDailyComplete ? this.view.focusMode("blitz") : this
          .model.mode || this.view.focusMode("daily")
      };
      r ? queueMicrotask(e) : e()
    }
  }

  var X = [{
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
    tracks;
    byId;
    searchEntries;
    discoveryTracks;
    constructor(r) {
      this.tracks = r, this.byId = new Map(r.map(e => [e.dailyNumber, e])), this.searchEntries = r.map(e => ({
        track: e,
        normalizedTitle: e.title.toLocaleLowerCase()
      })), this.discoveryTracks = [...r].sort((e, t) => t.dailyNumber - e.dailyNumber)
    }
    get(r) {
      return this.byId.get(r)
    }
    search(r, e, t) {
      return this.searchEntries.filter(i => !e.has(i.track.dailyNumber) && i.normalizedTitle.includes(r)).slice(0,
        t).map(i => i.track)
    }
    dailyTrack(r, e) {
      let t = this.tracks.filter(a => a.dailyFrom <= r);
      if (e !== null) return t.find(a => a.dailyNumber === e);
      let i = t[0],
        s = P(`corzaguessr-daily:${r}:${i.dailyNumber}`);
      for (let a of t.slice(1)) {
        let l = P(`corzaguessr-daily:${r}:${a.dailyNumber}`);
        l > s && (i = a, s = l)
      }
      return i
    }
    dailyClipStart(r, e) {
      let t = Math.floor(r.duration - MAX_SNIPPET_SECONDS);
      return P(`corzaguessr-daily-clip:${e}:${r.dailyNumber}`) % (t + 1)
    }
    randomTrack(r, e) {
      let t = this.tracks.filter(i => !r.has(i.dailyNumber) && i.dailyNumber !== e);
      return t[Math.floor(Math.random() * t.length)]
    }
    randomClipStart(r, e) {
      let t = e ? re : MAX_SNIPPET_SECONDS,
        i = Math.floor(r.duration - t);
      return Math.floor(Math.random() * (i + 1))
    }
  }


  function me() {
    try {
      return window.localStorage
    } catch {
      return null
    }
  }

  class M {
    storage = me();
    load() {
      return {
        discoveries: new Set(this.read(v.discoveries, []).filter(r => typeof r == "number" && Number.isSafeInteger(r) &&
          r > 0)),
        daily: J(this.readUnknown(v.daily)),
        personalBests: $(this.readUnknown(v.personalBests))
      }
    }
    saveDiscoveries(r) {
      let e = [...r].sort((t, i) => t - i);
      try {
        return this.storage ? (e.length ? this.storage.setItem(v.discoveries, JSON.stringify(e)) : this.storage
          .removeItem(v.discoveries), !0) : !1
      } catch {
        return !1
      }
    }
    saveDaily(r) {
      return this.write(v.daily, r)
    }
    savePersonalBests(r) {
      return this.write(v.personalBests, r)
    }
    readUnknown(r) {
      try {
        if (!this.storage) return;
        let e = this.storage.getItem(r);
        return e === null ? void 0 : JSON.parse(e)
      } catch {
        return
      }
    }
    read(r, e) {
      let t = this.readUnknown(r);
      return Array.isArray(t) ? t : e
    }
    write(r, e) {
      try {
        return this.storage ? (this.storage.setItem(r, JSON.stringify(e)), !0) : !1
      } catch {
        return !1
      }
    }
  }

  class R {
    callbacks;
    kind = "classic";
    limitMs = 1e3;
    running = !1;
    anchorMs = null;
    elapsedMs = 0;
    remainingMs = 1e3;
    maxRemainingMs = 1e3;
    expired = !1;
    frame = 0;
    timer = 0;
    generation = 0;
    constructor(r) {
      this.callbacks = r
    }
    get isRunning() {
      return this.running
    }
    configure(r) {
      this.reset(r.kind, r.initialMs, r.limitMs ?? r.initialMs)
    }
    reset(r, e, t) {
      this.cancelScheduled(), this.kind = r, this.limitMs = t, this.running = !1, this.anchorMs = null, this.elapsedMs =
        0, this.remainingMs = e, this.maxRemainingMs = e, this.expired = !1, this.generation += 1
    }
    start() {
      this.running || this.expired || (this.running = !0, this.anchorMs = performance.now(), this.schedule())
    }
    pause() {
      this.running && (this.commit(), this.running = !1, this.anchorMs = null, this.generation += 1, this
        .cancelScheduled())
    }
    pauseAndSnapshot() {
      return this.pause(), this.snapshot()
    }
    restartClassic(r) {
      this.reset("classic", r, r)
    }
    extendClassic(r) {
      let e = this.running;
      this.commit(), this.kind = "classic", this.limitMs = r, this.remainingMs = Math.max(0, r - this.elapsedMs), this
        .maxRemainingMs = Math.max(this.maxRemainingMs, r), this.expired = this.remainingMs === 0, this.anchorMs = e &&
        !this.expired ? performance.now() : null, this.running = e && !this.expired, this.generation += 1, this
        .cancelScheduled(), this.running && this.schedule()
    }
    adjust(r) {
      this.commit(), this.remainingMs = Math.max(0, this.remainingMs + r), this.maxRemainingMs = Math.max(this
          .maxRemainingMs, this.remainingMs), this.expired = this.remainingMs === 0, this.running && !this.expired &&
        (this.anchorMs = performance.now()), this.expired ? (this.running = !1, this.anchorMs = null, this
          .cancelScheduled()) : this.running && (this.generation += 1, this.cancelScheduled(), this.schedule());
      return this.snapshot()
    }
    snapshot() {
      let r = this.project(performance.now());
      return {
        running: this.running,
        elapsedMs: r.elapsedMs,
        remainingMs: r.remainingMs,
        maxRemainingMs: this.maxRemainingMs,
        expired: this.expired || r.remainingMs <= 0
      }
    }
    project(r) {
      if (!this.running || this.anchorMs === null) return {
        elapsedMs: this.elapsedMs,
        remainingMs: this.remainingMs
      };
      let e = Math.max(0, r - this.anchorMs);
      return {
        elapsedMs: this.elapsedMs + e,
        remainingMs: this.kind === "classic" ? Math.max(0, this.limitMs - (this.elapsedMs + e)) : Math.max(0, this
          .remainingMs - e)
      }
    }
    commit() {
      if (!this.running || this.anchorMs === null) return;
      let r = performance.now(),
        e = this.project(r);
      this.elapsedMs = e.elapsedMs, this.remainingMs = e.remainingMs, this.anchorMs = r, this.remainingMs <= 0 &&
        (this.expired = !0)
    }
    schedule() {
      let r = this.generation,
        e = () => {
          if (!this.running || r !== this.generation) return;
          let t = this.snapshot();
          this.callbacks.onTick(t), t.remainingMs > 0 && (this.frame = requestAnimationFrame(e))
        };
      this.frame = requestAnimationFrame(e), this.timer = window.setTimeout(() => {
        if (!this.running || r !== this.generation) return;
        this.commit(), this.running = !1, this.anchorMs = null, this.remainingMs = 0, this.expired = !0, this
          .cancelScheduled(), this.callbacks.onExpired()
      }, Math.max(0, this.remainingMs))
    }
    cancelScheduled() {
      this.frame && cancelAnimationFrame(this.frame), this.timer && clearTimeout(this.timer), this.frame = 0, this
        .timer = 0
    }
  }

  const Z = 1;

  class w {
    sourceForRound;
    callbacks;
    slots;
    active = null;
    standby = null;
    lastActiveSlot = null;
    phase = "empty";
    suspension = null;
    constructor(r, e, t) {
      this.sourceForRound = e, this.callbacks = t, this.slots = r.map(i => ({
        element: i,
        round: null,
        generation: 0,
        controller: null,
        failed: !1
      }))
    }
    prepare(r) {
      return this.assign(r, "active")
    }
    preload(r) {
      return this.assign(r, "standby")
    }
    promote(r) {
      let e = this.standby;
      if (!e || e.round?.id !== r) return this.phase = "failed", this.callbacks.onFailure({
        role: "active",
        roundId: r,
        trackId: e?.round?.track.dailyNumber ?? null,
        previousPhase: "paused"
      }), !1;
      if (e.failed || e.element.error) {
        let t = e.round.track.dailyNumber;
        return this.standby = null, this.releaseSlot(e, !0), this.phase = "failed", this.callbacks.onFailure({
          role: "active",
          roundId: r,
          trackId: t,
          previousPhase: "paused"
        }), !1
      }
      let t = this.active;
      return this.active = e, this.standby = null, this.phase = "paused", t && t !== e && this.releaseSlot(t), !0
    }
    playPrepared(r, e) {
      let t = this.active;
      if (!t || t.round?.id !== r) return !1;
      let i = t.generation;
      e ? (t.element.pause(), this.seek(t)) : this.correctSeekBeforePlay(t), this.phase = "starting";
      try {
        t.element.play()?.catch(s => {
          !this.isLive(t, i, r) || t !== this.active || s instanceof DOMException && s.name === "AbortError" || (s
            instanceof DOMException && s.name === "NotAllowedError" ? (this.phase = "paused", this.callbacks
              .onBlocked(r)) : this.fail(t, "active"))
        })
      } catch {
        return this.isLive(t, i, r) && t === this.active && this.fail(t, "active"), !1
      }
      return !0
    }
    pause() {
      this.active && !["empty", "failed"].includes(this.phase) && (this.phase = "paused", this.active.element.pause())
    }
    releaseActive(r = null) {
      if (!this.active) {
        r && (this.phase = r);
        return
      }
      let e = this.active;
      this.lastActiveSlot = e, this.active = null, this.suspension = null, this.releaseSlot(e), this.phase = r ?? (this
        .standby ? "paused" : "empty")
    }
    stop() {
      this.releaseActive(), this.discardStandby(), this.suspension = null, this.phase = "empty"
    }
    discardStandby() {
      this.standby && (this.releaseSlot(this.standby), this.standby = null)
    }
    suspend(r) {
      !this.active || this.active.round?.id !== r || (this.suspension = {
        generation: this.active.generation,
        roundId: r,
        terminal: null
      }, this.pause())
    }
    restore(r) {
      let e = this.suspension;
      if (this.suspension = null, !e || !this.active || this.active.round?.id !== r || e.roundId !== r || e
          .generation !== this.active.generation) return null;
      return e.terminal
    }
    assign(r, e) {
      let t = e === "active" ? this.standby : this.active,
        i = e === "active" ? this.active : this.standby,
        s = i ?? this.slots.filter(o => o !== t).find(o => o !== this.lastActiveSlot) ?? this.slots.find(o => o !== t) ??
        null;
      if (!s) return !1;
      e === "active" ? this.active = null : this.standby = null, s.round === null ? s.generation += 1 : this
        .releaseSlot(s), s.round = r;
      let n = s.generation;
      e === "active" ? (this.active = s, this.phase = "paused") : this.standby = s, this.bind(s), s.element.preload =
        "auto", s.element.src = this.sourceForRound(r), s.element.load();
      return this.isLive(s, n, r.id) ? s.element.error ? (this.fail(s, e), !1) : !0 : !1
    }
    bind(r) {
      let e = new AbortController,
        t = r.generation,
        i = r.round.id;
      r.controller = e;
      let s = () => this.isLive(r, t, i);
      r.element.addEventListener("loadedmetadata", () => {
        s() && this.seek(r)
      }, {
        signal: e.signal
      }), r.element.addEventListener("playing", () => {
        !s() || r !== this.active || !["starting", "buffering"].includes(this.phase) || (this.phase = "playing", this
          .callbacks.onPlaying(i))
      }, {
        signal: e.signal
      }), r.element.addEventListener("waiting", () => {
        !s() || r !== this.active || ["paused", "buffering", "failed"].includes(this.phase) || (this.phase =
          "buffering", this.callbacks.onWaiting({
            roundId: i
          }))
      }, {
        signal: e.signal
      }), r.element.addEventListener("ended", () => {
        !s() || r !== this.active || (this.phase = "ended", this.suspension && this.suspension.roundId === i ? this
          .suspension.terminal = {
            type: "ended"
          } : this.callbacks.onEnded(i))
      }, {
        signal: e.signal
      }), r.element.addEventListener("error", () => {
        !s() || !r.element.error || this.fail(r, r === this.standby ? "standby" : "active")
      }, {
        signal: e.signal
      })
    }
    fail(r, e) {
      if (r.failed || !r.round) return;
      r.failed = !0;
      let t = r.round,
        i = this.phase;
      if (e === "standby") {
        this.standby === r && (this.standby = null), this.releaseSlot(r), this.callbacks.onFailure({
          role: e,
          roundId: t.id,
          trackId: t.track.dailyNumber,
          previousPhase: i
        });
        return
      }
      if (this.phase = "failed", this.suspension && this.suspension.roundId === t.id) {
        this.suspension.terminal = {
          type: "failed",
          previousPhase: i
        };
        return
      }
      this.callbacks.onFailure({
        role: e,
        roundId: t.id,
        trackId: t.track.dailyNumber,
        previousPhase: i
      })
    }
    seekTarget(r) {
      let e = Number.isFinite(r.element.duration) ? r.element.duration : r.round.track.duration;
      return Math.min(r.round.clipStart, Math.max(0, e - .05))
    }
    seek(r) {
      if (!r.round || r.element.readyState < Z) return;
      try {
        r.element.currentTime = this.seekTarget(r)
      } catch {}
    }
    correctSeekBeforePlay(r) {
      if (!r.round || r.element.readyState < Z) return;
      let e = this.seekTarget(r);
      (!Number.isFinite(r.element.currentTime) || r.element.currentTime + .35 < e) && this.seek(r)
    }
    isLive(r, e, t) {
      return r.generation === e && r.round?.id === t
    }
    releaseSlot(r, e = r.failed) {
      if (!r.round && !r.controller && !r.element.getAttribute("src")) return;
      r.controller?.abort(), r.controller = null, r.generation += 1;
      let t = r.element;
      if (t.pause(), t.removeAttribute("src"), t.load(), e) {
        let i = t.cloneNode(!1);
        i.preload = "auto", t.replaceWith(i), r.element = i
      }
      r.round = null, r.failed = !1
    }
  }

  class A {
    onDateChanged;
    timer = 0;
    currentDate = "";
    active = !1;
    constructor(r) {
      this.onDateChanged = r
    }
    current() {
      let r = g();
      return this.currentDate || (this.currentDate = r), r
    }
    start() {
      return this.active = !0, this.currentDate = g(), this.scheduleNextBoundary(), this.currentDate
    }
    reconcile() {
      let r = g();
      return r !== this.currentDate && (this.currentDate = r, this.onDateChanged(r)), this.active && this
        .scheduleNextBoundary(), r
    }
    stop() {
      this.active = !1, this.timer && clearTimeout(this.timer), this.timer = 0
    }
    scheduleNextBoundary() {
      if (!this.active) return;
      this.timer && clearTimeout(this.timer), this.timer = 0;
      let r = Date.now(),
        e = g(new Date(r)),
        t = r,
        i = r + 1800 * 60 * 1e3;
      for (; g(new Date(i)) === e;) i += 360 * 60 * 1e3;
      for (; i - t > 1;) {
        let s = Math.floor((t + i) / 2);
        g(new Date(s)) === e ? t = s : i = s
      }
      this.timer = window.setTimeout(() => this.reconcile(), Math.max(1, i - r))
    }
  }

  const ee = {
      play: "M8 5v14l11-7z",
      pause: "M6 5h4v14H6zM14 5h4v14h-4z",
      stop: "M7 7h10v10H7z"
    };

  class I {
  constructor(e, t, i, s, n) {
    this.input = e;
    this.list = t;
    this.catalog = i;
    this.onGuess = s;
    this.onPlaybackShortcut = n;
    e.addEventListener("input", () => this.update()), e.addEventListener("keydown", o => this.handleKeydown(o)),
      t.addEventListener("pointerover", o => {
        let a = o.target instanceof Element ? o.target.closest("[role=option]") : null;
        if (!a) return;
        let l = Number(a.dataset.index);
        Number.isSafeInteger(l) && this.select(l)
      }), t.addEventListener("click", o => {
        let a = o.target instanceof Element ? o.target.closest("[role=option]") : null;
        if (!a) return;
        let l = Number(a.dataset.index),
          d = this.suggestions[l];
        d && this.onGuess(d.dailyNumber)
      })
  }
  input;
  list;
  catalog;
  onGuess;
  onPlaybackShortcut;
  unavailable = new Set;
  unavailableRevision = -1;
  suggestions = [];
  selectedIndex = -1;
  setUnavailable(e, t) {
    if (t === this.unavailableRevision) return;
    let i = this.suggestions[this.selectedIndex]?.dailyNumber ?? null;
    this.unavailable = e, this.unavailableRevision = t, this.input.value.trim() && this.update(i)
  }
  reset() {
    this.input.value = "", this.suggestions = [], this.selectedIndex = -1, this.render()
  }
  update(e = null) {
    let t = this.input.value.trim().toLocaleLowerCase();
    this.suggestions = t ? this.catalog.search(t, this.unavailable, 8) : [];
    let i = e === null ? -1 : this.suggestions.findIndex(s => s.dailyNumber === e);
    this.selectedIndex = i >= 0 ? i : this.suggestions.length ? 0 : -1, this.render()
  }
  select(e) {
    this.suggestions.length && (this.selectedIndex = (e % this.suggestions.length + this.suggestions.length) %
      this.suggestions.length, this.renderSelection())
  }
  syncActiveDescendant() {
    this.suggestions.length && this.selectedIndex >= 0 ? this.input.setAttribute("aria-activedescendant",
      `corzaguessr-option-${this.selectedIndex}`) : this.input.removeAttribute("aria-activedescendant")
  }
  renderSelection() {
    [...this.list.children].forEach((e, t) => {
      let i = t === this.selectedIndex;
      e.classList.toggle("active", i), e.setAttribute("aria-selected", String(i))
    }), this.syncActiveDescendant()
  }
  handleKeydown(e) {
    if (e.key === "Escape") {
      this.reset();
      return
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!this.suggestions.length) return;
      e.preventDefault(), this.select(this.selectedIndex + (e.key === "ArrowDown" ? 1 : -1));
      return
    }
    if (e.key !== "Enter") return;
    if (e.preventDefault(), !this.input.value.trim()) {
      this.onPlaybackShortcut();
      return
    }
    let t = this.suggestions[this.selectedIndex];
    t && this.onGuess(t.dailyNumber)
  }
  render() {
    let e = this.suggestions.map((i, s) => {
      let n = document.createElement("button");
      n.type = "button", n.tabIndex = -1, n.id = `corzaguessr-option-${s}`, n.dataset.index = String(s), n
        .textContent = i.title, n.setAttribute("role", "option");
      let o = s === this.selectedIndex;
      return n.setAttribute("aria-selected", String(o)), o && (n.className = "active"), n
    });
    this.list.replaceChildren(...e);
    let t = e.length > 0;
    this.list.style.display = t ? "block" : "none", this.input.setAttribute("aria-expanded", String(t)), this
      .syncActiveDescendant()
  }
  }

  class B {
  constructor(e, t, i, s, n) {
    this.root = e;
    this.elements = t;
    this.durations = i;
    this.reducedMotion = s;
    this.announce = n
  }
  root;
  elements;
  durations;
  reducedMotion;
  announce;
  state = "closed";
  returnFocus = null;
  lockedScroll = null;
  closeTimer = 0;
  openFrame = 0;
  transitionGeneration = 0;
  get openKind() {
    return this.state.includes("discovery") ? "discovery" : this.state.includes("result") ? "result" : null
  }
  get isBlocking() {
    return this.state !== "closed"
  }
  get blocksRoundPreparation() {
    return this.state !== "closed" && this.state !== "closing-result"
  }
  get discoveryLayoutActive() {
    return this.state === "opening-discovery" || this.state === "discovery"
  }
  openResult() {
    if (this.isBlocking) return;
    let e = this.beginOpen();
    this.state = "opening-result", this.captureReturnFocus(), this.lockScroll(), this.elements.card.classList.add(
      "modal-open"), this.elements.result.setAttribute("aria-hidden", "false"), this.openFrame =
      requestAnimationFrame(() => {
        this.openFrame = 0, this.transitionMatches("opening-result", e) && (this.state = "result", this.elements
          .card.classList.add("modal-visible"), this.elements.next.focus({
            preventScroll: !0
          }), this.announce(this.elements.resultMeta.dataset.announcement || "RESULT"))
      })
  }
  openDiscovery() {
    if (this.isBlocking) return;
    let e = this.beginOpen();
    this.state = "opening-discovery", this.captureReturnFocus(), this.lockScroll(), this.root.classList.add(
        "discovery-open"), this.elements.discoveryModal.setAttribute("aria-hidden", "false"), this.elements
      .discoveryButton.setAttribute("aria-expanded", "true"), this.elements.discoveryShell.style.height =
      "0px", this.elements.discoveryShell.offsetHeight, this.openFrame = requestAnimationFrame(() => {
        this.openFrame = 0, this.transitionMatches("opening-discovery", e) && (this.state = "discovery", this
          .root.classList.add("discovery-visible"), this.elements.discoveryShell.style.height =
          `${this.elements.discoveryPanel.offsetHeight}px`, this.elements.discoveryClose.focus({
            preventScroll: !0
          }))
      })
  }
  close(e, t = {}) {
    if (this.openKind !== e || this.state === `closing-${e}`) return;
    let i = t.beforeClose,
      s = t.afterClose;
    this.state = `closing-${e}`;
    let n = ++this.transitionGeneration;
    window.cancelAnimationFrame(this.openFrame), this.openFrame = 0, window.clearTimeout(this.closeTimer), e ===
      "result" ? (this.elements.card.classList.add("modal-closing"), this.elements.card.classList.remove(
        "modal-visible")) : (this.root.classList.remove("discovery-visible"), this.elements.discoveryShell.style
        .height = `${this.elements.discoveryShell.offsetHeight}px`, this.elements.discoveryShell.offsetHeight,
        this.elements.discoveryShell.style.height = "0px", this.elements.discoveryButton.setAttribute(
          "aria-expanded", "false")), i?.();
    let o = this.reducedMotion.matches ? 0 : e === "result" ? this.durations.result : this.durations.discovery;
    this.closeTimer = window.setTimeout(() => {
      if (this.closeTimer = 0, this.state !== `closing-${e}` || this.transitionGeneration !== n) return;
      e === "result" ? (this.elements.card.classList.remove("modal-open", "modal-visible", "modal-closing"),
          this.elements.result.setAttribute("aria-hidden", "true")) : (this.root.classList.remove(
          "discovery-open", "discovery-visible"), this.elements.discoveryModal.setAttribute("aria-hidden",
          "true"), this.elements.discoveryShell.style.height = ""), this.state = "closed", this.unlockScroll(),
        s?.();
      let a = this.returnFocus;
      this.returnFocus = null;
      let l = e === "result" ? this.elements.play : this.elements.discoveryButton,
        d = a && this.canFocus(a) ? a : l;
      this.canFocus(d) && d.focus({
        preventScroll: !0
      })
    }, o)
  }
  trapFocus(e) {
    let t = this.openKind;
    if (e.key !== "Tab" || !t) return;
    let i = t === "result" ? this.elements.result : this.elements.discoveryPanel,
      s = [...i.querySelectorAll("button:not([disabled]), input:not([disabled])")].filter(a => !a.hidden && a
        .offsetParent !== null);
    if (!s.length) return;
    let n = s[0],
      o = s.at(-1);
    i.contains(document.activeElement) ? e.shiftKey && document.activeElement === n ? (e.preventDefault(), o
      .focus()) : !e.shiftKey && document.activeElement === o && (e.preventDefault(), n.focus()) : (e
      .preventDefault(), (e.shiftKey ? o : n).focus())
  }
  lockScroll() {
    this.lockedScroll || (this.lockedScroll = {
        htmlOverflow: document.documentElement.style.overflow,
        htmlScrollbarGutter: document.documentElement.style.scrollbarGutter,
        bodyOverflow: document.body.style.overflow
      }, document.documentElement.style.scrollbarGutter = "stable", document.documentElement.style.overflow =
      "hidden", document.body.style.overflow = "hidden")
  }
  unlockScroll() {
    this.lockedScroll && (document.documentElement.style.overflow = this.lockedScroll.htmlOverflow, document
      .documentElement.style.scrollbarGutter = this.lockedScroll.htmlScrollbarGutter, document.body.style
      .overflow = this.lockedScroll.bodyOverflow, this.lockedScroll = null)
  }
  canFocus(e) {
    return e.isConnected && e.disabled !== !0 && !e.hidden && !e.closest("[inert]")
  }
  captureReturnFocus() {
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }
  beginOpen() {
    return window.clearTimeout(this.closeTimer), this.closeTimer = 0, window.cancelAnimationFrame(this.openFrame),
      this.openFrame = 0, ++this.transitionGeneration
  }
  transitionMatches(e, t) {
    return this.state === e && this.transitionGeneration === t
  }
  }

  class x {
      constructor(e, t) {
        this.root = e;
        this.discoveryTracks = t.discoveryTracks;
        this.inputModality = this.finePointer.matches ? "pointer-fine" : "pointer-coarse", e.dataset
          .corzaguessrReady = "true", e.innerHTML = this.markup(), this.elements = this.queryElements(), this
          .audioElements = this.elements.audioPlayers, this.modeButtons = {
            daily: this.required('[data-mode="daily"]'),
            blitz: this.required('[data-mode="blitz"]'),
            classic: this.required('[data-mode="classic"]'),
            survival: this.required('[data-mode="survival"]')
          };
        let i = getComputedStyle(e);
        this.durations = {
            slot: this.duration(i, "--duration-slot"),
            result: this.duration(i, "--duration-result"),
            discovery: this.duration(i, "--duration-discovery"),
            progress: this.duration(i, "--duration-progress"),
            rewind: this.duration(i, "--duration-rewind")
          }, this.modal = new B(e, this.elements, this.durations, this.reducedMotion, i => this.announce(i)), this
          .autocomplete = new I(this.elements.guess, this.elements.suggest, t, i => this.handlers?.guess(i), () => this
            .handlers?.playbackShortcut()), this.elements.timeChangeText.addEventListener("animationend", i => {
            i.animationName === "corzaguessr-survival-hit" && this.clearSurvivalFeedback()
          }), new ResizeObserver(() => {
            this.modal.discoveryLayoutActive && (this.elements.discoveryShell.style.height =
              `${this.elements.discoveryPanel.offsetHeight}px`)
          }).observe(this.elements.discoveryPanel)
      }
      root;
      audioElements;
      modal;
      autocomplete;
      discoveryTracks;
      elements;
      modeButtons;
      durations;
      reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
      finePointer = matchMedia("(pointer: fine)");
      handlers = null;
      state = null;
      inputModality;
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
      progressRewindActive = !1;
      bind(e) {
        this.handlers = e, this.elements.play.addEventListener("click", e.play), this.elements.skip
          .addEventListener("click", e.skip), this.elements.next.addEventListener("click", e.newGame), this.elements
          .spotify.addEventListener("click", e.openSpotify), this.elements.discoveryButton.addEventListener("click",
            e.openDiscovery), this.elements.discoveryClose.addEventListener("click", e.closeDiscovery), this
          .elements.discoveryReset.addEventListener("click", () => {
            window.confirm("RESET DISCOVERY? THIS HIDES ALL DISCOVERED TRACKS.") && e.resetDiscovery()
          }), this.elements.discoveryModal.addEventListener("click", t => {
            (t.target instanceof Element ? t.target : null)?.closest(".discovery-panel") || e.closeDiscovery()
          });
        for (let [t, i] of Object.entries(this.modeButtons)) i.addEventListener("click", () => e.selectMode(t)),
          this.bindPreview(i, t);
        this.bindPreview(this.elements.discoveryButton, "discovery"), this.root.addEventListener("keydown", t =>
          this.handleRootKeydown(t), !0), this.root.addEventListener("pointerdown", t => this.handlePointerDown(
          t))
      }
      render(e, t, i) {
        this.state = e, this.root.classList.toggle("rules-visible", !e.inputVisible), this.root.classList.toggle(
          "timed", c(e.mode));
        let s = e.mode === null;
        this.elements.modePrompt.setAttribute("aria-hidden", String(!s)), this.elements.play.disabled = !e
          .playEnabled, this.elements.skip.disabled = !e.skipEnabled, this.elements.guess.disabled = !e
          .guessEnabled;
        let n = e.modalKind !== null;
        this.elements.headerAction.inert = n, this.elements.modes.inert = n, this.elements.board.inert = n || s,
          this.elements.currentSlot.inert = n || s, this.elements.slots.inert = n || s;
        for (let [o, a] of Object.entries(this.modeButtons)) {
          let l = o === e.mode;
          a.disabled = l || e.modalKind === "discovery", a.setAttribute("aria-pressed", String(l))
        }
        this.elements.icon.setAttribute("d", ee[e.playbackIcon]), this.elements.play.setAttribute("aria-label", e
            .playbackIcon === "play" ? "PLAY" : e.playbackIcon === "pause" ? "PAUSE" : "STOP"), this.elements.skip
          .textContent = e.skipText, this.elements.snippet.style.width = `${e.snippetSeconds/h.at(-1)*100}%`, this
          .renderTransportStatus(e.transportStatus), this.renderRules(), this.renderCurrentSlot(e.currentSlot, i.currentSlot), this
          .renderHistory(e.history, i.history), this.autocomplete.setUnavailable(t, i.guessed), this.renderDiscovery(e
            .discoveries, i.discoveries, e.modalKind), this.renderResult(e.result), this.renderClock(e.clock)
      }
      renderClock(e) {
        let t = this.state;
        if (!t) return;
        let i = t.mode,
          s = "0:00",
          n = "0:01",
          o = 0;
        if (i)
          if (c(i)) {
            let a = i === "survival",
              l = f[i].initialTimeMs;
            n = T(a ? Math.ceil(e.remainingMs / 1e3) : l / 1e3);
            let d = (a ? e.elapsedMs : e.remainingMs) / 1e3,
              u = a ? e.maxRemainingMs : l;
            s = T(d), o = u ? e.remainingMs / u : 0
          } else {
            let a = i === "daily" && !t.inputVisible && t.dailyProgress.date === t.dailyDate && t.dailyProgress
              .started ? t.snippetSeconds : e.elapsedMs / 1e3;
            n = `0:${String(t.snippetSeconds).padStart(2,"0")}`, s = T(a), o = a ? a / h.at(-1) + .0025 : 0
          } this.renderedEndText !== n && (this.renderedEndText = n, this.elements.endtime.textContent = n), this
          .setProgress(s, o)
      }
      announce(e) {
        window.cancelAnimationFrame(this.announcementFrame), this.announcementFrame = 0, this.elements.status
          .textContent = "", e && (this.announcementFrame = requestAnimationFrame(() => {
            this.announcementFrame = 0, this.elements.status.textContent = e
          }))
      }
      flashSurvivalChange(e) {
        if (!e) return;
        let t = e > 0 ? "survival-reward" : "survival-penalty";
        this.clearSurvivalFeedback(), this.elements.timeChangeText.textContent = e > 0 ? `+${e}S` : `${e}S`, this
          .elements.feedback.offsetWidth, this.elements.feedback.classList.add(t), this.elements.timeChange
          .classList.add("survival-change"), this.reducedMotion.matches && this.clearSurvivalFeedback()
      }
      beginProgressReset(e = !1) {
        if (!(e && this.progressRewindActive)) {
          if (window.clearTimeout(this.progressTransitionTimer), this.progressTransitionTimer = 0, this
            .progressRewindActive = !1, this.elements.timeline.classList.remove("progress-rewinding"), this.elements
            .timeline.style.removeProperty("--rewind-from"), this.elements.fill.style.transition = "", e) {
            let t = this.progressScale();
            if (this.renderedNowText = "0:00", this.elements.now.textContent = "0:00", this.elements.fill.style.transform = "scaleX(0)", this
              .elements.feedback.style.transform = "scaleX(0)", this.reducedMotion.matches || t <= 1e-4) return;
            this.elements.timeline.style.setProperty("--rewind-from", String(t)), this.elements.timeline
              .offsetWidth, this.progressRewindActive = !0, this.elements.timeline.classList.add(
                "progress-rewinding"), this.progressTransitionTimer = window.setTimeout(() => {
                this.progressTransitionTimer = 0, this.progressRewindActive = !1, this.elements.timeline.classList
                  .remove("progress-rewinding"), this.elements.timeline.style.removeProperty("--rewind-from")
              }, this.durations.rewind);
            return
          }
          this.reducedMotion.matches || (this.elements.fill.offsetWidth, this.elements.fill.style.transition =
            "transform var(--duration-progress) ease-out", this.progressTransitionTimer = window.setTimeout(
          () => {
              this.elements.fill.style.transition = "", this.progressTransitionTimer = 0
            }, this.durations.progress))
        }
      }
      resetTransientUi() {
        window.cancelAnimationFrame(this.announcementFrame), this.announcementFrame = 0, this.elements.status
          .textContent = "", this.clearSurvivalFeedback(), this.preview = null, this.autocomplete.reset(), this
          .renderRules()
      }
      focusPlay() {
        !this.elements.play.disabled && !this.elements.play.closest("[inert]") && this.elements.play.focus({
          preventScroll: !0
        })
      }
      focusMode(e) {
        let t = this.modeButtons[e];
        !t.disabled && !t.closest("[inert]") && t.focus({
          preventScroll: !0
        })
      }
      focusGuess() {
        this.inputModality === "pointer-coarse" || this.elements.guess.disabled || this.elements.guess.closest(
          "[inert]") || queueMicrotask(() => this.elements.guess.focus({
          preventScroll: !0
        }))
      }
      renderRules() {
        if (!this.state) return;
        let e = !this.preview || this.preview === this.state.mode ? this.state.rulesText : this.preview ===
          "discovery" ? p.discovery : f[this.preview].description,
          t = !this.reducedMotion.matches && !this.state.inputVisible;
        e === this.renderedRulesText && t === this.renderedRulesScroll || (this.renderedRulesText = e, this
          .renderedRulesScroll = t, this.elements.modePrompt.textContent = e, this.elements.rulesetText
          .textContent = e, this.elements.rulesetCopy.textContent = e, this.elements.ruleset.classList.remove(
            "scroll"), t && (this.elements.ruleset.offsetWidth, this.elements.ruleset.classList.add("scroll")))
      }
      renderHistory(e, t) {
        if (t === this.renderedHistoryRevision) return;
        this.renderedHistoryRevision = t;
        let i = ++this.historyRenderGeneration;
        if (window.clearTimeout(this.slotTimer), this.slotTimer = 0, !e.length) {
          if (!this.elements.slots.children.length) return;
          if (this.reducedMotion.matches) {
            this.elements.slots.replaceChildren(), this.elements.slots.style.height = "";
            return
          }
          [...this.elements.slots.children].forEach(a => a.classList.add("fade")), this.elements.slots.style.height =
            `${this.elements.slots.offsetHeight}px`, this.elements.slots.offsetHeight, this.elements.slots.style.height =
            "0px";
          let s = this.modal.openKind === "result" ? this.durations.result : this.durations.slot;
          this.slotTimer = window.setTimeout(() => {
            this.slotTimer = 0, i === this.historyRenderGeneration && (this.elements.slots.replaceChildren(), this
              .elements.slots.style.height = "")
          }, s);
          return
        }
        let s = new Map([...this.elements.slots.children].map(a => [a.dataset.historyKey ?? "", a])),
          n = e.map(a => {
            let l = s.get(a.key),
              d = !l;
            l || (l = document.createElement("div"), l.className = "slot fade", l.dataset.historyKey = a.key);
            let u = l.dataset.tone ?? "";
            return u !== a.tone && (u && l.classList.remove(...u.split(/\s+/)), a.tone && l.classList.add(...a
              .tone.split(/\s+/)), l.dataset.tone = a.tone), /^(wrong|skip)$/.test(a.tone) && u !== a.tone && (l
              .classList.add("wiggle"), l.addEventListener("animationend", () => l?.classList.remove("wiggle"), {
                once: !0
              })), l.textContent = a.text, d && requestAnimationFrame(() => {
              i === this.historyRenderGeneration && l?.classList.remove("fade")
            }), l
          });
        this.elements.slots.replaceChildren(...n)
      }
      renderCurrentSlot(e, t) {
        if (t === this.renderedCurrentSlotRevision) return;
        this.renderedCurrentSlotRevision = t;
        let i = this.elements.currentSlot,
          s = i.dataset.tone ?? "";
        if (s && i.classList.remove(...s.split(/\s+/)), !e) {
          i.dataset.tone = "", i.textContent = "", i.hidden = !0;
          return
        }
        e.tone && i.classList.add(...e.tone.split(/\s+/)), i.dataset.tone = e.tone, i.textContent = e.text, i
          .hidden && (i.classList.add("fade"), i.hidden = !1, requestAnimationFrame(() => i.classList.remove("fade")))
      }
      renderTransportStatus(e) {
        e !== this.renderedTransportStatus && (this.renderedTransportStatus = e, this.elements.transportStatus
          .textContent = e)
      }
      renderDiscovery(e, t, o) {
        if (o !== "discovery" || t === this.renderedDiscoveryRevision) return;
        this.renderedDiscoveryRevision = t;
        let i = this.discoveryTracks,
          s = i.reduce((o, a) => o + Number(e.has(a.dailyNumber)), 0),
          n = Math.round(s * 100 / i.length);
        this.elements.discoveryCount.textContent = `${s} / ${i.length} (${n}%)`, this.elements.discoveryItems
          .replaceChildren(...i.map(o => {
            let a = e.has(o.dailyNumber),
              l = document.createElement("div");
            if (l.className = "discovery-item", l.setAttribute("role", "listitem"), o.isNew && !a) {
              l.classList.add("discovery-item-new");
              let d = document.createElement("span");
              d.className = "discovery-new", d.textContent = "NEW", d.setAttribute("aria-hidden", "true");
              let u = document.createElement("span");
              u.className = "discovery-track", u.textContent = "?".repeat(20), l.append(d, u, d.cloneNode(!0)),
                l.setAttribute("aria-label", "NEW UNDISCOVERED TRACK")
            } else l.textContent = a ? o.title : "?".repeat(20), a || l.setAttribute("aria-hidden", "true");
            return l
          }))
      }
      renderResult(e) {
        if (e === this.renderedResult) return;
        if (this.renderedResult = e, !e) {
          this.elements.resultTitle.textContent = "", this.elements.resultMeta.replaceChildren();
          return
        }
        e.mode === "blitz" || e.mode === "survival" ? this.elements.resultTitle.innerHTML =
          '&#9201;&#65039; <span class="end">TIME IS UP</span> &#9201;&#65039;' : this.elements.resultTitle
          .innerHTML =
          `${e.won?"&#127881;":"&#10060;"} <span class="end">${e.won?"YOU GOT IT":"YOU GOT IT ALL WRONG"}</span> ${e.won?"&#127881;":"&#10060;"}`;
        let t = se(e);
        this.elements.resultMeta.replaceChildren(...t.map(s => pe(s, e.newPersonalBest))), this.elements.resultMeta
          .dataset.announcement = ye(e, t);
        let i = e.mode === "classic" || e.mode === "daily" ? e.spotify : "";
        this.elements.spotify.hidden = !i
      }
      setProgress(e, t) {
        let i = Math.max(0, Math.min(1, Number(t) || 0));
        this.renderedNowText !== e && (this.renderedNowText = e, this.elements.now.textContent = e), this.elements
          .fill.style.transform = `scaleX(${i})`, this.elements.feedback.style.transform = `scaleX(${i})`
      }
      progressScale() {
        let e = getComputedStyle(this.elements.fill).transform,
          t = e && e !== "none" ? e : this.elements.fill.style.transform,
          i = /scaleX\(([^)]+)\)/.exec(t),
          s = /^matrix(?:3d)?\(([^)]+)\)$/.exec(t),
          n = i ? Number.parseFloat(i[1] ?? "") : s ? Number.parseFloat(s[1]?.split(",")[0] ?? "") : 0;
        return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0
      }
      bindPreview(e, t) {
        e.addEventListener("pointerenter", () => {
          this.previewAllowed() && (this.preview = t, this.renderRules())
        }), e.addEventListener("pointerleave", () => {
          this.preview === t && (this.preview = null, this.renderRules())
        }), e.addEventListener("focus", () => {
          this.inputModality === "keyboard" && this.state && this.state.modalKind === null && this
          .previewAllowed() && (this.preview = t, this.renderRules())
        }), e.addEventListener("blur", () => {
          this.preview === t && (this.preview = null, this.renderRules())
        })
      }
      previewAllowed() {
        return !!(this.state && this.state.modalKind === null && !this.state.inputVisible)
      }
      handleRootKeydown(e) {
        if (!this.handlers || !this.state) return;
        this.inputModality = "keyboard";
        let t = this.state.modalKind;
        if (t) {
          if (e.key === "Escape") {
            e.preventDefault(), t === "discovery" ? this.handlers.closeDiscovery() : this.handlers.newGame();
            return
          }
          if (t === "result" && e.key === "Enter" && document.activeElement !== this.elements.spotify) {
            e.preventDefault(), this.handlers.newGame();
            return
          }
          if (this.isArrowKey(e.key)) {
            e.preventDefault(), this.moveModalFocus(t, e.key);
            return
          }
          this.modal.trapFocus(e);
          return
        }
        let i = e.target instanceof Element ? e.target : null;
        if (this.isArrowKey(e.key)) {
          if (i === this.elements.guess && this.state.inputVisible) return;
          if (this.state.inputVisible && this.state.guessEnabled) {
            e.preventDefault(), this.focusGuess();
            return
          }
          e.preventDefault(), this.movePrimaryFocus(e.key);
          return
        }
        e.key === "Enter" && this.state.mode !== null && !i?.closest(
          "button, input, a, .suggest") && (e.preventDefault(), this.handlers.playbackShortcut())
      }
      isArrowKey(e) {
        return e === "ArrowUp" || e === "ArrowDown" || e === "ArrowLeft" || e === "ArrowRight"
      }
      moveModalFocus(e, t) {
        let i = e === "result" ? [this.elements.next, this.elements.spotify] : [this.elements.discoveryClose, this
          .elements.discoveryReset
        ];
        this.cycleFocus(i, t, i[0])
      }
      movePrimaryFocus(e) {
        let t = [this.elements.discoveryButton, this.modeButtons.daily, this.modeButtons.blitz, this.modeButtons
            .classic, this.modeButtons.survival, this.elements.play
          ],
          s = !!(this.state?.mode === "daily" && this.state.dailyProgress.date === this.state.dailyDate && this
            .state.dailyProgress.completed) ? this.modeButtons.blitz : this.state?.mode ? this.elements.play : this
          .modeButtons.daily;
        this.cycleFocus(t, e, s)
      }
      cycleFocus(e, t, i) {
        let s = e.filter(a => this.canNavigateTo(a));
        if (!s.length) return;
        let n = s.indexOf(document.activeElement);
        if (n < 0) {
          (s.includes(i) ? i : s[0]).focus({
            preventScroll: !0
          });
          return
        }
        s[(n + (t === "ArrowLeft" || t === "ArrowUp" ? -1 : 1) + s.length) % s.length].focus({
          preventScroll: !0
        })
      }
      canNavigateTo(e) {
        return !e.isConnected || e.hidden || e.closest("[inert]") || e instanceof HTMLButtonElement && e.disabled ?
          !1 : e.offsetParent !== null
      }
      handlePointerDown(e) {
        if (!this.handlers || !this.state) return;
        let t = e.pointerType === "mouse" && this.finePointer.matches ? "pointer-fine" : "pointer-coarse";
        this.inputModality = t;
        let i = e.target instanceof Element ? e.target : null;
        if (t === "pointer-fine" && document.activeElement === this.elements.guess && i?.closest(".skip") === this
          .elements.skip) {
          e.preventDefault();
          return
        }
        if (this.state.playEnabled && !this.state.inputVisible && !i?.closest("button, input, a, .suggest")) {
          e.preventDefault(), this.focusPlay();
          return
        }!this.state.guessEnabled || this.state.modalKind !== null || i?.closest("button, input, a, .suggest") || this.elements
          .guess.focus({
            preventScroll: !0
          })
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
                <button type="button" class="play" aria-label="PLAY" disabled><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${ee.play}"></path></svg></button>
                <div class="time"><span class="endtime">0:01</span></div>
              </div>
              <div class="timeline" aria-hidden="true">
                <div class="snippet"></div><div class="fill"></div><div class="feedback"></div><div class="time-change"><span></span></div>
                <i class="tick" style="left:3.125%"></i><i class="tick" style="left:6.25%"></i><i class="tick" style="left:12.5%"></i><i class="tick" style="left:25%"></i><i class="tick" style="left:50%"></i>
              </div>
              <div class="auto">
                <label class="sr-only" for="corzaguessr-guess">SEARCH FOR A TRACK</label>
                <input id="corzaguessr-guess" class="guess" placeholder="HAVE A GUESS? SEARCH FOR IT HERE!" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="corzaguessr-suggestions" aria-expanded="false" disabled>
                <div class="ruleset" aria-hidden="true"><div class="ruleset-track"><span class="ruleset-text">${p.modePrompt}</span><span class="ruleset-copy">${p.modePrompt}</span></div></div>
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
          <p class="mode-prompt" role="status" aria-hidden="false">${p.modePrompt}</p>
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
    `
      }
      queryElements() {
        let e = [...this.root.querySelectorAll(".audio")];
        if (e.length !== 2) throw new Error("Corzaguessr requires two audio elements.");
        return {
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
          audioPlayers: [e[0], e[1]]
        }
      }
      required(e) {
        let t = this.root.querySelector(e);
        if (!t) throw new Error(`Missing required Corzaguessr element: ${e}`);
        return t
      }
      clearSurvivalFeedback() {
        this.elements.feedback.classList.remove("survival-penalty", "survival-reward"), this.elements.timeChange
          .classList.remove("survival-change"), this.elements.timeChangeText.textContent = ""
      }
      duration(e, t) {
        let i = e.getPropertyValue(t).trim();
        return i.endsWith("ms") ? Number.parseFloat(i) || 0 : i.endsWith("s") ? (Number.parseFloat(i) || 0) * 1e3 :
          0
      }
    };

  function T(r) {
    let e = Math.max(0, r);
    return `${Math.floor(e/60)}:${String(Math.floor(e)%60).padStart(2,"0")}`
  }

  function C(r) {
    return Number.isSafeInteger(r) ? `${r}%` : "--"
  }

  function te(r) {
    return r ? `ATTEMPTS: ${r}` : "ATTEMPTS: --"
  }

  function ie(r) {
    if (!Number.isFinite(r) || r <= 0) return "--";
    let e = Math.round(r * 10) / 10;
    return `${Number.isInteger(e)?e:e.toFixed(1)}S`
  }

  function pe(r, e) {
    let t = document.createElement("div");
    return t.className = "result-module", t.replaceChildren(...r.map((i, s) => {
      let n = document.createElement("span");
      return n.className = s ? "result-value" : "result-label", !s && e && i === "NEW PERSONAL BEST:" && n
        .classList.add("blink"), n.textContent = i, n
    })), t
  }

  function se(r) {
    let e = [];
    return r.mode === "daily" ? e.push(["TRACK:", r.trackTitle], ["RUN:", te(r.attempts)], [r.newPersonalBest ?
      "NEW PERSONAL BEST:" : "PERSONAL BEST:", te(r.bestAttempts)
    ]) : r.mode === "classic" ? e.push(["TRACK:", r.trackTitle], ["RUN:",
      `${r.won?"STREAK":"STREAK ENDED"}: ${r.streak} \xB7 AVERAGE SNIPPET: ${ie(r.average)}`
    ], [r.newPersonalBest ? "NEW PERSONAL BEST:" : "PERSONAL BEST:",
      `STREAK: ${r.bestStreak} \xB7 AVERAGE SNIPPET: ${ie(r.bestAverage)}`
    ]) : r.mode === "blitz" ? e.push(["RUN:", `CORRECT GUESSES: ${r.correct} \xB7 ACCURACY: ${C(r.accuracy)}`], [r
      .newPersonalBest ? "NEW PERSONAL BEST:" : "PERSONAL BEST:",
      `CORRECT GUESSES: ${r.bestCorrect} \xB7 ACCURACY: ${C(r.bestAccuracy)}`
    ]) : e.push(["RUN:", `TIME SURVIVED: ${T(r.elapsedMs/1e3)} \xB7 ACCURACY: ${C(r.accuracy)}`], [r
      .newPersonalBest ? "NEW PERSONAL BEST:" : "PERSONAL BEST:",
      `TIME SURVIVED: ${T(r.bestElapsedMs/1e3)} \xB7 ACCURACY: ${C(r.bestAccuracy)}`
    ]), e
  }

  function ye(r, e = se(r)) {
    let t = r.mode === "blitz" || r.mode === "survival" ? "TIME IS UP." : r.won ? "YOU GOT IT." :
      "YOU GOT IT ALL WRONG.",
      i = e.map(s => `${s[0]?.replace(/:$/,"")??"RESULT"}. ${s.slice(1).join(". ")}`.trim()).join(". ");
    return `${t} ${i}`.trim()
  }
  var k = document.querySelector("#corzaguessr");
  if (k && !k.dataset.corzaguessrReady) try {
    let r = new TrackCatalog(X),
      e = new x(k, r),
      t = new M,
      i = new ProgressCoordinator(t, d => e.announce(d)),
      s, n = new R({
        onTick: d => s?.onClockTick(d),
        onExpired: () => s?.onClockExpired()
      }),
      o = "https://cdn.jsdelivr.net/gh/HankeyThePoo/corzaguessr@main/tracks/",
      a = new w(e.audioElements, d => {
        let u = new URL(`${String(d.track.dailyNumber).padStart(2,"0")}.mp3`, o);
        return u.hash = `t=${d.clipStart}`, u.href
      }, {
        onPlaying: d => s?.onAudioPlaying(d),
        onWaiting: d => s?.onAudioWaiting(d),
        onEnded: d => s?.onAudioEnded(d),
        onBlocked: d => s?.onAudioBlocked(d),
        onFailure: d => s?.onAudioFailure(d)
      }),
      l = new A(d => s?.handleDateChanged(d));
    s = new E({
      catalog: r,
      progress: i,
      clock: n,
      audio: a,
      view: e,
      dailyBoundary: l
    }), e.bind({
      selectMode: d => s.selectMode(d),
      play: () => s.play(),
      playbackShortcut: () => s.playbackShortcut(),
      skip: () => s.skip(),
      guess: d => s.guess(d),
      newGame: () => s.newGame(),
      openDiscovery: () => s.openDiscovery(),
      closeDiscovery: () => s.closeDiscovery(),
      resetDiscovery: () => s.resetDiscovery(),
      openSpotify: () => s.openSpotify()
    });
    let d = l.current();
    s.bootstrap(d), document.addEventListener("visibilitychange", () => {
      document.hidden ? s.handleVisibilityHidden() : s.handleVisibilityVisible()
    }), window.addEventListener("pageshow", () => s.handleVisibilityVisible())
  } catch {
    k.dataset.corzaguessrReady = "error";
    let r = document.createElement("p");
    r.setAttribute("role", "alert"), r.textContent =
      "CORZAGUESSR COULD NOT START. PLEASE REFRESH OR TRY AGAIN LATER.", k.replaceChildren(r)
  }
})();
