(() => {
  "use strict";

  // Configuration -----------------------------------------------------------

  const root = document.querySelector("#corzaguessr");
  if (!root || root.dataset.corzaguessrReady) return;
  root.dataset.corzaguessrReady = "true";

  const scriptUrl = new URL(document.currentScript?.src || location.href);
  const tracksUrl = new URL("tracks.json", scriptUrl);
  tracksUrl.search = scriptUrl.search;
  const snippetDurations = [1, 2, 4, 8, 16, 32];
  const maxSnippetDuration = snippetDurations.at(-1);
  const maxTimedClipSeconds = 60;
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
  const discoveryDescription =
    "REVEAL TRACKS YOU'VE GUESSED CORRECTLY AND TRACK YOUR DISCOVERY PROGRESS";
  const dailyDoneText = "ALREADY DONE FOR TODAY, COME BACK TOMORROW";
  const hiddenTitle = "???????????????????";
  const youtubeOrigin = "https://www.youtube-nocookie.com";
  const youtubeOrigins = new Set([
    youtubeOrigin,
    "https://www.youtube.com",
  ]);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
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
              <div class="discovery-items"></div>
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
    <iframe
      class="yt hide"
      title="CORZAGUESSR AUDIO PLAYER"
      allow="autoplay; encrypted-media; picture-in-picture"
      allowfullscreen
    ></iframe>
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
    yt: $(".yt"),
    icon: $(".icon path"),
  };
  const modeButtons = Object.fromEntries(
    [...root.querySelectorAll("[data-mode]")]
      .map((button) => [button.dataset.mode, button]),
  );

  // State and small utilities -----------------------------------------------

  const state = {
    mode: null,
    status: "loading",
    tracks: [],
    track: null,
    previousTrack: null,
    step: 0,
    elapsed: 0,
    time: 0,
    maxTime: modes.survival.initialTime,
    rounds: 0,
    guesses: 0,
    correct: 0,
    trackStarted: false,
    used: new Set(),
    discovered: loadDiscoveries(),
    personalBests: loadPersonalBests(),
    newPersonalBest: false,
    classicResult: null,
    daily: loadDaily(),
    dailyDate: getBudapestDate(),
    playerReady: false,
    frame: 0,
    previousTick: 0,
    session: 0,
    activeSuggestion: -1,
    returnFocus: null,
    pageScrollStyles: null,
    resumeAfterDiscovery: false,
    endedDuringDiscovery: false,
  };
  const timers = new Map();

  root.classList.add("awaiting-mode", "rules-visible");
  setBackgroundInert(false);

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

  function announce(message) {
    ui.status.textContent = "";
    requestAnimationFrame(() => {
      ui.status.textContent = message;
    });
  }

  function focusGuess() {
    if (!ui.guess.disabled && !isModalOpen()) {
      requestAnimationFrame(() => ui.guess.focus());
    }
  }

  function focusPlay() {
    if (!ui.play.disabled && !isModalOpen()) {
      ui.play.focus({ preventScroll: true });
    }
  }

  function isResultOpen() {
    return ui.card.classList.contains("modal-open");
  }

  function isDiscoveryOpen() {
    return root.classList.contains("discovery-open");
  }

  function isAwaitingMode() {
    return root.classList.contains("awaiting-mode");
  }

  function isModalOpen() {
    return isResultOpen() || isDiscoveryOpen();
  }

  function canPreviewRules() {
    return !isModalOpen() && (isAwaitingMode() || (state.mode && !state.track));
  }

  function isRoundReadyToStart() {
    return (
      state.mode &&
      !state.track &&
      !isAwaitingMode() &&
      !isModalOpen() &&
      !ui.play.disabled &&
      state.status !== "loading"
    );
  }

  function transitionDelay(milliseconds) {
    return reducedMotion.matches ? 0 : milliseconds;
  }

  function setBackgroundInert(inert) {
    ui.headerAction.inert = inert;
    ui.modes.inert = inert;
    ui.board.inert = inert || isAwaitingMode();
    ui.slots.inert = inert || isAwaitingMode();
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
      state.daily,
      "DAILY PROGRESS COULD NOT BE SAVED IN THIS BROWSER.",
    );
  }

  function isDailyDone(date = state.dailyDate) {
    return state.daily.date === date && state.daily.completed;
  }

  function isDailyStarted(date = state.dailyDate) {
    return state.daily.date === date && state.daily.started;
  }

  function isDailyInProgress(date = state.dailyDate) {
    return isDailyStarted(date) && !state.daily.completed;
  }

  function getDailyDoneText() {
    if (state.daily.date === state.dailyDate && state.daily.completed) {
      const attempts = state.daily.step + 1;
      const label = state.daily.won ? "COMPLETED" : "FAILED";
      return `${label} IN ${attempts} ATTEMPT${attempts === 1 ? "" : "S"}, COME BACK TOMORROW`;
    }
    return dailyDoneText;
  }

  function getDailyInProgressText() {
    const attempt = state.daily.step + 1;
    return `DAILY IN PROGRESS, CONTINUE FROM ATTEMPT ${attempt}`;
  }

  function markDailyStarted() {
    if (state.mode !== "daily" || isDailyStarted(state.dailyDate)) return;
    state.daily = {
      date: state.dailyDate,
      started: true,
      completed: false,
      won: false,
      step: 0,
    };
    saveDaily();
  }

  function saveDailyStep() {
    if (
      state.mode !== "daily" ||
      state.daily.date !== state.dailyDate ||
      !state.daily.started ||
      state.daily.completed
    ) return;
    state.daily.step = state.step;
    saveDaily();
  }

  function completeDaily(won) {
    if (state.mode !== "daily") return;
    state.daily = {
      date: state.dailyDate,
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

  // YouTube player ----------------------------------------------------------

  function sendPlayerCommand(func, ...args) {
    if (!ui.yt.contentWindow) return;
    ui.yt.contentWindow.postMessage(
      JSON.stringify({ event: "command", func, args }),
      youtubeOrigin,
    );
  }

  function cancelClock() {
    cancelAnimationFrame(state.frame);
    state.frame = 0;
    state.previousTick = 0;
  }

  function setPlaying(playing, pausePlayer = false) {
    if (!playing) cancelClock();
    if (state.status !== "ended") {
      if (playing) state.status = "playing";
      else if (state.status === "playing") state.status = "paused";
    }
    if (pausePlayer) sendPlayerCommand("pauseVideo");

    const icon = playing
      ? currentMode().timed ? "pause" : "stop"
      : "play";
    ui.icon.setAttribute("d", icons[icon]);
    ui.play.setAttribute("aria-label", icon === "play" ? "PLAY" : icon === "pause" ? "PAUSE" : "STOP");
  }

  function loadPlayerTrack(autoplay = true) {
    if (!state.track) return;
    const video = {
      videoId: state.track.id,
      startSeconds: state.track.at,
    };

    if (state.playerReady) {
      sendPlayerCommand(autoplay ? "loadVideoById" : "cueVideoById", video);
      return;
    }

    if (!ui.yt.src) {
      ui.yt.src =
        `${youtubeOrigin}/embed/${state.track.id}` +
        "?enablejsapi=1&controls=0&rel=0&modestbranding=1&playsinline=1&autoplay=0" +
        `&origin=${encodeURIComponent(location.origin)}`;
    }
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
    if (!state.track) return;
    rewindClassic();
    state.elapsed = 0;
    state.trackStarted = false;
    setPlaying(true);
    loadPlayerTrack(true);
    focusGuess();
  }

  function startClock() {
    if (state.frame || state.status !== "playing") return;
    const session = state.session;
    const mode = currentMode();

    const tick = (now) => {
      if (session !== state.session || state.status !== "playing") {
        cancelClock();
        return;
      }

      state.previousTick ||= now;
      const delta = Math.min(now - state.previousTick, 250);
      state.previousTick = now;

      if (!mode.timed) {
        state.elapsed += delta;
        setProgress(
          formatTime(state.elapsed / 1000),
          state.elapsed / (maxSnippetDuration * 1000) + 0.0025,
        );
        if (state.elapsed >= snippetDurations[state.step] * 1000) {
          setPlaying(false, true);
          return;
        }
      } else {
        if (mode.survival) state.elapsed += delta;
        state.time = Math.max(0, state.time - delta);
        if (mode.survival) {
          ui.endtime.textContent = formatTime(Math.ceil(state.time / 1000));
        }
        setProgress(
          formatTime((mode.survival ? state.elapsed : state.time) / 1000),
          state.time / (mode.survival ? state.maxTime : mode.initialTime),
        );
        if (!state.time) {
          endGame();
          return;
        }
      }

      state.frame = requestAnimationFrame(tick);
    };

    state.frame = requestAnimationFrame(tick);
  }

  function handlePlayerError() {
    if (!state.track || isModalOpen()) return;
    state.session++;
    setPlaying(false, true);
    state.track = null;
    state.trackStarted = false;
    ui.skip.disabled = true;
    if (currentMode().daily) applyModeAvailability();
    else showRules(currentMode().description);
    clearSlots(false);
    addSlot("COULD NOT PLAY TRACK, TRY AGAIN!", "blink");
    announce("THE SELECTED TRACK COULD NOT BE PLAYED. TRY AGAIN.");
  }

  function handlePlayerStateChange(playerState) {
    if (playerState === 1) {
      if (!state.track || isModalOpen() || state.status === "ended") return;
      markDailyStarted();
      state.trackStarted = true;
      ui.skip.disabled = false;
      setPlaying(true);
      startClock();
      focusGuess();
      return;
    }

    if (playerState === 3) {
      cancelClock();
      return;
    }

    if (
      playerState === 0 &&
      state.track &&
      state.trackStarted &&
      state.status !== "ended"
    ) {
      if (isDiscoveryOpen()) state.endedDuringDiscovery = true;
      else handleTrackEnded();
    }
  }

  function handlePlayerMessage(event) {
    if (
      event.source !== ui.yt.contentWindow ||
      !youtubeOrigins.has(event.origin)
    ) return;

    let data;
    try {
      data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
    } catch {
      return;
    }
    if (!data || typeof data !== "object") return;

    if (data.event === "onReady") {
      state.playerReady = true;
      sendPlayerCommand("addEventListener", "onStateChange");
      sendPlayerCommand("addEventListener", "onError");
      if (state.track) loadPlayerTrack(state.status === "playing");
    } else if (data.event === "onStateChange") {
      handlePlayerStateChange(data.info);
    } else if (data.event === "onError") {
      handlePlayerError();
    }
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

  function clearSlots(animate = true) {
    clearTimer("slots");
    if (!ui.slots.children.length) return;
    if (!animate || reducedMotion.matches) {
      ui.slots.replaceChildren();
      ui.slots.style.height = "";
      return;
    }

    ui.play.disabled = true;
    ui.slots.querySelectorAll(".slot").forEach((item) => item.classList.add("fade"));
    ui.slots.style.height = `${ui.slots.offsetHeight}px`;
    void ui.slots.offsetHeight;
    ui.slots.style.height = "0px";
    setTimer("slots", () => {
      ui.slots.replaceChildren();
      ui.slots.style.height = "";
      ui.play.disabled =
        state.status === "loading" ||
        (currentMode()?.daily && isDailyDone(state.dailyDate));
    }, durations.slot);
  }

  function addSlot(text, style = "", replace = false) {
    const item = replace && ui.slots.firstElementChild
      ? ui.slots.firstElementChild
      : document.createElement("div");
    item.className = `slot ${replace ? "" : "fade"} ${style}`.trim();
    item.textContent = text;
    if (!replace || !item.isConnected) {
      ui.slots.prepend(item);
      if (currentMode().timed) {
        while (ui.slots.children.length > maxTimedSlots) {
          ui.slots.lastElementChild.remove();
        }
      }
      requestAnimationFrame(() => item.classList.remove("fade"));
    }
  }

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
    if (state.status === "loading" && !state.tracks.length) {
      ui.discoveryCount.textContent = formatDiscoveryCount(0, 0);
      ui.discoveryItems.textContent = "LOADING...";
      return;
    }
    const validTitles = new Set(state.tracks.map((track) => track.title));
    const found = [...state.discovered].filter((title) => validTitles.has(title)).length;
    ui.discoveryCount.textContent = formatDiscoveryCount(found, state.tracks.length);
    ui.discoveryItems.replaceChildren(...state.tracks.map((track) => {
      const item = document.createElement("div");
      item.className = "discovery-item";
      const discovered = state.discovered.has(track.title);
      item.textContent = discovered ? track.title : hiddenTitle;
      if (!discovered) item.setAttribute("aria-hidden", "true");
      return item;
    }));
  }

  function renderDiscovery() {
    renderDiscoveryItems();
    if (isDiscoveryOpen()) requestAnimationFrame(setDiscoveryHeight);
  }

  function renderSuggestions() {
    const query = ui.guess.value.trim().toLocaleLowerCase();
    const titles = state.tracks
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
      return state.tracks.reduce((winner, track) => {
        const score = hashDaily(
          `corzaguessr-daily-v1:${state.dailyDate}:${track.dailyNumber}`,
        );
        return !winner || score > winner.score ? { track, score } : winner;
      }, null).track;
    }

    const pool = state.tracks.length > 1
      ? state.tracks.filter((track) => track !== state.previousTrack)
      : state.tracks;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function startRound() {
    if (!state.tracks.length) return;
    const mode = currentMode();
    if (mode.daily && isDailyInProgress(state.dailyDate)) {
      state.step = state.daily.step;
    }
    const selected = selectTrack();
    const timedSeconds = Math.min(
      Math.ceil(state.time / 1000),
      maxTimedClipSeconds,
    );
    const seconds = mode.timed
      ? Math.min(timedSeconds, selected.duration)
      : maxSnippetDuration;
    const available = Math.max(0, Math.floor(selected.duration - seconds));

    state.previousTrack = selected;
    state.track = {
      ...selected,
      at: mode.daily
        ? hashDaily(
          `corzaguessr-daily-clip-v1:${state.dailyDate}:${selected.dailyNumber}`,
        ) % (available + 1)
        : Math.floor(Math.random() * (available + 1)),
    };
    state.used.clear();
    state.rounds++;
    state.trackStarted = false;
    state.session++;
    if (!mode.timed) setProgress(mode.initialText, mode.initialProgress);
    setPlaying(true);
    loadPlayerTrack(true);
    renderPrompt();
  }

  function togglePlay() {
    if (ui.play.disabled || state.status === "loading" || isModalOpen()) return;
    const mode = currentMode();
    if (mode.daily && isDailyDone(state.dailyDate) && !state.track) {
      applyModeAvailability();
      return;
    }
    if (!state.track) {
      showGuess();
      startRound();
    } else if (state.status === "playing") {
      setPlaying(false, true);
      if (!mode.timed) rewindClassic();
    } else if (!mode.timed) {
      startClassic();
    } else {
      sendPlayerCommand("playVideo");
      setPlaying(true);
    }
    focusGuess();
  }

  function usePlaybackShortcut() {
    if (
      !state.mode ||
      ui.play.disabled ||
      state.status === "loading" ||
      isModalOpen()
    ) return;

    if (!state.track) {
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
    if (!state.track || state.discovered.has(state.track.title)) return;
    state.discovered.add(state.track.title);
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
    if (mode.survival) {
      flashSurvivalChange(mode.timeChange[type] / 1000);
      state.time = Math.max(0, state.time + mode.timeChange[type]);
      state.maxTime = Math.max(state.maxTime, state.time);
      ui.endtime.textContent = formatTime(Math.ceil(state.time / 1000));
      setProgress(formatTime(state.elapsed / 1000), state.time / state.maxTime);
    }
    setPlaying(false);
    announce(type === "correct" ? "CORRECT." : type === "wrong" ? "INCORRECT." : "SKIPPED.");
    if (!state.time) endGame();
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
    if (state.status !== "playing") {
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
    if (!state.track || isModalOpen()) return;
    renderAttempt(type, title);
    if (type === "correct") recordDiscovery();
    if (currentMode().timed) resolveTimedAttempt(type);
    else resolveClassicAttempt(type);
  }

  function makeGuess(title = ui.guess.value.trim()) {
    if (!title || !state.track) return;
    state.used.add(title);
    attempt(title === state.track.title ? "correct" : "wrong", title);
  }

  function handleTrackEnded() {
    if (!state.track || !state.trackStarted || state.status === "ended") return;
    state.trackStarted = false;
    if (!currentMode().timed) setPlaying(false);
    else attempt("skip");
  }

  function updateTimedPersonalBest() {
    const accuracy = getAccuracy();
    const score = state.mode === "survival"
      ? Math.floor(state.elapsed)
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
    const time = formatTime(state.elapsed / 1000);
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
    if (!currentMode().timed) modules.push(["TRACK:", state.track.title]);
    modules.push(
      ["RUN:", formatter.run()],
      [getPersonalBestLabel(), formatter.personalBest()],
    );
    return modules;
  }

  function openSpotify() {
    const trackId = state.track?.spotify;
    if (!trackId) return;
    window.open(
      `https://open.spotify.com/track/${trackId}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  function endGame(won) {
    if (!state.track) return;
    const mode = currentMode();
    if (mode.timed || state.status === "playing") setPlaying(false, true);
    state.status = "ended";
    state.trackStarted = false;
    state.session++;
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

    const hasSpotify = !mode.timed && Boolean(state.track.spotify);
    ui.spotify.hidden = !hasSpotify;

    openResult();
    announce(ui.resultMeta.dataset.announcement);
  }

  function openResult() {
    clearTimer("result");
    ui.card.classList.remove("modal-closing");
    const card = ui.card.getBoundingClientRect();
    const board = ui.board.getBoundingClientRect();
    ui.card.style.setProperty("--modal-y", `${board.top - card.top + board.height / 2}px`);
    ui.card.classList.add("modal-open");
    ui.result.setAttribute("aria-hidden", "false");
    setBackgroundInert(true);
    ui.next.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      ui.card.classList.add("modal-visible");
    });
  }

  function closeResult() {
    if (!isResultOpen() || ui.card.classList.contains("modal-closing")) return;
    ui.card.classList.add("modal-closing");
    ui.card.classList.remove("modal-visible");
    reset({ keepResultOpen: true });
    setTimer("result", () => {
      ui.card.classList.remove("modal-open", "modal-closing");
      ui.result.setAttribute("aria-hidden", "true");
      setBackgroundInert(false);
      if (isRoundReadyToStart()) focusPlay();
    }, transitionDelay(durations.result));
  }

  function cancelProgressTransition() {
    clearTimer("progress");
    ui.fill.style.transition = "";
  }

  function resetSession({ keepResultOpen = false } = {}) {
    const mode = currentMode();
    if (mode.daily) state.dailyDate = getBudapestDate();
    clearTimer("slots");
    state.session++;
    cancelClock();
    if (state.track) sendPlayerCommand("pauseVideo");

    Object.assign(state, {
      status: "idle",
      track: null,
      step: 0,
      elapsed: 0,
      time: mode.initialTime,
      maxTime: modes.survival.initialTime,
      rounds: 0,
      guesses: 0,
      correct: 0,
      trackStarted: false,
      activeSuggestion: -1,
      newPersonalBest: false,
      classicResult: null,
    });
    state.used.clear();
    ui.status.textContent = "";
    clearTimer("feedback");
    ui.feedback.classList.remove("survival-penalty", "survival-reward");
    ui.timeChange.classList.remove("survival-change");
    ui.timeChangeText.textContent = "";
    if (!keepResultOpen) {
      ui.card.classList.remove("modal-open", "modal-visible", "modal-closing");
      ui.result.setAttribute("aria-hidden", "true");
    }
    setBackgroundInert(keepResultOpen);
    ui.play.disabled = false;
    ui.skip.disabled = true;
    clearSlots();

    ui.endtime.textContent = mode.endTime;
    ui.skip.textContent = mode.skip;
    ui.snippet.style.width = `${100 / maxSnippetDuration}%`;
    setProgress(mode.initialText, mode.initialProgress);
    setPlaying(false);
    applyModeAvailability();
    if (isRoundReadyToStart()) focusPlay();
  }

  function renderSavedDailyProgress() {
    const seconds = snippetDurations[state.daily.step] || snippetDurations[0];
    ui.endtime.textContent = formatTime(seconds);
    ui.snippet.style.width = `${seconds / maxSnippetDuration * 100}%`;
    setProgress(
      formatTime(seconds),
      seconds / maxSnippetDuration + 0.0025,
    );
  }

  function applyModeAvailability() {
    const mode = currentMode();
    if (mode.daily && isDailyDone(state.dailyDate)) {
      ui.play.disabled = true;
      ui.skip.disabled = true;
      ui.guess.disabled = true;
      showRules(getDailyDoneText());
      renderSavedDailyProgress();
      return;
    }
    if (mode.daily && isDailyInProgress(state.dailyDate)) {
      ui.play.disabled = state.status === "loading";
      ui.skip.disabled = true;
      ui.guess.disabled = true;
      showRules(getDailyInProgressText());
      renderSavedDailyProgress();
      return;
    }
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
      if (state.tracks.length) activateMode();
      return;
    }

    animateModeChange();
  }

  // Initial mode selection --------------------------------------------------

  function animateModeChange() {
    const mode = currentMode();
    state.session++;
    setPlaying(false, true);
    cancelProgressTransition();
    ui.fill.style.transition = "transform 250ms ease-out";
    setProgress(ui.now.textContent, mode.initialProgress);
    setTimer("progress", () => {
      resetSession();
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
      !state.tracks.length
    ) return;
    root.classList.remove("awaiting-mode");
    ui.modePrompt.setAttribute("aria-hidden", "true");
    setBackgroundInert(false);
    animateModeChange();
  }

  // Discovery modal ---------------------------------------------------------

  function setDiscoveryHeight() {
    ui.discoveryShell.style.height = `${ui.discoveryPanel.offsetHeight}px`;
  }

  function lockPageScroll() {
    if (state.pageScrollStyles) return;
    const html = document.documentElement;
    const body = document.body;
    state.pageScrollStyles = {
      htmlOverflow: html.style.overflow,
      htmlScrollbarGutter: html.style.scrollbarGutter,
      bodyOverflow: body.style.overflow,
    };
    html.style.scrollbarGutter = "stable";
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
  }

  function unlockPageScroll() {
    if (!state.pageScrollStyles) return;
    const html = document.documentElement;
    const body = document.body;
    html.style.overflow = state.pageScrollStyles.htmlOverflow;
    html.style.scrollbarGutter = state.pageScrollStyles.htmlScrollbarGutter;
    body.style.overflow = state.pageScrollStyles.bodyOverflow;
    state.pageScrollStyles = null;
  }

  function openDiscovery() {
    clearTimer("discovery");
    renderDiscovery();
    state.returnFocus = document.activeElement;
    state.resumeAfterDiscovery = state.status === "playing";
    state.endedDuringDiscovery = false;
    if (state.resumeAfterDiscovery) setPlaying(false, true);
    setBackgroundInert(true);
    ui.headerAction.inert = false;
    lockPageScroll();
    root.classList.add("discovery-open");
    ui.discoveryButton.setAttribute("aria-expanded", "true");
    ui.discoveryModal.setAttribute("aria-hidden", "false");
    ui.discoveryShell.style.height = "0px";
    requestAnimationFrame(() => {
      root.classList.add("discovery-visible");
      setDiscoveryHeight();
      ui.discoveryModal.focus({ preventScroll: true });
    });
  }

  function closeDiscovery() {
    clearTimer("discovery");
    root.classList.remove("discovery-visible");
    ui.discoveryButton.setAttribute("aria-expanded", "false");
    ui.discoveryShell.style.height = `${ui.discoveryShell.offsetHeight}px`;
    void ui.discoveryShell.offsetHeight;
    ui.discoveryShell.style.height = "0px";
    setTimer("discovery", () => {
      root.classList.remove("discovery-open");
      ui.discoveryModal.setAttribute("aria-hidden", "true");
      setBackgroundInert(false);
      unlockPageScroll();
      state.returnFocus?.focus?.({ preventScroll: true });
      const ended = state.endedDuringDiscovery;
      const resume = state.resumeAfterDiscovery;
      state.endedDuringDiscovery = false;
      state.resumeAfterDiscovery = false;
      if (ended) {
        handleTrackEnded();
      } else if (resume && state.track && state.status !== "ended") {
        sendPlayerCommand("playVideo");
        setPlaying(true);
      }
      if (isAwaitingMode() && state.mode && state.tracks.length) activateMode();
    }, transitionDelay(durations.discovery));
  }

  function toggleDiscovery() {
    if (isDiscoveryOpen()) closeDiscovery();
    else openDiscovery();
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
    if (!state.track) {
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
    if (root.classList.contains("discovery-visible")) setDiscoveryHeight();
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

  window.addEventListener("message", handlePlayerMessage);

  ui.yt.addEventListener("load", () => {
    ui.yt.contentWindow?.postMessage('{"event":"listening"}', youtubeOrigin);
  });
  ui.yt.addEventListener("error", handlePlayerError);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.status === "playing") setPlaying(false, true);
  });
  setInterval(() => {
    const date = getBudapestDate();
    if (date === state.dailyDate) return;
    if (state.mode === "daily" && (state.track || isModalOpen())) return;
    state.dailyDate = date;
    if (
      state.mode === "daily" &&
      state.status !== "playing" &&
      !isModalOpen()
    ) resetSession();
  }, 1000);

  function validateTracks(value) {
    if (!Array.isArray(value)) throw new Error("Track catalog is not an array.");
    const titles = new Set();
    const dailyNumbers = new Set();
    const valid = [];
    for (const item of value) {
      const title = typeof item?.title === "string" ? item.title.trim() : "";
      const id = typeof item?.id === "string" ? item.id.trim() : "";
      const duration = Number(item?.duration);
      const spotify = typeof item?.spotify === "string" ? item.spotify.trim() : "";
      const dailyNumber = Number(item?.dailyNumber);
      if (
        !title ||
        titles.has(title) ||
        !/^[\w-]{11}$/.test(id) ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        !Number.isSafeInteger(dailyNumber) ||
        dailyNumber <= 0 ||
        dailyNumbers.has(dailyNumber) ||
        (spotify && !/^[A-Za-z0-9]{22}$/.test(spotify))
      ) continue;
      titles.add(title);
      dailyNumbers.add(dailyNumber);
      valid.push({ title, id, duration, spotify, dailyNumber });
    }
    if (!valid.length) throw new Error("Track catalog has no valid tracks.");
    return valid;
  }

  async function loadTracks() {
    try {
      const response = await fetch(tracksUrl, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Track catalog returned ${response.status}.`);
      state.tracks = validateTracks(await response.json());
      renderDiscovery();
      if (state.mode) activateMode();
      else state.status = "ready";
    } catch (error) {
      console.error("Corzaguessr could not load its track catalog.", error);
      state.status = "error";
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
