(() => {
  "use strict";

  // Configuration -----------------------------------------------------------

  const root = document.querySelector("#corzaguessr");
  if (!root || root.dataset.corzaguessrReady) return;
  root.dataset.corzaguessrReady = "true";

  const scriptUrl = new URL(document.currentScript?.src || location.href);
  const tracksUrl = new URL("tracks.json", scriptUrl);
  tracksUrl.search = scriptUrl.search;
  const audioFolderUrl =
    "https://cdn.jsdelivr.net/gh/HankeyThePoo/corzaguessr@main/tracks/";
  const snippetDurations = [1, 2, 4, 8, 16, 32];
  const maxSnippetDuration = snippetDurations.at(-1);
  const minimumTimedRemainingSeconds = 60;
  const maxTimedSlots = 50;
  const durations = {
    feedback: 680,
    slot: 250,
    result: 350,
    discovery: 450,
    progress: 300,
    modeChange: 120,
  };
  const discoveryStorageKey = "corzaguessrDiscoveredV1";
  const personalBestStorageKey = "corzaguessrPersonalBestsV2";
  const dailyStorageKey = "corzaguessrDailyV1";
  const dailyTimeZone = "Europe/Budapest";
  const modePromptText = "SELECT A MODE TO BEGIN";
  const dailyAudioErrorText = "COULD NOT LOAD TODAY'S TRACK, PRESS PLAY TO RETRY!";
  const dailyCatalogLoadingText = "LOADING TODAY'S TRACK...";
  const dailyCatalogErrorText = "COULD NOT REFRESH TODAY'S TRACK, RETRYING...";
  const discoveryDescription =
    "REVEAL TRACKS YOU'VE GUESSED CORRECTLY AND TRACK YOUR DISCOVERY PROGRESS";
  const dailyDoneText = "ALREADY DONE FOR TODAY, COME BACK TOMORROW";
  const hiddenTitle = "???????????????????";
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = matchMedia("(pointer: fine)");
  const interactiveSelector = "button, input, a, .suggest";
  const budapestDateFormatter = new Intl.DateTimeFormat("en", {
    timeZone: dailyTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const icons = {
    play: "M8 5v14l11-7z",
    pause: "M6 5h4v14H6zM14 5h4v14h-4z",
    stop: "M7 7h10v10H7z",
  };
  const classicModeDefaults = {
    timed: false,
    survival: false,
    initialTime: 60000,
    initialText: "0:00",
    initialProgress: 0,
    endTime: "0:01",
    skip: "ADD 1S",
  };
  const modes = {
    classic: {
      ...classicModeDefaults,
      description: "GUESS THE TRACK IN SIX TRIES AS MORE AUDIO IS REVEALED",
    },
    daily: {
      ...classicModeDefaults,
      daily: true,
      description: "ONE SHARED TRACK EACH DAY, GUESS IT IN SIX TRIES",
    },
    blitz: {
      timed: true,
      survival: false,
      initialTime: 60000,
      initialText: "1:00",
      initialProgress: 1,
      endTime: "1:00",
      skip: "SKIP",
      description: "GUESS AS MANY TRACKS AS POSSIBLE BEFORE THE TIMER RUNS OUT",
    },
    survival: {
      timed: true,
      survival: true,
      initialTime: 30000,
      initialText: "0:00",
      initialProgress: 1,
      endTime: "0:30",
      skip: "SKIP",
      description: "CORRECT GUESSES ADD TIME; MISTAKES AND SKIPS DRAIN IT",
      timeChange: { correct: 3000, wrong: -1000, skip: -2000 },
    },
  };

  root.innerHTML = `
    <div class="wrap">
      <h1>CORZAGUESSR&#10022;</h1>
      <div class="row header-action">
        <button
          type="button"
          class="button discovery-button"
          aria-controls="corzaguessr-discovery"
          aria-expanded="false"
        >DISCOVERY</button>
      </div>
      <div class="modes" aria-label="GAME MODE">
        <button type="button" class="mode" data-mode="daily" aria-pressed="false">
          DAILY
        </button>
        <button type="button" class="mode" data-mode="blitz" aria-pressed="false">
          BLITZ
        </button>
        <button type="button" class="mode" data-mode="classic" aria-pressed="false">
          CLASSIC
        </button>
        <button type="button" class="mode" data-mode="survival" aria-pressed="false">
          SURVIVAL
        </button>
      </div>
      <div class="card glass">
        <div class="stack">
          <div class="board">
            <div class="controls">
              <div class="time"><span class="now">0:00</span></div>
              <button type="button" class="play" aria-label="PLAY" disabled>
                <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="${icons.play}"></path>
                </svg>
              </button>
              <div class="time"><span class="endtime">0:01</span></div>
            </div>
            <div class="timeline" aria-hidden="true">
              <div class="snippet"></div>
              <div class="fill"></div>
              <div class="feedback"></div>
              <div class="time-change"><span></span></div>
              <i class="tick" style="left:3.125%"></i>
              <i class="tick" style="left:6.25%"></i>
              <i class="tick" style="left:12.5%"></i>
              <i class="tick" style="left:25%"></i>
              <i class="tick" style="left:50%"></i>
            </div>
            <div class="auto">
              <label class="sr-only" for="corzaguessr-guess">SEARCH FOR A TRACK</label>
              <input
                id="corzaguessr-guess"
                class="guess"
                placeholder="HAVE A GUESS? SEARCH FOR IT HERE!"
                autocomplete="off"
                role="combobox"
                aria-autocomplete="list"
                aria-controls="corzaguessr-suggestions"
                aria-expanded="false"
                disabled
              >
              <div class="ruleset" aria-hidden="true">
                <div class="ruleset-track">
                  <span class="ruleset-text">${modePromptText}</span>
                  <span class="ruleset-copy">${modePromptText}</span>
                </div>
              </div>
              <div
                id="corzaguessr-suggestions"
                class="suggest"
                role="listbox"
              ></div>
            </div>
            <div class="row">
              <button type="button" class="button skip" disabled>ADD 1S</button>
            </div>
          </div>
          <div class="slots" aria-live="polite" aria-relevant="additions text"></div>
        </div>
        <div class="result-modal">
          <div class="result-shell">
            <div
              class="corzaguessr-modal glass"
              role="dialog"
              aria-modal="true"
              aria-labelledby="corzaguessr-result-title"
              aria-describedby="corzaguessr-result-meta"
              aria-hidden="true"
            >
              <h3 id="corzaguessr-result-title" class="modal-title"></h3>
              <div id="corzaguessr-result-meta" class="result-meta"></div>
              <div class="actions">
                <button type="button" class="button next">NEW GAME</button>
                <button type="button" class="button spotify">SPOTIFY</button>
              </div>
            </div>
          </div>
        </div>
        <p class="mode-prompt" role="status" aria-hidden="false">
          ${modePromptText}
        </p>
        <div
          id="corzaguessr-discovery"
          class="discovery-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="corzaguessr-discovery-title"
          aria-hidden="true"
          tabindex="-1"
        >
          <div class="discovery-shell">
            <div class="discovery-panel glass">
              <h3 id="corzaguessr-discovery-title" class="discovery-title">
                <span>DISCOVERY</span>
                <small>0 / 0 (0%)</small>
              </h3>
              <div class="discovery-items" role="list"></div>
              <div class="actions">
                <button type="button" class="button discovery-close">CLOSE</button>
                <button type="button" class="button discovery-reset">RESET</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <p class="sr-only status" aria-live="polite"></p>
    <audio class="audio" preload="metadata" playsinline aria-hidden="true" hidden></audio>
    <audio class="audio" preload="metadata" playsinline aria-hidden="true" hidden></audio>
  `;

  const $ = (selector) => root.querySelector(selector);
  const ui = {
    headerAction: $(".header-action"),
    modes: $(".modes"),
    card: $(".card"),
    board: $(".board"),
    slots: $(".slots"),
    play: $(".play"),
    skip: $(".skip"),
    guess: $(".guess"),
    suggest: $(".suggest"),
    ruleset: $(".ruleset"),
    rulesetText: $(".ruleset-text"),
    rulesetCopy: $(".ruleset-copy"),
    feedback: $(".feedback"),
    timeChange: $(".time-change"),
    timeChangeText: $(".time-change span"),
    fill: $(".fill"),
    snippet: $(".snippet"),
    now: $(".now"),
    endtime: $(".endtime"),
    spotify: $(".spotify"),
    next: $(".next"),
    result: $(".corzaguessr-modal"),
    resultTitle: $(".modal-title"),
    resultMeta: $(".result-meta"),
    modePrompt: $(".mode-prompt"),
    discoveryButton: $(".discovery-button"),
    discoveryModal: $(".discovery-modal"),
    discoveryShell: $(".discovery-shell"),
    discoveryPanel: $(".discovery-panel"),
    discoveryCount: $("#corzaguessr-discovery-title small"),
    discoveryItems: $(".discovery-items"),
    discoveryClose: $(".discovery-close"),
    discoveryReset: $(".discovery-reset"),
    status: $(".status"),
    audioPlayers: [...root.querySelectorAll(".audio")],
    icon: $(".icon path"),
  };
  const modeButtons = Object.fromEntries(
    [...root.querySelectorAll("[data-mode]")]
      .map((button) => [button.dataset.mode, button]),
  );

  // State and small utilities -----------------------------------------------

  const state = {
    appPhase: "loading",
    mode: null,
    step: 0,
    rounds: 0,
    guesses: 0,
    correct: 0,
    used: new Set(),
    discovered: loadDiscoveries(),
    personalBests: loadPersonalBests(),
    newPersonalBest: false,
    classicResult: null,
    notice: null,
    activeSuggestion: -1,
  };
  const roundState = {
    phase: "idle",
    current: null,
    previousDailyNumber: null,
    nextId: 0,
  };
  const dailyState = {
    progress: loadDaily(),
    roundDate: getBudapestDate(),
    retryRound: null,
  };
  const catalogState = {
    applied: {
      date: null,
      version: 0,
      tracks: [],
    },
    nextRequestId: 0,
    refresh: { kind: "idle" },
    unavailable: new Set(),
  };
  const overlayState = {
    kind: null,
    phase: "closed",
    generation: 0,
    returnFocus: null,
    pageScrollStyles: null,
    discoverySuspension: null,
  };
  const availabilityState = {
    signature: null,
  };
  const timers = new Map();
  const frames = new Map();

  root.classList.add("awaiting-mode", "rules-visible");
  syncBackgroundInert();

  function formatTime(seconds) {
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds) % 60).padStart(2, "0")}`;
  }

  function getBudapestDate(date = new Date()) {
    const parts = budapestDateFormatter.formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function currentMode() {
    return modes[state.mode];
  }

  function currentRound() {
    return roundState.current;
  }

  function currentTrack() {
    return roundState.current?.track || null;
  }

  function clearTimer(name) {
    clearTimeout(timers.get(name));
    timers.delete(name);
  }

  function setTimer(name, callback, delay) {
    clearTimer(name);
    const timer = setTimeout(() => {
      timers.delete(name);
      callback();
    }, delay);
    timers.set(name, timer);
  }

  function clearFrame(name) {
    cancelAnimationFrame(frames.get(name));
    frames.delete(name);
  }

  function setFrame(name, callback) {
    clearFrame(name);
    const frame = requestAnimationFrame(() => {
      frames.delete(name);
      callback();
    });
    frames.set(name, frame);
  }

  function announce(message) {
    ui.status.textContent = "";
    setFrame("announcement", () => {
      ui.status.textContent = message;
    });
  }

  function focusGuess() {
    if (!finePointer.matches || ui.guess.disabled || isModalOpen()) return;
    setFrame("guess-focus", () => {
      if (!ui.guess.disabled && !isModalOpen()) ui.guess.focus();
    });
  }

  function focusPlay() {
    if (canUsePlayback()) {
      ui.play.focus({ preventScroll: true });
    }
  }

  function isResultOpen() {
    return overlayState.kind === "result" && overlayState.phase !== "closed";
  }

  function isDiscoveryOpen() {
    return overlayState.kind === "discovery" && overlayState.phase !== "closed";
  }

  function isDiscoveryVisible() {
    return (
      overlayState.kind === "discovery" &&
      (overlayState.phase === "opening" || overlayState.phase === "open")
    );
  }

  function isAwaitingMode() {
    return root.classList.contains("awaiting-mode");
  }

  function isModalOpen() {
    return overlayState.phase !== "closed";
  }

  function canPreviewRules() {
    return !isModalOpen() && (isAwaitingMode() || (state.mode && !currentRound()));
  }

  function canUsePlayback() {
    return (
      state.appPhase === "ready" &&
      state.mode &&
      !isAwaitingMode() &&
      !isModalOpen() &&
      !ui.play.disabled
    );
  }

  function isRoundReadyToStart() {
    return canUsePlayback() && !currentRound();
  }

  function transitionDelay(milliseconds) {
    return reducedMotion.matches ? 0 : milliseconds;
  }

  function syncBackgroundInert() {
    const resultOpen = isResultOpen();
    const discoveryOpen = isDiscoveryOpen();
    const overlayOpen = resultOpen || discoveryOpen;
    ui.headerAction.inert = resultOpen;
    ui.modes.inert = overlayOpen;
    ui.board.inert = overlayOpen || isAwaitingMode();
    ui.slots.inert = overlayOpen || isAwaitingMode();
  }

  function beginOverlayTransition(kind, phase) {
    overlayState.kind = kind;
    overlayState.phase = phase;
    return ++overlayState.generation;
  }

  function overlayTransitionMatches(kind, phase, generation) {
    return (
      overlayState.kind === kind &&
      overlayState.phase === phase &&
      overlayState.generation === generation
    );
  }

  function canFocusElement(element) {
    return Boolean(
      element?.isConnected &&
      !element.disabled &&
      !element.hidden &&
      !element.closest("[inert]")
    );
  }

  function restoreOverlayFocus(preferred) {
    if (isModalOpen()) return;
    const target = [
      preferred,
      canUsePlayback() ? ui.play : null,
      ui.discoveryButton,
      ...Object.values(modeButtons),
    ].find(canFocusElement);
    target?.focus({ preventScroll: true });
  }

  function setProgress(text, scale) {
    const clampedScale = Math.max(0, Math.min(1, scale));
    ui.now.textContent = text;
    ui.fill.style.transform = `scaleX(${clampedScale})`;
    ui.feedback.style.transform = `scaleX(${clampedScale})`;
  }

  function flashSurvivalChange(amount) {
    if (state.mode !== "survival" || !amount) return;
    const flashClass = amount > 0 ? "survival-reward" : "survival-penalty";
    const duration = transitionDelay(durations.feedback);
    clearTimer("feedback");
    ui.timeChangeText.textContent = amount > 0 ? `+${amount}S` : `${amount}S`;
    ui.feedback.classList.remove("survival-penalty", "survival-reward");
    ui.timeChange.classList.remove("survival-change");
    void ui.feedback.offsetWidth;
    void ui.timeChange.offsetWidth;
    ui.feedback.classList.add(flashClass);
    ui.timeChange.classList.add("survival-change");
    setTimer("feedback", () => {
      ui.feedback.classList.remove("survival-penalty", "survival-reward");
      ui.timeChange.classList.remove("survival-change");
      ui.timeChangeText.textContent = "";
    }, duration);
  }

  function readStorage(key, fallback) {
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? fallback : JSON.parse(saved);
    } catch {
      return fallback;
    }
  }

  function writeStorage(key, value, errorMessage) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      announce(errorMessage);
      return false;
    }
  }

  function loadDiscoveries() {
    const saved = readStorage(discoveryStorageKey, []);
    return new Set(
      Array.isArray(saved)
        ? saved.filter((title) => typeof title === "string")
        : [],
    );
  }

  function saveDiscoveries() {
    writeStorage(
      discoveryStorageKey,
      [...state.discovered],
      "DISCOVERY PROGRESS COULD NOT BE SAVED IN THIS BROWSER.",
    );
  }

  function validRecord(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  function validAccuracy(value) {
    return Number.isSafeInteger(value) && value >= 0 && value <= 100
      ? value
      : null;
  }

  function validSnippetTotal(value, current) {
    return Number.isSafeInteger(value) &&
      value >= current &&
      value <= current * maxSnippetDuration
      ? value
      : 0;
  }

  function loadClassicPersonalBest(saved) {
    const current = validRecord(saved?.current);
    const best = validRecord(saved?.best);
    const snippetTotal = validSnippetTotal(saved?.snippetTotal, current);
    const activeCurrent = snippetTotal ? current : 0;
    const savedBestSnippetTotal = validSnippetTotal(saved?.bestSnippetTotal, best);
    const resolvedBest = Math.max(activeCurrent, best);
    const bestSnippetTotal = activeCurrent > best
      ? snippetTotal
      : savedBestSnippetTotal || (activeCurrent === best ? snippetTotal : 0);
    return {
      current: activeCurrent,
      best: resolvedBest,
      snippetTotal: activeCurrent ? snippetTotal : 0,
      bestSnippetTotal,
    };
  }

  function loadTimedPersonalBest(saved) {
    const source = saved && typeof saved === "object"
      ? saved
      : {};
    return {
      score: validRecord(source?.score),
      accuracy: validAccuracy(source?.accuracy),
    };
  }

  function loadPersonalBests() {
    const saved = readStorage(personalBestStorageKey, {});
    const source = saved && typeof saved === "object" ? saved : {};
    return {
      classic: loadClassicPersonalBest(source?.classic),
      daily: validRecord(source?.daily),
      blitz: loadTimedPersonalBest(source?.blitz),
      survival: loadTimedPersonalBest(source?.survival),
    };
  }

  function savePersonalBests() {
    writeStorage(
      personalBestStorageKey,
      state.personalBests,
      "PERSONAL BESTS COULD NOT BE SAVED IN THIS BROWSER.",
    );
  }

  function loadDaily() {
    const saved = readStorage(dailyStorageKey, {});
    const started = saved?.started === true;
    const completed = started && saved?.completed === true;
    const step = Number.isSafeInteger(saved?.step) &&
      saved.step >= 0 &&
      saved.step < snippetDurations.length
      ? saved.step
      : 0;
    return {
      date: /^\d{4}-\d{2}-\d{2}$/.test(saved?.date) ? saved.date : "",
      started,
      completed,
      won: completed && saved?.won === true,
      step,
    };
  }

  function saveDaily() {
    writeStorage(
      dailyStorageKey,
      dailyState.progress,
      "DAILY PROGRESS COULD NOT BE SAVED IN THIS BROWSER.",
    );
  }

  function isDailyDone(date = dailyState.roundDate) {
    return dailyState.progress.date === date && dailyState.progress.completed;
  }

  function isDailyStarted(date = dailyState.roundDate) {
    return dailyState.progress.date === date && dailyState.progress.started;
  }

  function isDailyInProgress(date = dailyState.roundDate) {
    return isDailyStarted(date) && !dailyState.progress.completed;
  }

  function getDailyDoneText() {
    if (dailyState.progress.date === dailyState.roundDate && dailyState.progress.completed) {
      const attempts = dailyState.progress.step + 1;
      const label = dailyState.progress.won ? "COMPLETED" : "FAILED";
      return `${label} IN ${attempts} ATTEMPT${attempts === 1 ? "" : "S"}, COME BACK TOMORROW`;
    }
    return dailyDoneText;
  }

  function getDailyInProgressText() {
    const attempt = dailyState.progress.step + 1;
    return `DAILY IN PROGRESS, CONTINUE FROM ATTEMPT ${attempt}`;
  }

  function markDailyStarted() {
    const date = currentRound()?.roundDate;
    if (state.mode !== "daily" || !date || isDailyStarted(date)) return;
    dailyState.progress = {
      date,
      started: true,
      completed: false,
      won: false,
      step: 0,
    };
    saveDaily();
  }

  function saveDailyStep() {
    const date = currentRound()?.roundDate;
    if (
      state.mode !== "daily" ||
      !date ||
      dailyState.progress.date !== date ||
      !dailyState.progress.started ||
      dailyState.progress.completed
    ) return;
    dailyState.progress.step = state.step;
    saveDaily();
  }

  function completeDaily(won) {
    const date = currentRound()?.roundDate;
    if (state.mode !== "daily" || !date) return;
    dailyState.progress = {
      date,
      started: true,
      completed: true,
      won: Boolean(won),
      step: state.step,
    };
    saveDaily();
  }

  function hashDaily(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function isDailyRoundProtected() {
    if (state.mode !== "daily") return false;
    const round = currentRound() || dailyState.retryRound;
    if (round?.modeName !== "daily") return false;
    return roundState.phase === "result" || isDailyInProgress(round.roundDate);
  }

  function dailyNeedsCatalogRefresh(date = getBudapestDate()) {
    return (
      state.mode === "daily" &&
      date !== catalogState.applied.date &&
      !isDailyRoundProtected()
    );
  }

  function getDailyCatalogStatusText() {
    return catalogState.refresh.kind === "retry" &&
      catalogState.refresh.date === getBudapestDate()
      ? dailyCatalogErrorText
      : dailyCatalogLoadingText;
  }

  // Audio streaming ---------------------------------------------------------

  function createAudioDeck(elements, handlers) {
    const slots = elements.map((element, id) => ({
      id,
      element,
      generation: 0,
      role: "empty",
      round: null,
      events: null,
      failed: false,
    }));
    let active = null;
    let standby = null;
    let nextGeneration = 0;
    let lastActiveSlotId = null;
    let transportPhase = "empty";
    let suspension = null;

    const slotSnapshot = (slot) => slot ? Object.freeze({
      round: slot.round,
      slotId: slot.id,
      generation: slot.generation,
    }) : null;
    const isLive = (slot, generation) => (
      slot.generation === generation && slot.role !== "empty"
    );
    const isSuspendedSlot = (slot) => Boolean(
      suspension &&
      suspension.slotId === slot.id &&
      suspension.generation === slot.generation &&
      suspension.roundId === slot.round?.id
    );

    function seekToStart(slot) {
      if (!slot?.round) return;
      if (slot.element.readyState < HTMLMediaElement.HAVE_METADATA) return;
      try {
        slot.element.currentTime = Math.min(
          slot.round.track.at,
          Math.max(0, slot.element.duration - 0.05),
        );
      } catch {
        // The media fragment remains the fallback until seeking is possible.
      }
    }

    function releaseSlot(slot) {
      if (!slot) return;
      slot.events?.abort();
      slot.events = null;
      slot.role = "empty";
      slot.round = null;
      slot.failed = false;
      slot.element.pause();
      slot.element.removeAttribute("src");
      slot.element.load();
    }

    function emitFailure(slot, error) {
      if (!slot || slot.failed) return;
      slot.failed = true;
      const role = slot.role;
      const payload = { ...slotSnapshot(slot), role, error };
      if (role === "standby") {
        standby = null;
        releaseSlot(slot);
      } else if (role === "active") {
        transportPhase = "error";
        if (isSuspendedSlot(slot)) {
          suspension.terminal = { status: "error", payload };
          return;
        }
      }
      handlers.onError(payload);
    }

    function bindSlotEvents(slot) {
      const generation = slot.generation;
      const controller = new AbortController();
      const current = () => isLive(slot, generation);
      slot.events = controller;
      slot.element.addEventListener("loadedmetadata", () => {
        if (current()) seekToStart(slot);
      }, { signal: controller.signal });
      slot.element.addEventListener("playing", () => {
        if (
          !current() ||
          slot !== active ||
          (transportPhase !== "starting" && transportPhase !== "buffering")
        ) return;
        transportPhase = "playing";
        handlers.onPlaying(slotSnapshot(slot));
      }, { signal: controller.signal });
      slot.element.addEventListener("waiting", () => {
        if (!current() || slot !== active || transportPhase === "paused") return;
        transportPhase = "buffering";
        handlers.onWaiting(slotSnapshot(slot));
      }, { signal: controller.signal });
      slot.element.addEventListener("ended", () => {
        if (!current() || slot !== active) return;
        transportPhase = "ended";
        const payload = slotSnapshot(slot);
        if (isSuspendedSlot(slot)) {
          suspension.terminal = { status: "ended", payload };
        } else {
          handlers.onEnded(payload);
        }
      }, { signal: controller.signal });
      slot.element.addEventListener("error", () => {
        if (current()) emitFailure(slot, slot.element.error);
      }, { signal: controller.signal });
    }

    function discardStandby() {
      const slot = standby;
      standby = null;
      releaseSlot(slot);
    }

    function releaseActive() {
      const slot = active;
      if (slot) lastActiveSlotId = slot.id;
      active = null;
      suspension = null;
      transportPhase = standby ? "paused" : "empty";
      releaseSlot(slot);
    }

    function assignStandby(round) {
      discardStandby();
      const available = slots.filter((candidate) => candidate !== active);
      const slot = available.find((candidate) => candidate.id !== lastActiveSlotId) || available[0];
      if (!slot) return null;
      releaseSlot(slot);
      Object.assign(slot, {
        generation: ++nextGeneration,
        role: "standby",
        round,
      });
      slot.element.preload = "auto";
      standby = slot;
      bindSlotEvents(slot);
      slot.element.src = getAudioUrl(round.track);
      slot.element.load();
      return slotSnapshot(slot);
    }

    function getStandby() {
      return slotSnapshot(standby);
    }

    function getActive() {
      const slot = slotSnapshot(active);
      return slot ? Object.freeze({ ...slot, transportPhase }) : null;
    }

    function promoteStandby() {
      if (!standby) return null;
      const previous = active;
      active = standby;
      standby = null;
      active.role = "active";
      transportPhase = "paused";
      if (previous && previous !== active) releaseSlot(previous);
      return active.round;
    }

    function playActive({ rewind = false } = {}) {
      if (!active) return false;
      const slot = active;
      const generation = slot.generation;
      if (rewind) seekToStart(slot);
      transportPhase = "starting";
      slot.element.play()?.catch((error) => {
        if (!isLive(slot, generation) || slot !== active || error?.name === "AbortError") return;
        if (error?.name === "NotAllowedError") {
          transportPhase = "paused";
          handlers.onPlayBlocked(slotSnapshot(slot));
          return;
        }
        emitFailure(slot, error);
      });
      return true;
    }

    function pauseActive() {
      if (!active) return false;
      transportPhase = "paused";
      active.element.pause();
      return true;
    }

    function reset({ keepStandby = false } = {}) {
      releaseActive();
      if (!keepStandby) discardStandby();
      transportPhase = standby ? "paused" : "empty";
    }

    function isPlayRequested() {
      return transportPhase === "starting" ||
        transportPhase === "playing" ||
        transportPhase === "buffering";
    }

    function suspendActive() {
      if (!active) return null;
      suspension = {
        slotId: active.id,
        generation: active.generation,
        roundId: active.round.id,
        shouldResume: isPlayRequested(),
        terminal: null,
      };
      pauseActive();
      return Object.freeze({
        slotId: suspension.slotId,
        generation: suspension.generation,
        roundId: suspension.roundId,
      });
    }

    function restoreActive(token) {
      if (
        !token ||
        !suspension ||
        token.slotId !== suspension.slotId ||
        token.generation !== suspension.generation ||
        token.roundId !== suspension.roundId ||
        !active ||
        active.id !== token.slotId ||
        active.generation !== token.generation ||
        active.round.id !== token.roundId
      ) {
        suspension = null;
        return { status: "stale" };
      }
      const saved = suspension;
      suspension = null;
      if (saved.terminal) return saved.terminal;
      if (!saved.shouldResume) return { status: "paused", round: active.round };
      playActive();
      return { status: "resumed", round: active.round };
    }

    return {
      assignStandby,
      getStandby,
      getActive,
      promoteStandby,
      playActive,
      pauseActive,
      releaseActive,
      discardStandby,
      reset,
      suspendActive,
      restoreActive,
      isPlayRequested,
    };
  }

  function createGameClock({ onTick, onExpire }) {
    const clock = {
      kind: "classic",
      running: false,
      expired: false,
      anchorMs: 0,
      elapsedMs: 0,
      remainingMs: 0,
      limitMs: snippetDurations[0] * 1000,
      maxRemainingMs: 0,
      frame: 0,
    };
    const snapshot = () => Object.freeze({
      kind: clock.kind,
      running: clock.running,
      expired: clock.expired,
      elapsedMs: clock.elapsedMs,
      remainingMs: clock.remainingMs,
      limitMs: clock.limitMs,
      maxRemainingMs: clock.maxRemainingMs,
    });

    function cancelFrame() {
      cancelAnimationFrame(clock.frame);
      clock.frame = 0;
    }

    function reachedLimit() {
      return clock.kind === "classic"
        ? clock.elapsedMs >= clock.limitMs
        : clock.remainingMs <= 0;
    }

    function expireIfNeeded() {
      if (clock.expired || !reachedLimit()) return false;
      clock.expired = true;
      clock.running = false;
      cancelFrame();
      onTick(snapshot());
      onExpire(snapshot());
      return true;
    }

    function commit(now = performance.now(), allowExpire = true) {
      if (!clock.running) return snapshot();
      const delta = Math.max(0, now - clock.anchorMs);
      clock.anchorMs = now;
      if (clock.kind === "classic") {
        clock.elapsedMs += delta;
      } else {
        clock.remainingMs = Math.max(0, clock.remainingMs - delta);
        if (clock.kind === "survival") clock.elapsedMs += delta;
      }
      onTick(snapshot());
      if (allowExpire) expireIfNeeded();
      return snapshot();
    }

    function tick(now) {
      if (!clock.running) return;
      commit(now);
      if (clock.running) clock.frame = requestAnimationFrame(tick);
    }

    function resetClassic(limitMs) {
      cancelFrame();
      Object.assign(clock, {
        kind: "classic",
        running: false,
        expired: false,
        anchorMs: 0,
        elapsedMs: 0,
        remainingMs: 0,
        limitMs,
        maxRemainingMs: 0,
      });
      onTick(snapshot());
      return snapshot();
    }

    function setClassicLimit(limitMs) {
      commit(performance.now(), false);
      clock.limitMs = limitMs;
      expireIfNeeded();
      onTick(snapshot());
      return snapshot();
    }

    function resetTimed(kind, initialMs) {
      cancelFrame();
      Object.assign(clock, {
        kind,
        running: false,
        expired: false,
        anchorMs: 0,
        elapsedMs: 0,
        remainingMs: initialMs,
        limitMs: 0,
        maxRemainingMs: initialMs,
      });
      onTick(snapshot());
      return snapshot();
    }

    function resume() {
      if (clock.running || clock.expired) return false;
      clock.running = true;
      clock.anchorMs = performance.now();
      clock.frame = requestAnimationFrame(tick);
      return true;
    }

    function pause() {
      if (clock.running) commit();
      clock.running = false;
      cancelFrame();
      return snapshot();
    }

    function adjustRemaining(deltaMs) {
      if (clock.kind === "classic" || clock.expired) return snapshot();
      if (clock.running) commit();
      if (clock.expired) return snapshot();
      clock.remainingMs = Math.max(0, clock.remainingMs + deltaMs);
      clock.maxRemainingMs = Math.max(clock.maxRemainingMs, clock.remainingMs);
      onTick(snapshot());
      expireIfNeeded();
      return snapshot();
    }

    function stop({ flush = true } = {}) {
      if (flush && clock.running) commit(performance.now(), false);
      clock.running = false;
      cancelFrame();
      return snapshot();
    }

    return {
      resetClassic,
      setClassicLimit,
      resetTimed,
      resume,
      pause,
      adjustRemaining,
      stop,
      snapshot,
    };
  }

  function getAudioUrl(track) {
    const url = new URL(
      `${String(track.dailyNumber).padStart(2, "0")}.mp3`,
      audioFolderUrl,
    );
    url.hash = `t=${track.at}`;
    return url.href;
  }

  function createRoundCandidate(selected) {
    if (!selected) return null;
    const mode = currentMode();
    const minimumRemainingSeconds = Math.min(
      mode.timed ? minimumTimedRemainingSeconds : maxSnippetDuration,
      selected.duration,
    );
    const available = Math.max(
      0,
      Math.floor(selected.duration - minimumRemainingSeconds),
    );
    return {
      id: ++roundState.nextId,
      modeName: state.mode,
      catalogVersion: catalogState.applied.version,
      roundDate: mode.daily ? dailyState.roundDate : null,
      hasPlayed: false,
      track: {
        ...selected,
        at: mode.daily
          ? hashDaily(
            `corzaguessr-daily-clip-v1:${dailyState.roundDate}:${selected.dailyNumber}`,
          ) % (available + 1)
          : Math.floor(Math.random() * (available + 1)),
      },
    };
  }

  function standbyMatchesSession(standby = audioDeck.getStandby()) {
    return Boolean(
      standby &&
      standby.round.modeName === state.mode &&
      standby.round.catalogVersion === catalogState.applied.version &&
      (!currentMode().daily || standby.round.roundDate === dailyState.roundDate)
    );
  }

  function ensureStandby() {
    if (!state.mode || !catalogState.applied.tracks.length) return;
    const mode = currentMode();
    if (
      mode.daily &&
      (dailyNeedsCatalogRefresh() || currentRound() || isDailyDone(dailyState.roundDate))
    ) return;
    if (standbyMatchesSession()) return audioDeck.getStandby();
    audioDeck.discardStandby();
    const candidate = mode.daily && dailyState.retryRound
      ? dailyState.retryRound
      : createRoundCandidate(selectTrack());
    return candidate ? audioDeck.assignStandby(candidate) : null;
  }

  function promotePreparedRound() {
    if (!standbyMatchesSession()) ensureStandby();
    if (!standbyMatchesSession()) return null;
    return audioDeck.promoteStandby();
  }

  const gameClock = createGameClock({
    onTick: renderClock,
    onExpire: handleClockExpired,
  });
  const audioDeck = createAudioDeck(ui.audioPlayers, {
    onPlaying: handleAudioPlaying,
    onWaiting: handleAudioWaiting,
    onEnded: handleAudioEnded,
    onError: handleAudioError,
    onPlayBlocked: handleAudioPlayBlocked,
  });

  function renderClock(clock) {
    const mode = currentMode();
    if (!mode) return;
    if (!mode.timed) {
      setProgress(
        formatTime(clock.elapsedMs / 1000),
        clock.elapsedMs
          ? clock.elapsedMs / (maxSnippetDuration * 1000) + 0.0025
          : 0,
      );
      return;
    }
    if (mode.survival) {
      ui.endtime.textContent = formatTime(Math.ceil(clock.remainingMs / 1000));
    }
    setProgress(
      formatTime((mode.survival ? clock.elapsedMs : clock.remainingMs) / 1000),
      clock.remainingMs / (mode.survival ? clock.maxRemainingMs : mode.initialTime),
    );
  }

  function handleClockExpired(clock) {
    if (roundState.phase === "result") return;
    if (clock.kind === "classic") {
      audioDeck.pauseActive();
      renderPlaybackIntent(false);
      return;
    }
    endGame();
  }

  function renderPlaybackIntent(playing) {
    const icon = playing
      ? currentMode().timed ? "pause" : "stop"
      : "play";
    ui.icon.setAttribute("d", icons[icon]);
    ui.play.setAttribute(
      "aria-label",
      icon === "play" ? "PLAY" : icon === "pause" ? "PAUSE" : "STOP",
    );
  }

  function pausePlayback({ pauseAudio = true } = {}) {
    const clock = gameClock.pause();
    if (pauseAudio) audioDeck.pauseActive();
    renderPlaybackIntent(false);
    return clock;
  }

  function requestPlayback({ rewind = false } = {}) {
    if (!currentRound() || audioDeck.getActive()?.round.id !== currentRound().id) return false;
    if (rewind) {
      currentRound().hasPlayed = false;
      roundState.phase = "starting";
    }
    renderPlaybackIntent(true);
    return audioDeck.playActive({ rewind });
  }

  function rewindClassic() {
    cancelProgressTransition();
    ui.fill.style.transition = "transform 250ms ease-out";
    setProgress("0:00", 0);
    setTimer("progress", () => {
      ui.fill.style.transition = "";
    }, transitionDelay(durations.progress));
  }

  function startClassic() {
    if (!currentRound()) return;
    rewindClassic();
    gameClock.resetClassic(snippetDurations[state.step] * 1000);
    requestPlayback({ rewind: true });
    focusGuess();
  }

  function invalidateAudioSession({ discardStandby = true } = {}) {
    gameClock.stop({ flush: false });
    audioDeck.reset({ keepStandby: !discardStandby });
    roundState.current = null;
    roundState.phase = "idle";
    overlayState.discoverySuspension = null;
    renderPlaybackIntent(false);
  }

  function handleDailyTrackError(round = currentRound()) {
    dailyState.retryRound = round;
    invalidateAudioSession();
    state.notice = "daily-audio-error";
    clearSlots(false);
    applyModeAvailability({ force: true });
    announce(dailyAudioErrorText);
  }

  function handleActiveTrackError(round) {
    if (
      roundState.phase === "result" ||
      !currentRound() ||
      round.id !== currentRound().id
    ) return;
    if (round.modeName === "daily") {
      if (!isResultOpen()) handleDailyTrackError(round);
      return;
    }
    pausePlayback();
    if (roundState.phase === "result") return;
    const failedTrack = round.track;
    catalogState.unavailable.add(failedTrack.dailyNumber);
    audioDeck.releaseActive();
    roundState.current = null;
    roundState.phase = "idle";
    ui.skip.disabled = true;
    showRules(currentMode().description);
    clearSlots(false);
    addSlot("COULD NOT PLAY TRACK, TRY AGAIN!", "blink");
    announce("THE SELECTED TRACK COULD NOT BE PLAYED. TRY AGAIN.");
    ensureStandby();
  }

  function handleAudioPlaying(payload) {
    if (
      !currentRound() ||
      payload.round.id !== currentRound().id ||
      isModalOpen() ||
      roundState.phase === "result"
    ) return;
    currentRound().hasPlayed = true;
    roundState.phase = "active";
    markDailyStarted();
    ui.skip.disabled = false;
    renderPlaybackIntent(true);
    gameClock.resume();
    ensureStandby();
  }

  function handleAudioWaiting(payload) {
    if (!currentRound() || payload.round.id !== currentRound().id) return;
    gameClock.pause();
  }

  function handleAudioEnded(payload) {
    if (
      !currentRound() ||
      payload.round.id !== currentRound().id ||
      !currentRound().hasPlayed ||
      roundState.phase === "result"
    ) return;
    handleTrackEnded();
  }

  function handleAudioError(payload) {
    if (payload.role === "standby") {
      if (payload.round.modeName === "daily") {
        handleDailyTrackError(payload.round);
        return;
      }
      catalogState.unavailable.add(payload.round.track.dailyNumber);
      ensureStandby();
      return;
    }
    handleActiveTrackError(payload.round);
  }

  function handleAudioPlayBlocked(payload) {
    if (!currentRound() || payload.round.id !== currentRound().id) return;
    gameClock.pause();
    renderPlaybackIntent(false);
    announce("PRESS PLAY TO START THE AUDIO.");
  }

  // Rendering ---------------------------------------------------------------

  function clearGuess() {
    ui.guess.value = "";
    closeSuggestions();
  }

  function closeSuggestions() {
    state.activeSuggestion = -1;
    ui.suggest.replaceChildren();
    ui.suggest.style.display = "none";
    ui.guess.setAttribute("aria-expanded", "false");
    ui.guess.removeAttribute("aria-activedescendant");
  }

  function showRules(text) {
    clearGuess();
    ui.guess.disabled = true;
    ui.modePrompt.textContent = text;
    ui.rulesetText.textContent = text;
    ui.rulesetCopy.textContent = text;
    ui.ruleset.classList.remove("scroll");
    void ui.ruleset.offsetWidth;
    ui.ruleset.classList.add("scroll");
    root.classList.add("rules-visible");
  }

  function getModeRulesText(modeName) {
    const mode = modes[modeName];
    if (!mode) return modePromptText;
    if (!mode.daily) return mode.description;
    if (state.mode === modeName && state.notice === "daily-audio-error") {
      return dailyAudioErrorText;
    }
    if (state.mode === modeName && dailyNeedsCatalogRefresh()) {
      return getDailyCatalogStatusText();
    }
    if (state.mode === modeName && isDailyDone()) return getDailyDoneText();
    if (state.mode === modeName && isDailyInProgress()) return getDailyInProgressText();
    return mode.description;
  }

  function getCurrentRulesText() {
    return state.mode ? getModeRulesText(state.mode) : modePromptText;
  }

  function previewMode(modeName) {
    if (!canPreviewRules()) return;
    showRules(getModeRulesText(modeName));
  }

  function previewDiscovery() {
    if (!canPreviewRules()) return;
    showRules(discoveryDescription);
  }

  function resetRulesPreview() {
    if (!canPreviewRules()) return;
    showRules(getCurrentRulesText());
  }

  function showGuess() {
    root.classList.remove("rules-visible");
    ui.ruleset.classList.remove("scroll");
    ui.guess.disabled = false;
  }

  function createSlotView(container) {
    const entering = new WeakSet();
    let pendingClear = null;

    function finishPendingClear(clear = pendingClear) {
      if (!clear || pendingClear !== clear) return;
      clearTimer("slots");
      clear.items.forEach((item) => {
        entering.delete(item);
        item.remove();
      });
      container.style.height = "";
      pendingClear = null;
    }

    function clear(animate = true) {
      finishPendingClear();
      const items = [...container.children];
      if (!items.length) return;
      if (!animate || reducedMotion.matches) {
        items.forEach((item) => item.remove());
        container.style.height = "";
        return;
      }

      items.forEach((item) => {
        entering.delete(item);
        item.classList.add("fade");
      });
      container.style.height = `${container.offsetHeight}px`;
      void container.offsetHeight;
      container.style.height = "0px";
      const operation = { items };
      pendingClear = operation;
      setTimer("slots", () => finishPendingClear(operation), durations.slot);
    }

    function add(text, style = "", replace = false) {
      finishPendingClear();
      const item = replace && container.firstElementChild
        ? container.firstElementChild
        : document.createElement("div");
      entering.delete(item);
      item.className = `slot ${replace ? "" : "fade"} ${style}`.trim();
      item.textContent = text;
      if (!replace || !item.isConnected) {
        container.prepend(item);
        if (currentMode().timed) {
          while (container.children.length > maxTimedSlots) {
            container.lastElementChild.remove();
          }
        }
        entering.add(item);
        requestAnimationFrame(() => {
          if (!entering.delete(item) || !item.isConnected) return;
          item.classList.remove("fade");
        });
      }
    }

    return { clear, add };
  }

  const { clear: clearSlots, add: addSlot } = createSlotView(ui.slots);

  function renderPrompt() {
    if (currentMode().timed) {
      addSlot(`GUESS #${state.rounds}`);
      return;
    }

    const seconds = snippetDurations[state.step];
    const last = state.step === snippetDurations.length - 1;
    ui.endtime.textContent = formatTime(seconds);
    ui.snippet.style.width = `${seconds / maxSnippetDuration * 100}%`;
    ui.skip.textContent = last
      ? "GIVE UP"
      : `ADD ${snippetDurations[state.step + 1] - seconds}S`;
    addSlot(
      last ? "LAST CHANCE TO GUESS" : `GUESS ${state.step + 1} OUT OF ${snippetDurations.length}`,
      last ? "blink" : "",
    );
  }

  function formatDiscoveryCount(found, total) {
    const percent = total ? Math.round(found * 100 / total) : 0;
    return `${found} / ${total} (${percent}%)`;
  }

  function renderDiscoveryItems() {
    if (state.appPhase === "loading" && !catalogState.applied.tracks.length) {
      ui.discoveryCount.textContent = formatDiscoveryCount(0, 0);
      ui.discoveryItems.textContent = "LOADING...";
      return;
    }
    const discoveryTracks = [...catalogState.applied.tracks]
      .sort((a, b) => b.dailyNumber - a.dailyNumber);
    const validTitles = new Set(discoveryTracks.map((track) => track.title));
    const found = [...state.discovered].filter((title) => validTitles.has(title)).length;
    ui.discoveryCount.textContent = formatDiscoveryCount(found, discoveryTracks.length);
    ui.discoveryItems.replaceChildren(...discoveryTracks.map((track) => {
      const item = document.createElement("div");
      item.className = "discovery-item";
      item.setAttribute("role", "listitem");
      const discovered = state.discovered.has(track.title);
      const title = discovered ? track.title : hiddenTitle;
      if (track.isNew && !discovered) {
        item.classList.add("discovery-item-new");
        const marker = document.createElement("span");
        marker.className = "discovery-new";
        marker.textContent = "NEW";
        marker.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.className = "discovery-track";
        label.textContent = title;
        item.append(marker, label, marker.cloneNode(true));
        item.setAttribute("aria-label", "NEW UNDISCOVERED TRACK");
      } else {
        item.textContent = title;
        if (!discovered) item.setAttribute("aria-hidden", "true");
      }
      return item;
    }));
  }

  function renderDiscovery() {
    renderDiscoveryItems();
    if (isDiscoveryVisible()) {
      const generation = overlayState.generation;
      setFrame("discovery-layout", () => {
        if (
          overlayState.kind === "discovery" &&
          overlayState.generation === generation &&
          isDiscoveryVisible()
        ) setDiscoveryHeight();
      });
    }
  }

  function renderSuggestions() {
    const query = ui.guess.value.trim().toLocaleLowerCase();
    const titles = catalogState.applied.tracks
      .filter(({ title }) =>
        query &&
        !state.used.has(title) &&
        title.toLocaleLowerCase().includes(query))
      .slice(0, 8)
      .map(({ title }) => title);

    state.activeSuggestion = titles.length ? 0 : -1;
    ui.suggest.replaceChildren(...titles.map((title, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.id = `corzaguessr-option-${index}`;
      button.dataset.title = title;
      button.textContent = title;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(index === 0));
      if (index === 0) button.className = "active";
      return button;
    }));

    const open = Boolean(titles.length);
    ui.suggest.style.display = open ? "block" : "none";
    ui.guess.setAttribute("aria-expanded", String(open));
    if (open) ui.guess.setAttribute("aria-activedescendant", "corzaguessr-option-0");
    else ui.guess.removeAttribute("aria-activedescendant");
  }

  function setActiveSuggestion(index) {
    const options = [...ui.suggest.querySelectorAll("[role=option]")];
    if (!options.length) return;
    state.activeSuggestion = (index + options.length) % options.length;
    options.forEach((option, optionIndex) => {
      const active = optionIndex === state.activeSuggestion;
      option.classList.toggle("active", active);
      option.setAttribute("aria-selected", String(active));
    });
    ui.guess.setAttribute("aria-activedescendant", options[state.activeSuggestion].id);
  }

  // Game rules --------------------------------------------------------------

  function selectTrack() {
    if (currentMode().daily) {
      return catalogState.applied.tracks.reduce((winner, track) => {
        const score = hashDaily(
          `corzaguessr-daily-v1:${dailyState.roundDate}:${track.dailyNumber}`,
        );
        return !winner || score > winner.score ? { track, score } : winner;
      }, null).track;
    }

    const availableTracks = catalogState.applied.tracks.filter(
      (track) => !catalogState.unavailable.has(track.dailyNumber),
    );
    if (!availableTracks.length) return null;
    const pool = availableTracks.length > 1
      ? availableTracks.filter(
        (track) => track.dailyNumber !== roundState.previousDailyNumber,
      )
      : availableTracks;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function startRound() {
    if (!canUsePlayback() || !catalogState.applied.tracks.length) return;
    const mode = currentMode();
    if (mode.daily && dailyNeedsCatalogRefresh()) {
      applyModeAvailability();
      reconcileApp();
      return;
    }
    if (mode.daily && isDailyInProgress(dailyState.roundDate)) {
      state.step = dailyState.progress.step;
    }
    gameClock.pause();
    const prepared = promotePreparedRound();
    if (!prepared) return;
    prepared.hasPlayed = false;
    roundState.current = prepared;
    roundState.phase = "starting";
    roundState.previousDailyNumber = prepared.track.dailyNumber;
    state.notice = null;
    if (mode.daily && dailyState.retryRound?.id === prepared.id) {
      dailyState.retryRound = null;
    }
    state.used.clear();
    state.rounds++;
    ui.skip.disabled = true;
    if (!mode.timed) {
      gameClock.resetClassic(snippetDurations[state.step] * 1000);
      setProgress(mode.initialText, mode.initialProgress);
    }
    renderPlaybackIntent(true);
    audioDeck.playActive();
    renderPrompt();
  }

  function togglePlay() {
    if (!canUsePlayback()) return;
    const mode = currentMode();
    if (mode.daily && dailyNeedsCatalogRefresh()) {
      applyModeAvailability();
      reconcileApp();
      return;
    }
    if (mode.daily && isDailyDone(dailyState.roundDate) && !currentRound()) {
      applyModeAvailability();
      return;
    }
    if (!currentRound()) {
      showGuess();
      startRound();
    } else if (audioDeck.isPlayRequested()) {
      pausePlayback();
      if (!mode.timed) rewindClassic();
    } else if (!mode.timed) {
      startClassic();
    } else {
      requestPlayback();
    }
    focusGuess();
  }

  function usePlaybackShortcut() {
    if (!canUsePlayback()) return;

    if (!currentRound()) {
      togglePlay();
      return;
    }

    if (currentMode().timed) {
      togglePlay();
      return;
    }

    startClassic();
  }

  function recordDiscovery() {
    const track = currentTrack();
    if (!track || state.discovered.has(track.title)) return;
    state.discovered.add(track.title);
    saveDiscoveries();
    renderDiscovery();
  }

  function renderAttempt(type, title) {
    if (type === "skip") {
      if (currentMode().timed) {
        addSlot("SKIPPED", "skip", true);
      } else {
        const last = state.step === snippetDurations.length - 1;
        const added = last
          ? 0
          : snippetDurations[state.step + 1] - snippetDurations[state.step];
        addSlot(
          last
            ? "FINAL GUESS SKIPPED"
            : `GUESS ${state.step + 1} SKIPPED, ${added} SECOND${added === 1 ? "" : "S"} ADDED`,
          "skip",
          true,
        );
      }
    } else {
      addSlot(title, type === "correct" ? "correct" : "wrong", true);
    }
    clearGuess();
  }

  function resolveTimedAttempt(type) {
    const mode = currentMode();
    if (type !== "skip") state.guesses++;
    if (type === "correct") state.correct++;
    let clock = gameClock.snapshot();
    if (mode.survival) {
      flashSurvivalChange(mode.timeChange[type] / 1000);
      clock = gameClock.adjustRemaining(mode.timeChange[type]);
    }
    announce(type === "correct" ? "CORRECT." : type === "wrong" ? "INCORRECT." : "SKIPPED.");
    if (roundState.phase === "result" || clock.expired || !clock.remainingMs) endGame();
    else startRound();
  }

  function resolveClassicAttempt(type) {
    if (type === "correct") {
      endGame(true);
      return;
    }

    if (state.step === snippetDurations.length - 1) {
      endGame(false);
      return;
    }

    state.step++;
    saveDailyStep();
    renderPrompt();
    announce(type === "wrong" ? "INCORRECT. TRY AGAIN." : "SKIPPED. MORE TIME ADDED.");
    if (audioDeck.isPlayRequested()) {
      gameClock.setClassicLimit(snippetDurations[state.step] * 1000);
    } else {
      if (type === "skip") startClassic();
      else togglePlay();
    }
  }

  function getClassicAverage(record = state.personalBests.classic) {
    return record.current ? record.snippetTotal / record.current : 0;
  }

  function getClassicBestAverage(record = state.personalBests.classic) {
    return record.best ? record.bestSnippetTotal / record.best : 0;
  }

  function formatSnippetAverage(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "--";
    const rounded = Math.round(seconds * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}S`;
  }

  function getAccuracy() {
    return state.guesses
      ? Math.round(state.correct * 100 / state.guesses)
      : 0;
  }

  function formatAccuracy(accuracy) {
    return Number.isSafeInteger(accuracy) ? `${accuracy}%` : "--";
  }

  function formatAttempts(attempts) {
    return attempts ? `ATTEMPTS: ${attempts}` : "ATTEMPTS: --";
  }

  function markNewPersonalBest() {
    state.newPersonalBest = true;
  }

  function isClassicPersonalBest(record) {
    return record.current > record.best ||
      (
        record.current === record.best &&
        record.current > 0 &&
        (!record.bestSnippetTotal || record.snippetTotal < record.bestSnippetTotal)
      );
  }

  function updateClassicRecord(won) {
    if (state.mode !== "classic") return;

    const record = state.personalBests.classic;
    if (won) {
      record.current++;
      record.snippetTotal += snippetDurations[state.step] || snippetDurations[0];
      state.classicResult = {
        won: true,
        streak: record.current,
        average: getClassicAverage(record),
      };
      if (isClassicPersonalBest(record)) {
        record.best = record.current;
        record.bestSnippetTotal = record.snippetTotal;
        markNewPersonalBest();
      }
      savePersonalBests();
      return;
    }

    state.classicResult = {
      won: false,
      streak: record.current,
      average: getClassicAverage(record),
    };
    if (record.current || record.snippetTotal) {
      record.current = 0;
      record.snippetTotal = 0;
      savePersonalBests();
    }
  }

  function updateDailyPersonalBest(won) {
    if (state.mode !== "daily" || !won) return;
    const attempts = state.step + 1;
    if (!state.personalBests.daily || attempts < state.personalBests.daily) {
      state.personalBests.daily = attempts;
      markNewPersonalBest();
      savePersonalBests();
    }
  }

  function attempt(type, title = "") {
    if (!currentRound() || isModalOpen()) return;
    if (currentMode().timed) {
      const clock = pausePlayback();
      if (clock.expired || roundState.phase === "result") return;
    }
    renderAttempt(type, title);
    if (type === "correct") recordDiscovery();
    if (currentMode().timed) resolveTimedAttempt(type);
    else resolveClassicAttempt(type);
  }

  function makeGuess(title = ui.guess.value.trim()) {
    if (
      !title ||
      !currentRound() ||
      (currentMode().timed && !currentRound().hasPlayed)
    ) return;
    state.used.add(title);
    attempt(title === currentTrack().title ? "correct" : "wrong", title);
  }

  function handleTrackEnded() {
    if (!currentRound() || !currentRound().hasPlayed || roundState.phase === "result") return;
    const clock = gameClock.pause();
    if (clock.expired || roundState.phase === "result") return;
    currentRound().hasPlayed = false;
    if (!currentMode().timed) renderPlaybackIntent(false);
    else attempt("skip");
  }

  function updateTimedPersonalBest() {
    const accuracy = getAccuracy();
    const score = state.mode === "survival"
      ? Math.floor(gameClock.snapshot().elapsedMs)
      : state.correct;
    const record = state.personalBests[state.mode];
    if (score <= record.score) return;

    state.personalBests[state.mode] = { score, accuracy };
    markNewPersonalBest();
    savePersonalBests();
  }

  function updatePersonalBest(won) {
    if (state.mode === "classic") {
      updateClassicRecord(won);
    } else if (state.mode === "daily") {
      updateDailyPersonalBest(won);
    } else {
      updateTimedPersonalBest();
    }
  }

  function createResultModule(lines) {
    const module = document.createElement("div");
    module.className = "result-module";
    module.replaceChildren(...lines.map((line, index) => {
      const item = document.createElement("span");
      item.className = index ? "result-value" : "result-label";
      if (!index && state.newPersonalBest && line === "NEW PERSONAL BEST:") {
        item.classList.add("blink");
      }
      item.textContent = line;
      return item;
    }));
    return module;
  }

  function setResultMeta(...modules) {
    ui.resultMeta.replaceChildren(
      ...modules.map((lines) => createResultModule(lines)),
    );
    ui.resultMeta.dataset.announcement = modules
      .map((lines) => lines.join(". "))
      .join(". ");
  }

  function getPersonalBestLabel() {
    return state.newPersonalBest ? "NEW PERSONAL BEST:" : "PERSONAL BEST:";
  }

  function formatClassicRun() {
    const result = state.classicResult || {
      won: Boolean(state.personalBests.classic.current),
      streak: state.personalBests.classic.current,
      average: getClassicAverage(),
    };
    const streakLabel = result.won ? "STREAK" : "STREAK ENDED";
    return `${streakLabel}: ${result.streak} · AVERAGE SNIPPET: ${formatSnippetAverage(result.average)}`;
  }

  function formatClassicPersonalBest() {
    const { best } = state.personalBests.classic;
    return `STREAK: ${best} · AVERAGE SNIPPET: ${formatSnippetAverage(getClassicBestAverage())}`;
  }

  function formatBlitzRun() {
    return `CORRECT GUESSES: ${state.correct} · ACCURACY: ${formatAccuracy(getAccuracy())}`;
  }

  function formatBlitzPersonalBest() {
    const { score, accuracy } = state.personalBests.blitz;
    return `CORRECT GUESSES: ${score} · ACCURACY: ${formatAccuracy(accuracy)}`;
  }

  function formatSurvivalRun() {
    const time = formatTime(gameClock.snapshot().elapsedMs / 1000);
    return `TIME SURVIVED: ${time} · ACCURACY: ${formatAccuracy(getAccuracy())}`;
  }

  function formatSurvivalPersonalBest() {
    const { score, accuracy } = state.personalBests.survival;
    return `TIME SURVIVED: ${formatTime(score / 1000)} · ACCURACY: ${formatAccuracy(accuracy)}`;
  }

  const resultFormatters = {
    daily: {
      run: () => formatAttempts(state.step + 1),
      personalBest: () => formatAttempts(state.personalBests.daily),
    },
    classic: {
      run: formatClassicRun,
      personalBest: formatClassicPersonalBest,
    },
    blitz: {
      run: formatBlitzRun,
      personalBest: formatBlitzPersonalBest,
    },
    survival: {
      run: formatSurvivalRun,
      personalBest: formatSurvivalPersonalBest,
    },
  };

  function getResultModules() {
    const formatter = resultFormatters[state.mode];
    const modules = [];
    if (!currentMode().timed) modules.push(["TRACK:", currentTrack().title]);
    modules.push(
      ["RUN:", formatter.run()],
      [getPersonalBestLabel(), formatter.personalBest()],
    );
    return modules;
  }

  function openSpotify() {
    const trackId = currentTrack()?.spotify;
    if (!trackId) return;
    window.open(
      `https://open.spotify.com/track/${trackId}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  function endGame(won) {
    if (!currentRound() || roundState.phase === "result") return;
    const mode = currentMode();
    gameClock.stop();
    audioDeck.pauseActive();
    renderPlaybackIntent(false);
    roundState.phase = "result";
    currentRound().hasPlayed = false;
    ui.play.disabled = true;
    ui.skip.disabled = true;
    ui.guess.disabled = true;
    completeDaily(won);
    updatePersonalBest(won);

    const mark = won ? "🎉" : "❌";
    ui.resultTitle.innerHTML = mode.timed
      ? '⏱️ <span class="end">TIME IS UP</span> ⏱️'
      : `${mark} <span class="end">${won ? "YOU GOT IT" : "YOU GOT IT ALL WRONG"}</span> ${mark}`;
    setResultMeta(...getResultModules());

    const hasSpotify = !mode.timed && Boolean(currentTrack().spotify);
    ui.spotify.hidden = !hasSpotify;

    openResult();
    announce(ui.resultMeta.dataset.announcement);
  }

  function openResult() {
    if (overlayState.phase !== "closed") return;
    clearTimer("result");
    clearFrame("guess-focus");
    const generation = beginOverlayTransition("result", "opening");
    ui.card.classList.remove("modal-closing");
    const card = ui.card.getBoundingClientRect();
    const board = ui.board.getBoundingClientRect();
    ui.card.style.setProperty("--modal-y", `${board.top - card.top + board.height / 2}px`);
    ui.card.classList.add("modal-open");
    ui.result.setAttribute("aria-hidden", "false");
    syncBackgroundInert();
    ui.next.focus({ preventScroll: true });
    setFrame("overlay-open", () => {
      if (!overlayTransitionMatches("result", "opening", generation)) return;
      ui.card.classList.add("modal-visible");
      overlayState.phase = "open";
    });
  }

  function closeResult() {
    if (!isResultOpen() || overlayState.phase === "closing") return;
    clearFrame("overlay-open");
    const generation = beginOverlayTransition("result", "closing");
    ui.card.classList.add("modal-closing");
    ui.card.classList.remove("modal-visible");
    reset({ keepResultOpen: true });
    setTimer("result", () => {
      if (!overlayTransitionMatches("result", "closing", generation)) return;
      overlayState.kind = null;
      overlayState.phase = "closed";
      ui.card.classList.remove("modal-open", "modal-visible", "modal-closing");
      syncBackgroundInert();
      reconcileApp();
      restoreOverlayFocus();
      ui.result.setAttribute("aria-hidden", "true");
    }, transitionDelay(durations.result));
  }

  function cancelProgressTransition() {
    clearTimer("progress");
    ui.fill.style.transition = "";
  }

  function finalizeSessionReset() {
    applyModeAvailability({ force: true });
    reconcileApp();
    if (isRoundReadyToStart()) focusPlay();
  }

  function resetSession({ keepResultOpen = false, finalize = true } = {}) {
    const mode = currentMode();
    gameClock.stop({ flush: false });
    audioDeck.releaseActive();
    if (!standbyMatchesSession()) audioDeck.discardStandby();
    roundState.current = null;
    roundState.phase = "idle";
    dailyState.retryRound = null;

    Object.assign(state, {
      step: 0,
      rounds: 0,
      guesses: 0,
      correct: 0,
      activeSuggestion: -1,
      newPersonalBest: false,
      classicResult: null,
      notice: null,
    });
    state.used.clear();
    clearFrame("announcement");
    clearFrame("guess-focus");
    ui.status.textContent = "";
    clearTimer("feedback");
    ui.feedback.classList.remove("survival-penalty", "survival-reward");
    ui.timeChange.classList.remove("survival-change");
    ui.timeChangeText.textContent = "";
    if (!keepResultOpen) {
      clearTimer("result");
      clearFrame("overlay-open");
      if (overlayState.kind === "result") {
        overlayState.generation++;
        overlayState.kind = null;
        overlayState.phase = "closed";
      }
      ui.card.classList.remove("modal-open", "modal-visible", "modal-closing");
      ui.result.setAttribute("aria-hidden", "true");
    }
    syncBackgroundInert();
    ui.skip.disabled = true;
    clearSlots();

    ui.endtime.textContent = mode.endTime;
    ui.skip.textContent = mode.skip;
    ui.snippet.style.width = `${100 / maxSnippetDuration}%`;
    setProgress(mode.initialText, mode.initialProgress);
    if (mode.timed) {
      gameClock.resetTimed(mode.survival ? "survival" : "blitz", mode.initialTime);
    } else {
      gameClock.resetClassic(snippetDurations[0] * 1000);
    }
    renderPlaybackIntent(false);
    if (finalize) finalizeSessionReset();
  }

  function renderSavedDailyProgress() {
    const seconds = snippetDurations[dailyState.progress.step] || snippetDurations[0];
    ui.endtime.textContent = formatTime(seconds);
    ui.snippet.style.width = `${seconds / maxSnippetDuration * 100}%`;
    setProgress(
      formatTime(seconds),
      seconds / maxSnippetDuration + 0.0025,
    );
  }

  function getAvailabilitySignature() {
    if (state.appPhase !== "ready") {
      return `app-${state.appPhase}-${state.mode || "no-mode"}`;
    }
    const mode = currentMode();
    if (!mode) return "no-mode";
    if (mode.daily && state.notice === "daily-audio-error") return "daily-audio-error";
    if (mode.daily && dailyNeedsCatalogRefresh()) {
      return `daily-catalog-${getDailyCatalogStatusText()}`;
    }
    if (mode.daily && isDailyDone(dailyState.roundDate)) {
      return `daily-done-${dailyState.roundDate}-${dailyState.progress.won}-${dailyState.progress.step}`;
    }
    if (mode.daily && isDailyInProgress(dailyState.roundDate)) {
      return `daily-progress-${dailyState.roundDate}-${dailyState.progress.step}`;
    }
    return `mode-${state.mode}`;
  }

  function applyModeAvailability({ force = false } = {}) {
    const signature = getAvailabilitySignature();
    if (!force && signature === availabilityState.signature) return;
    availabilityState.signature = signature;
    if (state.appPhase !== "ready") {
      ui.play.disabled = true;
      ui.skip.disabled = true;
      ui.guess.disabled = true;
      return;
    }
    const mode = currentMode();
    if (!mode) return;
    if (mode.daily && state.notice === "daily-audio-error") {
      ui.play.disabled = false;
      ui.skip.disabled = true;
      ui.guess.disabled = true;
      showRules(dailyAudioErrorText);
      return;
    }
    if (mode.daily && dailyNeedsCatalogRefresh()) {
      ui.play.disabled = true;
      ui.skip.disabled = true;
      ui.guess.disabled = true;
      showRules(getDailyCatalogStatusText());
      return;
    }
    if (mode.daily && isDailyDone(dailyState.roundDate)) {
      ui.play.disabled = true;
      ui.skip.disabled = true;
      ui.guess.disabled = true;
      showRules(getDailyDoneText());
      renderSavedDailyProgress();
      return;
    }
    if (mode.daily && isDailyInProgress(dailyState.roundDate)) {
      ui.play.disabled = false;
      ui.skip.disabled = true;
      ui.guess.disabled = true;
      showRules(getDailyInProgressText());
      renderSavedDailyProgress();
      return;
    }
    ui.play.disabled = false;
    ui.skip.disabled = true;
    ui.guess.disabled = true;
    showRules(mode.description);
  }

  function reset(options) {
    clearTimer("result");
    cancelProgressTransition();
    resetSession(options);
  }

  function renderModeSelection() {
    const mode = currentMode();
    root.classList.toggle("timed", mode.timed);
    Object.entries(modeButtons).forEach(([name, button]) => {
      const selected = name === state.mode;
      button.disabled = selected;
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function setMode(modeName) {
    if (!modes[modeName] || (!isAwaitingMode() && state.mode === modeName)) return;
    state.mode = modeName;
    renderModeSelection();
    const message = getModeRulesText(modeName);
    showRules(message);
    announce(message);

    if (isAwaitingMode()) {
      if (catalogState.applied.tracks.length) activateMode();
      return;
    }

    animateModeChange();
  }

  // Initial mode selection --------------------------------------------------

  function animateModeChange() {
    const mode = currentMode();
    state.appPhase = "transitioning";
    invalidateAudioSession();
    state.notice = null;
    cancelProgressTransition();
    ui.fill.style.transition = "transform 250ms ease-out";
    setProgress(ui.now.textContent, mode.initialProgress);
    applyModeAvailability({ force: true });
    setTimer("mode-transition", () => {
      resetSession({ finalize: false });
      state.appPhase = "ready";
      finalizeSessionReset();
      setTimer("progress", () => {
        ui.fill.style.transition = "";
      }, transitionDelay(durations.progress));
    }, transitionDelay(durations.modeChange));
  }

  function activateMode() {
    if (
      !isAwaitingMode() ||
      isDiscoveryOpen() ||
      !state.mode ||
      !catalogState.applied.tracks.length
    ) return;
    root.classList.remove("awaiting-mode");
    ui.modePrompt.setAttribute("aria-hidden", "true");
    syncBackgroundInert();
    animateModeChange();
  }

  // Discovery modal ---------------------------------------------------------

  function setDiscoveryHeight() {
    if (!isDiscoveryVisible()) return;
    ui.discoveryShell.style.height = `${ui.discoveryPanel.offsetHeight}px`;
  }

  function lockPageScroll() {
    if (overlayState.pageScrollStyles) return;
    const html = document.documentElement;
    const body = document.body;
    overlayState.pageScrollStyles = {
      htmlOverflow: html.style.overflow,
      htmlScrollbarGutter: html.style.scrollbarGutter,
      bodyOverflow: body.style.overflow,
    };
    html.style.scrollbarGutter = "stable";
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
  }

  function unlockPageScroll() {
    if (!overlayState.pageScrollStyles) return;
    const html = document.documentElement;
    const body = document.body;
    html.style.overflow = overlayState.pageScrollStyles.htmlOverflow;
    html.style.scrollbarGutter = overlayState.pageScrollStyles.htmlScrollbarGutter;
    body.style.overflow = overlayState.pageScrollStyles.bodyOverflow;
    overlayState.pageScrollStyles = null;
  }

  function openDiscovery() {
    if (overlayState.phase !== "closed" || roundState.phase === "result") return;
    clearTimer("discovery");
    clearFrame("guess-focus");
    clearFrame("discovery-layout");
    gameClock.pause();
    renderDiscovery();
    const generation = beginOverlayTransition("discovery", "opening");
    overlayState.returnFocus = document.activeElement;
    overlayState.discoverySuspension = audioDeck.suspendActive();
    if (overlayState.discoverySuspension) {
      renderPlaybackIntent(false);
    }
    lockPageScroll();
    root.classList.add("discovery-open");
    syncBackgroundInert();
    ui.discoveryButton.setAttribute("aria-expanded", "true");
    ui.discoveryModal.setAttribute("aria-hidden", "false");
    ui.discoveryShell.style.height = "0px";
    setFrame("overlay-open", () => {
      if (!overlayTransitionMatches("discovery", "opening", generation)) return;
      root.classList.add("discovery-visible");
      setDiscoveryHeight();
      overlayState.phase = "open";
      ui.discoveryModal.focus({ preventScroll: true });
    });
  }

  function closeDiscovery() {
    if (!isDiscoveryOpen() || overlayState.phase === "closing") return;
    clearTimer("discovery");
    clearFrame("overlay-open");
    clearFrame("discovery-layout");
    const generation = beginOverlayTransition("discovery", "closing");
    root.classList.remove("discovery-visible");
    ui.discoveryButton.setAttribute("aria-expanded", "false");
    ui.discoveryShell.style.height = `${ui.discoveryShell.offsetHeight}px`;
    void ui.discoveryShell.offsetHeight;
    ui.discoveryShell.style.height = "0px";
    setTimer("discovery", () => {
      if (!overlayTransitionMatches("discovery", "closing", generation)) return;
      overlayState.kind = null;
      overlayState.phase = "closed";
      root.classList.remove("discovery-open", "discovery-visible");
      ui.discoveryShell.style.height = "";
      syncBackgroundInert();
      unlockPageScroll();
      const returnFocus = overlayState.returnFocus;
      overlayState.returnFocus = null;
      const suspension = overlayState.discoverySuspension;
      overlayState.discoverySuspension = null;
      const restored = audioDeck.restoreActive(suspension);
      if (restored.status === "ended") {
        handleTrackEnded();
      } else if (restored.status === "error") {
        handleAudioError(restored.payload);
      } else if (restored.status === "resumed") {
        renderPlaybackIntent(true);
      }
      if (isAwaitingMode() && state.mode && catalogState.applied.tracks.length) activateMode();
      reconcileApp();
      restoreOverlayFocus(returnFocus);
      ui.discoveryModal.setAttribute("aria-hidden", "true");
    }, transitionDelay(durations.discovery));
  }

  function toggleDiscovery() {
    if (overlayState.phase === "closed") openDiscovery();
    else if (isDiscoveryOpen()) closeDiscovery();
  }

  function resetDiscovery() {
    if (!window.confirm(
      "RESET DISCOVERY? THIS HIDES ALL DISCOVERED TRACKS.",
    )) return;
    try {
      localStorage.removeItem(discoveryStorageKey);
    } catch {
      announce("DISCOVERY COULD NOT BE RESET IN THIS BROWSER.");
      return;
    }
    state.discovered = loadDiscoveries();
    renderDiscovery();
    announce("DISCOVERY RESET.");
  }

  function trapFocus(event, container) {
    if (event.key !== "Tab") return;
    const focusable = [...container.querySelectorAll("button:not([disabled]), input:not([disabled])")]
      .filter((element) => !element.hidden && element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!container.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function bindRulesPreview(element, preview) {
    element.addEventListener("pointerenter", preview);
    element.addEventListener("pointerleave", resetRulesPreview);
    element.addEventListener("focus", preview);
    element.addEventListener("blur", resetRulesPreview);
  }

  // Events and initialization ----------------------------------------------

  ui.guess.addEventListener("input", renderSuggestions);
  ui.guess.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      clearGuess();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!ui.suggest.children.length) return;
      event.preventDefault();
      setActiveSuggestion(state.activeSuggestion + (event.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!currentRound()) {
      usePlaybackShortcut();
      return;
    }
    const active = ui.suggest.querySelector(".active");
    if (active) makeGuess(active.dataset.title);
    else if (!ui.guess.value.trim()) usePlaybackShortcut();
  });

  ui.suggest.addEventListener("pointermove", (event) => {
    const option = event.target.closest("[role=option]");
    if (!option) return;
    const options = [...ui.suggest.children];
    setActiveSuggestion(options.indexOf(option));
  });
  ui.suggest.addEventListener("click", (event) => {
    const option = event.target.closest("[role=option]");
    if (option) makeGuess(option.dataset.title);
  });
  ui.play.addEventListener("click", togglePlay);
  ui.skip.addEventListener("click", () => attempt("skip"));
  ui.next.addEventListener("click", closeResult);
  ui.spotify.addEventListener("click", openSpotify);
  Object.entries(modeButtons).forEach(([name, button]) => {
    bindRulesPreview(button, () => previewMode(name));
    button.addEventListener("click", () => setMode(name));
  });
  bindRulesPreview(ui.discoveryButton, previewDiscovery);
  ui.discoveryButton.addEventListener("click", toggleDiscovery);
  ui.discoveryClose.addEventListener("click", closeDiscovery);
  ui.discoveryReset.addEventListener("click", resetDiscovery);
  ui.discoveryModal.addEventListener("click", (event) => {
    if (!event.target.closest(".discovery-panel")) closeDiscovery();
  });

  new ResizeObserver(() => {
    if (isDiscoveryVisible()) setDiscoveryHeight();
  }).observe(ui.discoveryPanel);

  root.addEventListener("keydown", (event) => {
    if (isDiscoveryOpen()) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDiscovery();
      } else {
        trapFocus(event, ui.discoveryPanel);
      }
      return;
    }
    if (isResultOpen()) {
      trapFocus(event, ui.result);
      if (event.key === "Escape") {
        event.preventDefault();
        closeResult();
      } else if (event.key === "Enter" && document.activeElement !== ui.spotify) {
        event.preventDefault();
        closeResult();
      }
      return;
    }
    if (
      event.key === "Enter" &&
      !isAwaitingMode() &&
      !event.target.closest?.(interactiveSelector)
    ) {
      event.preventDefault();
      usePlaybackShortcut();
    }
  }, true);

  root.addEventListener("pointerdown", (event) => {
    if (
      isRoundReadyToStart() &&
      !event.target.closest(interactiveSelector)
    ) {
      event.preventDefault();
      focusPlay();
      return;
    }
    if (
      ui.guess.disabled ||
      isModalOpen() ||
      event.target.closest(interactiveSelector)
    ) return;
    focusGuess();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && audioDeck.isPlayRequested()) pausePlayback();
  });
  setInterval(reconcileApp, 1000);

  function validateTracks(value) {
    if (!Array.isArray(value)) throw new Error("Track catalog is not an array.");
    const titles = new Set();
    const dailyNumbers = new Set();
    const valid = [];
    for (const item of value) {
      const title = typeof item?.title === "string" ? item.title.trim() : "";
      const duration = Number(item?.duration);
      const spotify = typeof item?.spotify === "string" ? item.spotify.trim() : "";
      const dailyNumber = Number(item?.dailyNumber);
      const isNew = item?.isNew === true;
      if (
        !title ||
        titles.has(title) ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        !Number.isSafeInteger(dailyNumber) ||
        dailyNumber <= 0 ||
        dailyNumbers.has(dailyNumber) ||
        (spotify && !/^[A-Za-z0-9]{22}$/.test(spotify))
      ) continue;
      titles.add(title);
      dailyNumbers.add(dailyNumber);
      valid.push({ title, duration, spotify, dailyNumber, isNew });
    }
    if (!valid.length) throw new Error("Track catalog has no valid tracks.");
    return valid;
  }

  async function fetchTrackCatalog(date) {
    const url = new URL(tracksUrl);
    if (date) url.searchParams.set("date", date);
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Track catalog returned ${response.status}.`);
    return validateTracks(await response.json());
  }

  function invalidateUnstartedOldDaily(today) {
    if (state.mode !== "daily" || catalogState.applied.date === today) return false;
    if (isDailyRoundProtected()) return false;
    const current = currentRound();
    const standby = audioDeck.getStandby();
    const retry = dailyState.retryRound;
    if (
      current?.modeName === "daily" ||
      standby?.round.modeName === "daily" ||
      (retry?.modeName === "daily" && retry.roundDate !== today)
    ) {
      invalidateAudioSession();
      dailyState.retryRound = null;
      state.notice = null;
      ui.skip.disabled = true;
      clearSlots(false);
      return true;
    }
    return false;
  }

  function applyStagedCatalog(today) {
    const refresh = catalogState.refresh;
    if (refresh.kind !== "staged") return false;
    if (refresh.date !== today) {
      catalogState.refresh = { kind: "idle" };
      return false;
    }
    if (isDailyRoundProtected()) return false;

    audioDeck.discardStandby();
    catalogState.applied = {
      date: refresh.date,
      version: catalogState.applied.version + 1,
      tracks: refresh.tracks,
    };
    catalogState.refresh = { kind: "idle" };
    catalogState.unavailable.clear();
    dailyState.roundDate = refresh.date;
    dailyState.retryRound = null;
    state.notice = null;
    if (state.mode === "daily" && !currentRound()) {
      state.step = isDailyInProgress(refresh.date) ? dailyState.progress.step : 0;
      gameClock.resetClassic(snippetDurations[state.step] * 1000);
    }
    renderDiscovery();
    return true;
  }

  function ensureCatalogRequest(date) {
    if (!date || !catalogState.applied.date || date === catalogState.applied.date) return false;
    const refresh = catalogState.refresh;
    if (
      (refresh.kind === "loading" || refresh.kind === "staged") &&
      refresh.date === date
    ) return false;
    if (
      refresh.kind === "retry" &&
      refresh.date === date &&
      Date.now() < refresh.retryAt
    ) return false;

    const id = ++catalogState.nextRequestId;
    catalogState.refresh = { kind: "loading", date, id };
    void fetchTrackCatalog(date).then((tracks) => {
      if (
        catalogState.refresh.kind !== "loading" ||
        catalogState.refresh.id !== id ||
        date !== getBudapestDate()
      ) return;
      catalogState.refresh = { kind: "staged", date, tracks };
      reconcileApp();
    }).catch((error) => {
      if (
        catalogState.refresh.kind !== "loading" ||
        catalogState.refresh.id !== id
      ) return;
      console.error("Corzaguessr could not refresh its track catalog.", error);
      catalogState.refresh = {
        kind: "retry",
        date,
        retryAt: Date.now() + 5000,
        error,
      };
      if (state.mode === "daily" && dailyNeedsCatalogRefresh(date)) {
        if (!isModalOpen()) applyModeAvailability();
        announce(dailyCatalogErrorText);
      }
    });
    return true;
  }

  function reconcileApp() {
    if (state.appPhase !== "ready" || !catalogState.applied.date) return;
    const today = getBudapestDate();
    invalidateUnstartedOldDaily(today);
    ensureCatalogRequest(today);
    applyStagedCatalog(today);
    if (
      state.mode &&
      state.notice !== "daily-audio-error" &&
      !isDailyRoundProtected() &&
      (!currentRound() || currentRound().hasPlayed)
    ) ensureStandby();
    if (state.mode && !isModalOpen() && !currentRound()) {
      applyModeAvailability();
    }
  }

  async function loadTracks() {
    try {
      const date = getBudapestDate();
      const tracks = await fetchTrackCatalog();
      catalogState.applied = { date, version: 1, tracks };
      dailyState.roundDate = date;
      catalogState.refresh = { kind: "idle" };
      state.appPhase = "ready";
      renderDiscovery();
      if (state.mode) activateMode();
    } catch (error) {
      console.error("Corzaguessr could not load its track catalog.", error);
      state.appPhase = "error";
      ui.play.disabled = true;
      ui.skip.disabled = true;
      ui.guess.disabled = true;
      Object.values(modeButtons).forEach((button) => {
        button.disabled = true;
      });
      ui.modePrompt.textContent = "COULD NOT LOAD THE TRACKLIST, PLEASE REFRESH!";
      root.classList.add("mode-error");
      announce("COULD NOT LOAD THE TRACKLIST. PLEASE REFRESH.");
    }
  }

  loadTracks();
})();
