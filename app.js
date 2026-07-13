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
  const durationProperties = {
    feedback: "--duration-feedback",
    slot: "--duration-slot",
    result: "--duration-result",
    discovery: "--duration-discovery",
    progress: "--duration-progress",
  };
  const rootStyles = getComputedStyle(root);
  const durations = Object.fromEntries(
    Object.entries(durationProperties).map(([name, property]) => {
      const raw = rootStyles.getPropertyValue(property).trim();
      const milliseconds = raw.endsWith("ms")
        ? Number.parseFloat(raw)
        : raw.endsWith("s")
          ? Number.parseFloat(raw) * 1000
          : Number.NaN;
      return [name, Number.isFinite(milliseconds) ? milliseconds : 0];
    }),
  );
  const discoveryStorageKey = "corzaguessrDiscovered";
  const personalBestStorageKey = "corzaguessrPersonalBests";
  const dailyStorageKey = "corzaguessrDaily";
  const dailyTimeZone = "Europe/Budapest";
  const modePromptText = "SELECT A MODE TO BEGIN";
  const dailyAudioErrorText = "COULD NOT LOAD TODAY'S TRACK, PRESS PLAY TO RETRY!";
  const trackAudioErrorText = "COULD NOT PLAY TRACK, PRESS PLAY TO RETRY!";
  const dailyCatalogLoadingText = "LOADING TODAY'S TRACK...";
  const dailyCatalogErrorText = "COULD NOT REFRESH TODAY'S TRACK, RETRYING...";
  const discoveryDescription =
    "REVEAL TRACKS YOU'VE GUESSED CORRECTLY AND TRACK YOUR DISCOVERY PROGRESS";
  const dailyDoneText = "ALREADY DONE FOR TODAY, COME BACK TOMORROW";
  const hiddenTitle = "????????????????????";
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
    appStatus: "loading",
    mode: null,
    previewText: null,
    inputModality: finePointer.matches ? "pointer-fine" : "pointer-coarse",
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
    suggestions: [],
    history: [],
    nextHistoryId: 0,
    catalogError: null,
  };
  const session = {
    status: "idle",
    current: null,
    pending: null,
    previousDailyNumber: null,
    nextId: 0,
    promptEntryId: null,
    retryEntryId: null,
    playbackRequested: false,
    recovery: {
      automaticRetriesRemaining: 1,
      prefetchBlocked: false,
      reuseCommittedRound: false,
    },
  };
  const dailyState = {
    progress: loadDaily(),
    roundDate: getBudapestDate(),
    retryRound: null,
  };
  const catalogState = {
    applied: {
      date: null,
      generation: 0,
      tracks: [],
    },
    nextRequestId: 0,
    request: { kind: "idle" },
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
    rulesText: null,
  };
  const timers = new Map();
  const frames = new Map();

  renderUi({ force: true });

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
    return session.current;
  }

  function pendingRound() {
    return session.pending;
  }

  function ownedRound() {
    return currentRound() || pendingRound();
  }

  function currentTrack() {
    return currentRound()?.track || null;
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

  function shouldRestoreGuessFocus() {
    return state.inputModality === "keyboard" || state.inputModality === "pointer-fine";
  }

  function focusGuess() {
    if (!shouldRestoreGuessFocus() || !getUiModel().guessEnabled || isModalOpen()) return;
    setFrame("guess-focus", () => {
      if (getUiModel().guessEnabled && !isModalOpen()) ui.guess.focus();
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
    return state.appStatus === "awaiting-mode";
  }

  function isModalOpen() {
    return overlayState.phase !== "closed";
  }

  function canPreviewRules() {
    return !isModalOpen() && (
      isAwaitingMode() ||
      (state.mode && session.status !== "active" && session.status !== "paused")
    );
  }

  function canUsePlayback() {
    return getUiModel().playEnabled;
  }

  function isRoundReadyToStart() {
    return canUsePlayback() && !ownedRound() && (
      session.status === "idle" || session.status === "audio-retry"
    );
  }

  function transitionDelay(milliseconds) {
    return reducedMotion.matches ? 0 : milliseconds;
  }

  function syncBackgroundInert() {
    const resultOpen = isResultOpen();
    const discoveryOpen = isDiscoveryOpen();
    const overlayOpen = resultOpen || discoveryOpen;
    ui.headerAction.inert = overlayOpen;
    ui.modes.inert = overlayOpen;
    ui.board.inert = overlayOpen || isAwaitingMode();
    ui.slots.inert = overlayOpen || isAwaitingMode();
  }

  function getPersistentRulesText() {
    if (state.appStatus === "loading") {
      return state.catalogError ? dailyCatalogErrorText : "LOADING TRACKLIST...";
    }
    if (state.appStatus === "error") {
      return "COULD NOT LOAD THE TRACKLIST, RETRYING...";
    }
    if (!state.mode) return modePromptText;
    if (session.status === "preparing") return "LOADING TRACK...";
    return getModeRulesText(state.mode);
  }

  function getUiModel() {
    const mode = currentMode();
    const overlayOpen = isModalOpen();
    const appReady = state.appStatus === "ready";
    const inputVisible = Boolean(
      currentRound() && (session.status === "active" || session.status === "paused"),
    );
    const dailyBlocked = Boolean(
      mode?.daily && (
        dailyNeedsCatalogRefresh() ||
        (isDailyDone(dailyState.roundDate) && !currentRound())
      ),
    );
    const playStatus = ["idle", "active", "paused", "audio-retry"].includes(session.status) ||
      (session.status === "preparing" && Boolean(pendingRound()) && !session.playbackRequested);
    const playEnabled = Boolean(
      appReady &&
      mode &&
      !overlayOpen &&
      !dailyBlocked &&
      playStatus &&
      !isAwaitingMode(),
    );
    const roundControlsAvailable = Boolean(
      appReady &&
      currentRound() &&
      !overlayOpen &&
      (session.status === "active" || session.status === "paused"),
    );
    const rulesText = state.previewText || getPersistentRulesText();
    const icon = session.playbackRequested
      ? mode?.timed ? "pause" : "stop"
      : "play";
    return {
      appReady,
      awaitingMode: isAwaitingMode(),
      mode,
      inputVisible,
      rulesText,
      icon,
      playEnabled,
      skipEnabled: roundControlsAvailable,
      guessEnabled: roundControlsAvailable,
      modesEnabled: state.appStatus !== "error",
    };
  }

  function renderUi({ force = false } = {}) {
    const view = getUiModel();
    const signature = JSON.stringify({
      app: state.appStatus,
      session: session.status,
      mode: state.mode,
      notice: state.notice,
      preview: state.previewText,
      overlay: `${overlayState.kind || "none"}:${overlayState.phase}`,
      dailyDate: dailyState.roundDate,
      dailyProgress: dailyState.progress,
      current: currentRound()?.id || null,
      playback: session.playbackRequested,
    });
    if (!force && availabilityState.signature === signature) return;
    availabilityState.signature = signature;

    root.dataset.appStatus = state.appStatus;
    root.dataset.sessionStatus = session.status;
    ["loading", "awaiting-mode", "ready", "error"].forEach((status) => {
      root.classList.toggle(`app-${status}`, state.appStatus === status);
    });
    ["idle", "preparing", "active", "paused", "audio-retry", "result"].forEach((status) => {
      root.classList.toggle(`session-${status}`, session.status === status);
    });
    root.classList.toggle("awaiting-mode", view.awaitingMode);
    root.classList.toggle("rules-visible", !view.inputVisible);
    root.classList.toggle("timed", Boolean(view.mode?.timed));
    root.classList.toggle("mode-error", state.appStatus === "error");
    ui.modePrompt.setAttribute("aria-hidden", String(!view.awaitingMode));

    ui.play.disabled = !view.playEnabled;
    ui.skip.disabled = !view.skipEnabled;
    ui.guess.disabled = !view.guessEnabled;
    Object.entries(modeButtons).forEach(([name, button]) => {
      const selected = name === state.mode;
      button.disabled = !view.modesEnabled || selected;
      button.setAttribute("aria-pressed", String(selected));
    });

    ui.icon.setAttribute("d", icons[view.icon]);
    ui.play.setAttribute(
      "aria-label",
      view.icon === "play" ? "PLAY" : view.icon === "pause" ? "PAUSE" : "STOP",
    );

    if (force || availabilityState.rulesText !== view.rulesText) {
      availabilityState.rulesText = view.rulesText;
      ui.modePrompt.textContent = view.rulesText;
      ui.rulesetText.textContent = view.rulesText;
      ui.rulesetCopy.textContent = view.rulesText;
      ui.ruleset.classList.remove("scroll");
      if (!reducedMotion.matches) {
        void ui.ruleset.offsetWidth;
        ui.ruleset.classList.add("scroll");
      }
    }
    if (view.inputVisible) ui.ruleset.classList.remove("scroll");
    syncBackgroundInert();
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
        ? saved.filter(
          (dailyNumber) => Number.isSafeInteger(dailyNumber) && dailyNumber > 0,
        )
        : [],
    );
  }

  function saveDiscoveries() {
    return writeStorage(
      discoveryStorageKey,
      [...state.discovered].sort((a, b) => a - b),
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

  function normalizeDailyProgress(saved) {
    const started = saved?.started === true;
    const completed = started && saved?.completed === true;
    const step = Number.isSafeInteger(saved?.step) &&
      saved.step >= 0 &&
      saved.step < snippetDurations.length
      ? saved.step
      : 0;
    return {
      date: /^\d{4}-\d{2}-\d{2}$/.test(saved?.date) ? saved.date : "",
      dailyNumber: Number.isSafeInteger(saved?.dailyNumber) && saved.dailyNumber > 0
        ? saved.dailyNumber
        : null,
      started,
      completed,
      won: completed && saved?.won === true,
      step,
    };
  }

  function loadDaily() {
    const saved = readStorage(dailyStorageKey, null);
    if (!saved || typeof saved !== "object") {
      return normalizeDailyProgress(null);
    }
    const normalized = normalizeDailyProgress(saved);
    return !normalized.started || (normalized.date && normalized.dailyNumber)
      ? normalized
      : normalizeDailyProgress(null);
  }

  function saveDaily() {
    return writeStorage(
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
      dailyNumber: currentTrack()?.dailyNumber || null,
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
      dailyNumber: currentTrack()?.dailyNumber || dailyState.progress.dailyNumber || null,
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
    const round = ownedRound() || dailyState.retryRound;
    if (round?.modeName !== "daily") return false;
    return session.status === "result" || isDailyInProgress(round.roundDate);
  }

  function dailyNeedsCatalogRefresh(date = getBudapestDate()) {
    return (
      state.mode === "daily" &&
      date !== catalogState.applied.date &&
      !isDailyRoundProtected()
    );
  }

  function getDailyCatalogStatusText() {
    return catalogState.request.kind === "retry" &&
      catalogState.request.date === getBudapestDate()
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
      const releasedElement = slot.element;
      releasedElement.pause();
      releasedElement.removeAttribute("src");
      releasedElement.load();
      const freshElement = releasedElement.cloneNode(false);
      releasedElement.replaceWith(freshElement);
      slot.element = freshElement;
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
        const error = slot.element.error;
        if (current() && error) emitFailure(slot, error);
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
      if (!standby) return { status: "unavailable" };
      const candidate = standby;
      const error = candidate.element.error;
      if (candidate.failed || error) {
        const payload = {
          ...slotSnapshot(candidate),
          role: "standby",
          error: error || new Error("Prepared media failed before promotion."),
        };
        candidate.failed = true;
        standby = null;
        releaseSlot(candidate);
        return { status: "audio-failed", payload };
      }
      const previous = active;
      active = candidate;
      standby = null;
      active.role = "active";
      transportPhase = "paused";
      if (previous && previous !== active) releaseSlot(previous);
      return { status: "ready", round: active.round };
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
      id: ++session.nextId,
      modeName: state.mode,
      catalogGeneration: catalogState.applied.generation,
      roundDate: mode.daily ? dailyState.roundDate : null,
      hasPlayed: false,
      track: {
        ...selected,
        at: mode.daily
          ? hashDaily(
            `corzaguessr-daily-clip:${dailyState.roundDate}:${selected.dailyNumber}`,
          ) % (available + 1)
          : Math.floor(Math.random() * (available + 1)),
      },
    };
  }

  function standbyMatchesSession(standby = audioDeck.getStandby()) {
    return Boolean(
      standby &&
      standby.round.modeName === state.mode &&
      standby.round.catalogGeneration === catalogState.applied.generation &&
      (!currentMode().daily || standby.round.roundDate === dailyState.roundDate)
    );
  }

  function createRoundPreparationOwner() {
    function reset() {
      catalogState.unavailable.clear();
      session.recovery.automaticRetriesRemaining = 1;
      session.recovery.prefetchBlocked = false;
      session.recovery.reuseCommittedRound = false;
    }

    function quarantine(round) {
      if (!round) return;
      if (round.modeName === "daily") dailyState.retryRound = round;
      else catalogState.unavailable.add(round.track.dailyNumber);
    }

    function prefetch({ manualRetry = false } = {}) {
      if (!state.mode || !catalogState.applied.tracks.length) {
        return { status: "unavailable" };
      }
      if (session.recovery.prefetchBlocked && !manualRetry) {
        return { status: "audio-failed" };
      }
      if (manualRetry) session.recovery.prefetchBlocked = false;
      const mode = currentMode();
      if (mode.daily && dailyNeedsCatalogRefresh()) {
        return { status: "catalog-pending" };
      }
      if (mode.daily && (ownedRound() || isDailyDone(dailyState.roundDate))) {
        return { status: "unavailable" };
      }
      if (standbyMatchesSession()) {
        return { status: "ready", prepared: audioDeck.getStandby() };
      }
      audioDeck.discardStandby();
      const isDailyRetry = Boolean(mode.daily && dailyState.retryRound);
      const candidate = isDailyRetry
        ? dailyState.retryRound
        : createRoundCandidate(selectTrack());
      if (!candidate) return { status: "unavailable" };
      const prepared = audioDeck.assignStandby(candidate);
      return prepared
        ? { status: isDailyRetry ? "daily-retry" : "ready", prepared }
        : { status: "audio-failed", round: candidate };
    }

    function prepare({ manualRetry = false } = {}) {
      const prefetched = prefetch({ manualRetry });
      if (prefetched.status !== "ready" && prefetched.status !== "daily-retry") {
        return prefetched;
      }
      const promotion = audioDeck.promoteStandby();
      if (promotion.status === "ready") {
        return { status: prefetched.status, round: promotion.round };
      }
      const round = promotion.payload?.round || prefetched.prepared?.round || null;
      quarantine(round);
      session.recovery.prefetchBlocked = true;
      return {
        status: promotion.status === "audio-failed" ? "audio-failed" : "unavailable",
        round,
        error: promotion.payload?.error || null,
      };
    }

    return { prepare, prefetch, quarantine, reset };
  }

  const roundPreparation = createRoundPreparationOwner();

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
    if (session.status === "result") return;
    if (clock.kind === "classic") {
      audioDeck.pauseActive();
      session.status = "paused";
      renderPlaybackIntent(false);
      return;
    }
    endGame();
  }

  function renderPlaybackIntent(playing) {
    session.playbackRequested = Boolean(playing);
    renderUi();
  }

  function pausePlayback({ pauseAudio = true } = {}) {
    const clock = gameClock.pause();
    if (pauseAudio) audioDeck.pauseActive();
    if (currentRound() && session.status !== "result") session.status = "paused";
    renderPlaybackIntent(false);
    return clock;
  }

  function requestPlayback({ rewind = false } = {}) {
    if (!currentRound() || audioDeck.getActive()?.round.id !== currentRound().id) return false;
    if (rewind) {
      currentRound().hasPlayed = false;
      session.status = "paused";
    }
    renderPlaybackIntent(true);
    return audioDeck.playActive({ rewind });
  }

  function rewindClassic() {
    cancelProgressTransition();
    ui.fill.style.transition = "transform var(--duration-slot) ease-out";
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
    session.current = null;
    session.pending = null;
    session.status = "idle";
    session.promptEntryId = null;
    session.retryEntryId = null;
    session.playbackRequested = false;
    session.recovery.prefetchBlocked = false;
    overlayState.discoverySuspension = null;
    renderUi();
  }

  function handleDailyTrackError(round = ownedRound()) {
    if (!round) return;
    session.recovery.reuseCommittedRound = Boolean(
      currentRound()?.id === round.id && round.hasPlayed,
    );
    dailyState.retryRound = round;
    gameClock.pause();
    audioDeck.releaseActive();
    audioDeck.discardStandby();
    session.current = null;
    session.pending = null;
    session.status = "audio-retry";
    session.playbackRequested = false;
    session.recovery.prefetchBlocked = true;
    state.notice = "daily-audio-error";
    replacePromptWithTechnicalError(dailyAudioErrorText);
    renderUi({ force: true });
    announce(dailyAudioErrorText);
  }

  function showTrackRetry() {
    gameClock.pause();
    audioDeck.releaseActive();
    session.current = null;
    session.pending = null;
    session.status = "audio-retry";
    session.playbackRequested = false;
    session.recovery.prefetchBlocked = true;
    state.notice = "track-audio-error";
    replacePromptWithTechnicalError(trackAudioErrorText);
    renderUi({ force: true });
    announce("THE SELECTED TRACK COULD NOT BE PLAYED. PRESS PLAY TO RETRY.");
    focusPlay();
  }

  function handleActiveTrackError(round) {
    if (
      session.status === "result" ||
      !ownedRound() ||
      round.id !== ownedRound().id
    ) return;
    if (round.modeName === "daily") {
      if (!isResultOpen()) handleDailyTrackError(round);
      return;
    }
    const mode = currentMode();
    session.recovery.reuseCommittedRound = Boolean(
      currentRound()?.id === round.id && round.hasPlayed,
    );
    replacePromptWithTechnicalError(
      round.modeName === "daily" ? dailyAudioErrorText : trackAudioErrorText,
    );
    pausePlayback();
    if (session.status === "result") return;
    roundPreparation.quarantine(round);
    audioDeck.releaseActive();
    session.current = null;
    session.pending = null;
    session.status = "idle";
    session.playbackRequested = false;
    if (mode.timed && session.recovery.automaticRetriesRemaining > 0) {
      session.recovery.automaticRetriesRemaining--;
      session.recovery.prefetchBlocked = false;
      announce("THE SELECTED TRACK COULD NOT BE PLAYED. TRYING ANOTHER.");
      const recovery = startRound({ recovery: true });
      if (recovery.status === "ready") return;
    }
    showTrackRetry();
  }

  function handleAudioPlaying(payload) {
    if (pendingRound() && payload.round.id === pendingRound().id) {
      if (isModalOpen() || session.status === "result") return;
      const committed = pendingRound();
      session.pending = null;
      session.current = committed;
      session.status = "active";
      session.playbackRequested = true;
      committed.hasPlayed = true;
      session.previousDailyNumber = committed.track.dailyNumber;
      state.used.clear();
      if (!session.recovery.reuseCommittedRound) state.rounds++;
      state.notice = null;
      if (currentMode().daily && dailyState.retryRound?.id === committed.id) {
        dailyState.retryRound = null;
      }
      if (!currentMode().timed) {
        gameClock.resetClassic(snippetDurations[state.step] * 1000);
        setProgress(currentMode().initialText, currentMode().initialProgress);
      }
      renderPrompt({ replaceRetry: true });
      session.recovery.reuseCommittedRound = false;
      markDailyStarted();
      renderUi({ force: true });
      gameClock.resume();
      roundPreparation.prefetch();
      focusGuess();
      return;
    }
    if (
      !currentRound() ||
      payload.round.id !== currentRound().id ||
      isModalOpen() ||
      session.status === "result"
    ) return;
    currentRound().hasPlayed = true;
    session.status = "active";
    session.playbackRequested = true;
    markDailyStarted();
    renderUi();
    gameClock.resume();
  }

  function handleAudioWaiting(payload) {
    if (!ownedRound() || payload.round.id !== ownedRound().id) return;
    gameClock.pause();
  }

  function handleAudioEnded(payload) {
    if (
      !currentRound() ||
      payload.round.id !== currentRound().id ||
      !currentRound().hasPlayed ||
      session.status === "result"
    ) return;
    handleTrackEnded();
  }

  function handleAudioError(payload) {
    if (payload.role === "standby") {
      roundPreparation.quarantine(payload.round);
      session.recovery.prefetchBlocked = true;
      if (
        payload.round.modeName === "daily" &&
        !currentRound() &&
        session.status !== "result"
      ) handleDailyTrackError(payload.round);
      return;
    }
    handleActiveTrackError(payload.round);
  }

  function handleAudioPlayBlocked(payload) {
    if (!ownedRound() || payload.round.id !== ownedRound().id) return;
    gameClock.pause();
    if (currentRound()) session.status = "paused";
    else session.status = "preparing";
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
    state.suggestions = [];
    ui.suggest.replaceChildren();
    ui.suggest.style.display = "none";
    ui.guess.setAttribute("aria-expanded", "false");
    ui.guess.removeAttribute("aria-activedescendant");
  }

  function getModeRulesText(modeName) {
    const mode = modes[modeName];
    if (!mode) return modePromptText;
    if (state.mode === modeName && state.notice === "track-audio-error") {
      return trackAudioErrorText;
    }
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

  function previewMode(modeName) {
    if (!canPreviewRules()) return;
    state.previewText = getModeRulesText(modeName);
    renderUi();
  }

  function previewDiscovery() {
    if (!canPreviewRules()) return;
    state.previewText = discoveryDescription;
    renderUi();
  }

  function resetRulesPreview() {
    if (!canPreviewRules()) return;
    state.previewText = null;
    renderUi();
  }

  function showGuess() {
    state.previewText = null;
    renderUi();
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

  const slotView = createSlotView(ui.slots);

  function clearHistory(animate = true) {
    state.history = [];
    session.promptEntryId = null;
    session.retryEntryId = null;
    slotView.clear(animate);
  }

  function addHistoryEntry(text, tone = "", { replaceId = null } = {}) {
    const replacementIndex = replaceId === null
      ? -1
      : state.history.findIndex((entry) => entry.id === replaceId);
    if (replacementIndex >= 0) {
      const entry = { id: replaceId, text, tone };
      state.history[replacementIndex] = entry;
      if (replacementIndex === 0) slotView.add(text, tone, true);
      else renderHistoryImmediately();
      return entry;
    }

    const entry = { id: ++state.nextHistoryId, text, tone };
    state.history.unshift(entry);
    if (currentMode()?.timed && state.history.length > maxTimedSlots) {
      state.history.length = maxTimedSlots;
    }
    slotView.add(text, tone);
    return entry;
  }

  function renderHistoryImmediately() {
    slotView.clear(false);
    [...state.history].reverse().forEach((entry) => {
      slotView.add(entry.text, entry.tone);
    });
  }

  function replacePromptWithTechnicalError(text) {
    const replaceId = session.promptEntryId || session.retryEntryId;
    const entry = addHistoryEntry(text, "blink technical", { replaceId });
    session.promptEntryId = null;
    session.retryEntryId = entry.id;
  }

  function renderPrompt({ replaceRetry = false } = {}) {
    const replaceId = replaceRetry ? session.retryEntryId : null;
    let entry;
    if (currentMode().timed) {
      entry = addHistoryEntry(`GUESS #${state.rounds}`, "prompt", { replaceId });
    } else {
      const seconds = snippetDurations[state.step];
      const last = state.step === snippetDurations.length - 1;
      ui.endtime.textContent = formatTime(seconds);
      ui.snippet.style.width = `${seconds / maxSnippetDuration * 100}%`;
      ui.skip.textContent = last
        ? "GIVE UP"
        : `ADD ${snippetDurations[state.step + 1] - seconds}S`;
      entry = addHistoryEntry(
        last ? "LAST CHANCE TO GUESS" : `GUESS ${state.step + 1} OUT OF ${snippetDurations.length}`,
        last ? "blink prompt" : "prompt",
        { replaceId },
      );
    }
    session.promptEntryId = entry.id;
    session.retryEntryId = null;
  }

  function formatDiscoveryCount(found, total) {
    const percent = total ? Math.round(found * 100 / total) : 0;
    return `${found} / ${total} (${percent}%)`;
  }

  function renderDiscoveryItems() {
    if (state.appStatus === "loading" && !catalogState.applied.tracks.length) {
      ui.discoveryCount.textContent = formatDiscoveryCount(0, 0);
      ui.discoveryItems.textContent = "LOADING...";
      return;
    }
    const discoveryTracks = [...catalogState.applied.tracks]
      .sort((a, b) => b.dailyNumber - a.dailyNumber);
    const validNumbers = new Set(discoveryTracks.map((track) => track.dailyNumber));
    const found = [...state.discovered]
      .filter((dailyNumber) => validNumbers.has(dailyNumber)).length;
    ui.discoveryCount.textContent = formatDiscoveryCount(found, discoveryTracks.length);
    ui.discoveryItems.replaceChildren(...discoveryTracks.map((track) => {
      const item = document.createElement("div");
      item.className = "discovery-item";
      item.setAttribute("role", "listitem");
      const discovered = state.discovered.has(track.dailyNumber);
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
    state.suggestions = catalogState.applied.tracks
      .filter(({ title }) =>
        query &&
        !state.used.has(title) &&
        title.toLocaleLowerCase().includes(query))
      .slice(0, 8)
      .map(({ title }) => title);

    state.activeSuggestion = state.suggestions.length ? 0 : -1;
    ui.suggest.replaceChildren(...state.suggestions.map((title, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.id = `corzaguessr-option-${index}`;
      button.textContent = title;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(index === 0));
      if (index === 0) button.className = "active";
      return button;
    }));

    const open = Boolean(state.suggestions.length);
    ui.suggest.style.display = open ? "block" : "none";
    ui.guess.setAttribute("aria-expanded", String(open));
    if (open) ui.guess.setAttribute("aria-activedescendant", "corzaguessr-option-0");
    else ui.guess.removeAttribute("aria-activedescendant");
  }

  function setActiveSuggestion(index) {
    const suggestionCount = state.suggestions.length;
    if (!suggestionCount) return;
    state.activeSuggestion = (index + suggestionCount) % suggestionCount;
    const options = [...ui.suggest.querySelectorAll("[role=option]")];
    options.forEach((option, optionIndex) => {
      const active = optionIndex === state.activeSuggestion;
      option.classList.toggle("active", active);
      option.setAttribute("aria-selected", String(active));
    });
    const activeOption = options[state.activeSuggestion];
    if (activeOption) ui.guess.setAttribute("aria-activedescendant", activeOption.id);
    else ui.guess.removeAttribute("aria-activedescendant");
  }

  // Game rules --------------------------------------------------------------

  function hasAvailableTrack() {
    return catalogState.applied.tracks.some(
      (track) => !catalogState.unavailable.has(track.dailyNumber),
    );
  }

  function getDailyEligibleTracks(date) {
    return catalogState.applied.tracks.filter((track) => track.dailyFrom <= date);
  }

  function selectDailyTrackForDate(date, { usePersisted = true } = {}) {
    const eligible = getDailyEligibleTracks(date);
    if (!eligible.length) return null;
    if (
      usePersisted &&
      dailyState.progress.date === date &&
      dailyState.progress.dailyNumber
    ) {
      const persisted = eligible.find(
        (track) => track.dailyNumber === dailyState.progress.dailyNumber,
      );
      if (persisted) return persisted;
    }
    return eligible.reduce((winner, track) => {
      const score = hashDaily(`corzaguessr-daily:${date}:${track.dailyNumber}`);
      return !winner || score > winner.score ? { track, score } : winner;
    }, null)?.track || null;
  }

  function persistDailySelectionForDate(date) {
    const selected = selectDailyTrackForDate(date);
    if (!selected) return null;
    const progress = dailyState.progress;
    if (
      progress.date === date &&
      progress.dailyNumber === selected.dailyNumber
    ) return selected;
    if (progress.date === date && progress.started) return selected;
    dailyState.progress = {
      date,
      dailyNumber: selected.dailyNumber,
      started: false,
      completed: false,
      won: false,
      step: 0,
    };
    saveDaily();
    return selected;
  }

  function selectTrack() {
    if (currentMode().daily) {
      return selectDailyTrackForDate(dailyState.roundDate);
    }

    const availableTracks = catalogState.applied.tracks.filter(
      (track) => !catalogState.unavailable.has(track.dailyNumber),
    );
    if (!availableTracks.length) return null;
    const pool = availableTracks.length > 1
      ? availableTracks.filter(
        (track) => track.dailyNumber !== session.previousDailyNumber,
      )
      : availableTracks;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function isPreparedOutcome(outcome) {
    return outcome.status === "ready" || outcome.status === "daily-retry";
  }

  function startRound({ recovery = false, manualRetry = false } = {}) {
    if (!canUsePlayback() || !catalogState.applied.tracks.length) {
      return { status: "unavailable" };
    }
    const mode = currentMode();
    if (mode.daily && dailyNeedsCatalogRefresh()) {
      reconcileApp();
      renderUi();
      return { status: "catalog-pending" };
    }
    if (mode.daily && isDailyInProgress(dailyState.roundDate)) {
      state.step = dailyState.progress.step;
    }
    gameClock.pause();
    if (manualRetry) {
      session.recovery.prefetchBlocked = false;
      if (!mode.daily && !hasAvailableTrack()) catalogState.unavailable.clear();
    }

    let prepared = roundPreparation.prepare({ manualRetry: manualRetry || recovery });
    while (
      prepared.status === "audio-failed" &&
      mode.timed &&
      session.recovery.automaticRetriesRemaining > 0
    ) {
      session.recovery.automaticRetriesRemaining--;
      session.recovery.prefetchBlocked = false;
      prepared = roundPreparation.prepare({ manualRetry: true });
    }
    if (!isPreparedOutcome(prepared)) return prepared;

    const round = prepared.round;
    round.hasPlayed = false;
    session.pending = round;
    session.current = null;
    session.status = "preparing";
    session.playbackRequested = true;
    state.previewText = null;
    state.notice = null;
    renderUi({ force: true });
    if (!audioDeck.playActive()) {
      roundPreparation.quarantine(round);
      audioDeck.releaseActive();
      session.pending = null;
      session.status = "audio-retry";
      session.playbackRequested = false;
      renderUi({ force: true });
      return { status: "audio-failed", round };
    }
    return { status: prepared.status, round };
  }

  function togglePlay() {
    if (!canUsePlayback()) return;
    const mode = currentMode();
    if (mode.daily && dailyNeedsCatalogRefresh()) {
      renderUi();
      reconcileApp();
      return;
    }
    if (mode.daily && isDailyDone(dailyState.roundDate) && !currentRound()) {
      renderUi();
      return;
    }
    if (pendingRound() && !audioDeck.isPlayRequested()) {
      renderPlaybackIntent(true);
      if (!audioDeck.playActive()) {
        if (mode.daily) handleDailyTrackError(pendingRound());
        else showTrackRetry();
      }
    } else if (!currentRound()) {
      const retrying = session.status === "audio-retry";
      const outcome = startRound({ manualRetry: retrying });
      if (!isPreparedOutcome(outcome)) {
        if (outcome.status === "catalog-pending") renderUi({ force: true });
        else if (mode.daily) handleDailyTrackError(outcome.round || dailyState.retryRound);
        else showTrackRetry();
        return;
      }
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
    if (!track || state.discovered.has(track.dailyNumber)) return;
    state.discovered.add(track.dailyNumber);
    saveDiscoveries();
    renderDiscovery();
  }

  function renderAttempt(type, title) {
    const replaceId = session.promptEntryId;
    if (type === "skip") {
      if (currentMode().timed) {
        addHistoryEntry("SKIPPED", "skip", { replaceId });
      } else {
        const last = state.step === snippetDurations.length - 1;
        const added = last
          ? 0
          : snippetDurations[state.step + 1] - snippetDurations[state.step];
        addHistoryEntry(
          last
            ? "FINAL GUESS SKIPPED"
            : `GUESS ${state.step + 1} SKIPPED, ${added} SECOND${added === 1 ? "" : "S"} ADDED`,
          "skip",
          { replaceId },
        );
      }
    } else {
      addHistoryEntry(title, type === "correct" ? "correct" : "wrong", { replaceId });
    }
    session.promptEntryId = null;
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
    if (session.status === "result" || clock.expired || !clock.remainingMs) {
      endGame();
      return;
    }
    session.current = null;
    session.status = "idle";
    session.playbackRequested = false;
    session.recovery.automaticRetriesRemaining = 1;
    const outcome = startRound();
    if (!isPreparedOutcome(outcome)) showTrackRetry();
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
    if (
      !currentRound() ||
      isModalOpen() ||
      (session.status !== "active" && session.status !== "paused")
    ) return;
    if (currentMode().timed) {
      const clock = pausePlayback();
      if (clock.expired || session.status === "result") return;
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
      (session.status !== "active" && session.status !== "paused") ||
      (currentMode().timed && !currentRound().hasPlayed)
    ) return;
    state.used.add(title);
    attempt(title === currentTrack().title ? "correct" : "wrong", title);
  }

  function handleTrackEnded() {
    if (!currentRound() || !currentRound().hasPlayed || session.status === "result") return;
    const clock = gameClock.pause();
    if (clock.expired || session.status === "result") return;
    currentRound().hasPlayed = false;
    session.status = "paused";
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
    if (!currentRound() || session.status === "result") return;
    const mode = currentMode();
    gameClock.stop();
    audioDeck.pauseActive();
    session.status = "result";
    session.playbackRequested = false;
    currentRound().hasPlayed = false;
    renderUi({ force: true });
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
    overlayController.open("result");
  }

  function closeResult() {
    overlayController.close("result");
  }

  function cancelProgressTransition() {
    clearTimer("progress");
    ui.fill.style.transition = "";
  }

  function finalizeSessionReset() {
    state.appStatus = "ready";
    renderUi({ force: true });
    roundPreparation.prefetch();
    if (isRoundReadyToStart()) focusPlay();
  }

  function resetSession({ render = true } = {}) {
    const mode = currentMode();
    gameClock.stop({ flush: false });
    audioDeck.reset();
    session.current = null;
    session.pending = null;
    session.status = "idle";
    session.promptEntryId = null;
    session.retryEntryId = null;
    session.playbackRequested = false;
    roundPreparation.reset();
    dailyState.retryRound = null;

    Object.assign(state, {
      step: mode.daily && isDailyInProgress(dailyState.roundDate)
        ? dailyState.progress.step
        : 0,
      rounds: 0,
      guesses: 0,
      correct: 0,
      activeSuggestion: -1,
      newPersonalBest: false,
      classicResult: null,
      notice: null,
      previewText: null,
    });
    state.used.clear();
    clearFrame("announcement");
    clearFrame("guess-focus");
    ui.status.textContent = "";
    clearTimer("feedback");
    ui.feedback.classList.remove("survival-penalty", "survival-reward");
    ui.timeChange.classList.remove("survival-change");
    ui.timeChangeText.textContent = "";
    clearHistory();
    clearGuess();

    ui.endtime.textContent = mode.endTime;
    ui.skip.textContent = mode.skip;
    ui.snippet.style.width = `${100 / maxSnippetDuration}%`;
    setProgress(mode.initialText, mode.initialProgress);
    if (mode.timed) {
      gameClock.resetTimed(mode.survival ? "survival" : "blitz", mode.initialTime);
    } else {
      gameClock.resetClassic(snippetDurations[0] * 1000);
    }
    if (mode.daily && (
      isDailyInProgress(dailyState.roundDate) || isDailyDone(dailyState.roundDate)
    )) renderSavedDailyProgress();
    if (render) renderUi({ force: true });
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

  function reset(options) {
    clearTimer("result");
    cancelProgressTransition();
    resetSession(options);
    if (state.appStatus === "ready") {
      roundPreparation.prefetch();
      if (isRoundReadyToStart()) focusPlay();
    }
  }

  function setMode(modeName) {
    if (
      !modes[modeName] ||
      modeName === state.mode ||
      isModalOpen()
    ) return;
    state.mode = modeName;
    state.previewText = null;
    const message = getModeRulesText(modeName);
    announce(message);
    if (!catalogState.applied.tracks.length) {
      renderUi({ force: true });
      return;
    }
    applyModeChange();
  }

  // Initial mode selection --------------------------------------------------

  function applyModeChange() {
    cancelProgressTransition();
    ui.fill.style.transition = "transform var(--duration-slot) ease-out";
    resetSession({ render: false });
    finalizeSessionReset();
    setTimer("progress", () => {
      ui.fill.style.transition = "";
    }, transitionDelay(durations.progress));
  }

  function activateMode() {
    if (
      isDiscoveryOpen() ||
      !state.mode ||
      !catalogState.applied.tracks.length
    ) return;
    applyModeChange();
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

  function createOverlayController() {
    const durationFor = (kind) => kind === "result" ? durations.result : durations.discovery;

    function open(kind) {
      if (overlayState.phase !== "closed" || (kind === "discovery" && session.status === "result")) {
        return false;
      }
      clearTimer(kind);
      clearFrame("overlay-open");
      clearFrame("guess-focus");
      clearFrame("discovery-layout");
      overlayState.returnFocus = document.activeElement;

      if (kind === "discovery") {
        state.previewText = null;
        gameClock.pause();
        renderDiscovery();
        overlayState.discoverySuspension = audioDeck.suspendActive();
        if (overlayState.discoverySuspension) renderPlaybackIntent(false);
      }

      const generation = beginOverlayTransition(kind, "opening");
      lockPageScroll();
      if (kind === "result") {
        ui.card.classList.remove("modal-closing");
        ui.card.classList.add("modal-open");
        ui.result.setAttribute("aria-hidden", "false");
        ui.next.focus({ preventScroll: true });
      } else {
        root.classList.add("discovery-open");
        ui.discoveryButton.setAttribute("aria-expanded", "true");
        ui.discoveryModal.setAttribute("aria-hidden", "false");
        ui.discoveryShell.style.height = "0px";
      }
      renderUi({ force: true });

      setFrame("overlay-open", () => {
        if (!overlayTransitionMatches(kind, "opening", generation)) return;
        if (kind === "result") {
          ui.card.classList.add("modal-visible");
        } else {
          root.classList.add("discovery-visible");
          setDiscoveryHeight();
          ui.discoveryModal.focus({ preventScroll: true });
        }
        overlayState.phase = "open";
        renderUi();
      });
      return true;
    }

    function close(kind) {
      if (overlayState.kind !== kind || overlayState.phase === "closing") return false;
      clearTimer(kind);
      clearFrame("overlay-open");
      clearFrame("discovery-layout");
      const generation = beginOverlayTransition(kind, "closing");
      if (kind === "result") {
        ui.card.classList.add("modal-closing");
        ui.card.classList.remove("modal-visible");
        reset();
      } else {
        root.classList.remove("discovery-visible");
        ui.discoveryButton.setAttribute("aria-expanded", "false");
        ui.discoveryShell.style.height = `${ui.discoveryShell.offsetHeight}px`;
        void ui.discoveryShell.offsetHeight;
        ui.discoveryShell.style.height = "0px";
      }
      renderUi({ force: true });

      setTimer(kind, () => {
        if (!overlayTransitionMatches(kind, "closing", generation)) return;
        const returnFocus = overlayState.returnFocus;
        overlayState.returnFocus = null;
        overlayState.kind = null;
        overlayState.phase = "closed";
        if (kind === "result") {
          ui.card.classList.remove("modal-open", "modal-visible", "modal-closing");
          ui.result.setAttribute("aria-hidden", "true");
        } else {
          root.classList.remove("discovery-open", "discovery-visible");
          ui.discoveryShell.style.height = "";
          ui.discoveryModal.setAttribute("aria-hidden", "true");
          const suspension = overlayState.discoverySuspension;
          overlayState.discoverySuspension = null;
          const restored = audioDeck.restoreActive(suspension);
          if (restored.status === "ended") handleTrackEnded();
          else if (restored.status === "error") handleAudioError(restored.payload);
          else if (restored.status === "resumed") renderPlaybackIntent(true);
          if (
            isAwaitingMode() &&
            state.mode &&
            catalogState.applied.tracks.length
          ) activateMode();
        }
        unlockPageScroll();
        renderUi({ force: true });
        restoreOverlayFocus(returnFocus);
      }, transitionDelay(durationFor(kind)));
      return true;
    }

    return { open, close };
  }

  const overlayController = createOverlayController();

  function openDiscovery() {
    overlayController.open("discovery");
  }

  function closeDiscovery() {
    overlayController.close("discovery");
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
    state.discovered = new Set();
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
    element.addEventListener("focus", () => {
      if (state.inputModality === "keyboard") preview();
    });
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
      if (!state.suggestions.length) return;
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
    const suggestion = state.suggestions[state.activeSuggestion];
    if (suggestion) makeGuess(suggestion);
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
    if (!option) return;
    const options = [...ui.suggest.children];
    const suggestion = state.suggestions[options.indexOf(option)];
    if (suggestion) makeGuess(suggestion);
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
    state.inputModality = "keyboard";
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
    state.inputModality = event.pointerType === "mouse" && finePointer.matches
      ? "pointer-fine"
      : "pointer-coarse";
    if (
      isRoundReadyToStart() &&
      !event.target.closest(interactiveSelector)
    ) {
      event.preventDefault();
      focusPlay();
      return;
    }
    if (
      !getUiModel().guessEnabled ||
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
    if (!value.length) throw new Error("Track catalog is empty.");
    const titles = new Set();
    const dailyNumbers = new Set();
    const valid = [];
    const fail = (index, message) => {
      throw new Error(`Track catalog entry ${index + 1} ${message}`);
    };
    for (const [index, item] of value.entries()) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        fail(index, "is not an object.");
      }
      const title = typeof item?.title === "string" ? item.title.trim() : "";
      const duration = item?.duration;
      const spotify = typeof item?.spotify === "string" ? item.spotify.trim() : "";
      const dailyNumber = item?.dailyNumber;
      const dailyFrom = typeof item?.dailyFrom === "string" ? item.dailyFrom.trim() : "";
      const isNew = item?.isNew === true;
      if (!title) fail(index, "has no title.");
      if (titles.has(title)) fail(index, `duplicates title \"${title}\".`);
      if (!Number.isFinite(duration) || duration <= 0) {
        fail(index, "has an invalid duration.");
      }
      if (!Number.isSafeInteger(dailyNumber) || dailyNumber <= 0) {
        fail(index, "has an invalid dailyNumber.");
      }
      if (dailyNumbers.has(dailyNumber)) {
        fail(index, `duplicates dailyNumber ${dailyNumber}.`);
      }
      if (spotify && !/^[A-Za-z0-9]{22}$/.test(spotify)) {
        fail(index, "has an invalid Spotify track ID.");
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dailyFrom)) {
        fail(index, "has an invalid dailyFrom date.");
      }
      const parsedDate = new Date(`${dailyFrom}T00:00:00Z`);
      if (
        Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== dailyFrom
      ) fail(index, "has a non-calendar dailyFrom date.");
      titles.add(title);
      dailyNumbers.add(dailyNumber);
      valid.push({ title, duration, spotify, dailyNumber, dailyFrom, isNew });
    }
    return valid;
  }

  async function fetchTrackCatalog(date) {
    const url = new URL(tracksUrl);
    url.searchParams.set("date", date);
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Track catalog returned ${response.status}.`);
    return validateTracks(await response.json());
  }

  function invalidateUnstartedOldDaily(today) {
    if (state.mode !== "daily" || catalogState.applied.date === today) return false;
    if (isDailyRoundProtected()) return false;
    const current = ownedRound();
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
      clearHistory(false);
      renderUi({ force: true });
      return true;
    }
    return false;
  }

  function applyStagedCatalog(today) {
    const request = catalogState.request;
    if (request.kind !== "staged") return false;
    if (request.date !== today) {
      catalogState.request = { kind: "idle" };
      return false;
    }
    if (isDailyRoundProtected()) return false;
    applyCatalog(request.date, request.tracks);
    return true;
  }

  function applyCatalog(date, tracks) {
    const initial = !catalogState.applied.tracks.length;
    audioDeck.discardStandby();
    catalogState.applied = {
      date,
      generation: catalogState.applied.generation + 1,
      tracks,
    };
    catalogState.request = { kind: "idle" };
    catalogState.unavailable.clear();
    session.recovery.prefetchBlocked = false;
    dailyState.roundDate = date;
    dailyState.retryRound = null;
    state.notice = null;
    state.catalogError = null;
    persistDailySelectionForDate(date);
    if (state.mode === "daily" && !ownedRound()) {
      state.step = isDailyInProgress(date) ? dailyState.progress.step : 0;
      gameClock.resetClassic(snippetDurations[state.step] * 1000);
    }
    renderDiscovery();

    if (initial || state.appStatus === "loading" || state.appStatus === "error") {
      state.appStatus = "awaiting-mode";
      renderUi({ force: true });
      if (state.mode && !isDiscoveryOpen()) activateMode();
      return;
    }
    renderUi({ force: true });
    if (state.mode && session.status === "idle" && !isModalOpen()) {
      roundPreparation.prefetch();
    }
  }

  function ensureCatalogRequest(date) {
    if (!date || date === catalogState.applied.date) return false;
    const request = catalogState.request;
    if (
      (request.kind === "loading" || request.kind === "staged") &&
      request.date === date
    ) return false;
    if (
      request.kind === "retry" &&
      request.date === date &&
      Date.now() < request.retryAt
    ) return false;

    const id = ++catalogState.nextRequestId;
    catalogState.request = { kind: "loading", date, id };
    if (!catalogState.applied.tracks.length) {
      state.appStatus = "loading";
      renderUi({ force: true });
    }
    void fetchTrackCatalog(date).then((tracks) => {
      if (
        catalogState.request.kind !== "loading" ||
        catalogState.request.id !== id
      ) return;
      if (date !== getBudapestDate()) {
        catalogState.request = { kind: "idle" };
        reconcileApp();
        return;
      }
      if (catalogState.applied.tracks.length && isDailyRoundProtected()) {
        catalogState.request = { kind: "staged", date, tracks };
      } else {
        applyCatalog(date, tracks);
      }
    }).catch((error) => {
      if (
        catalogState.request.kind !== "loading" ||
        catalogState.request.id !== id
      ) return;
      console.error("Corzaguessr rejected its track catalog.", error);
      catalogState.request = {
        kind: "retry",
        date,
        retryAt: Date.now() + 5000,
        error,
      };
      state.catalogError = error;
      if (!catalogState.applied.tracks.length) state.appStatus = "error";
      renderUi({ force: true });
      if (state.mode === "daily" && dailyNeedsCatalogRefresh(date)) {
        announce(dailyCatalogErrorText);
      } else if (!catalogState.applied.tracks.length) {
        announce("COULD NOT LOAD THE TRACKLIST. RETRYING.");
      }
    });
    return true;
  }

  function reconcileApp() {
    const today = getBudapestDate();
    invalidateUnstartedOldDaily(today);
    applyStagedCatalog(today);
    ensureCatalogRequest(today);
  }

  function loadTracks() {
    reconcileApp();
  }

  loadTracks();
})();
