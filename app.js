(() => {
  "use strict";

  // Configuration -----------------------------------------------------------

  const root = document.querySelector("#corzaguessr");
  if (!root || root.dataset.corzaguessrReady) return;
  root.dataset.corzaguessrReady = "true";

  const scriptUrl = new URL(document.currentScript?.src || location.href);
  const tracksUrl = new URL("tracks.json", scriptUrl);
  tracksUrl.search = scriptUrl.search;
  const steps = [1, 2, 4, 8, 16, 32];
  const maxTimedClip = 60;
  const maxTimedSlots = 50;
  const storageKey = "corzaguessrDiscoveredV1";
  const personalBestStorageKey = "corzaguessrPersonalBestsV1";
  const dailyStorageKey = "corzaguessrDailyV1";
  const dailyTimeZone = "Europe/Budapest";
  const dailyDoneText = "ALREADY DONE FOR TODAY, COME BACK TOMORROW";
  const hiddenTitle = "???????????????????";
  const youtubeOrigin = "https://www.youtube-nocookie.com";
  const youtubeOrigins = new Set([
    youtubeOrigin,
    "https://www.youtube.com",
  ]);
  const icons = {
    play: "M8 5v14l11-7z",
    pause: "M6 5h4v14H6zM14 5h4v14h-4z",
    stop: "M7 7h10v10H7z",
  };
  const classicRules = {
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
      ...classicRules,
      description: "GUESS THE TRACK IN SIX TRIES AS MORE AUDIO IS REVEALED",
    },
    daily: {
      ...classicRules,
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
          class="button tracklist-button"
          aria-controls="corzaguessr-tracklist"
          aria-expanded="false"
        >TRACKLIST</button>
      </div>
      <div class="modes" aria-label="GAME MODE">
        <button type="button" class="mode daily" aria-pressed="false">DAILY</button>
        <button type="button" class="mode blitz-button" aria-pressed="false">BLITZ</button>
        <button type="button" class="mode classic" aria-pressed="false">CLASSIC</button>
        <button type="button" class="mode survival" aria-pressed="false">SURVIVAL</button>
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
                  <span class="ruleset-text">SELECT A MODE TO BEGIN</span>
                  <span class="ruleset-copy">SELECT A MODE TO BEGIN</span>
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
              aria-describedby="corzaguessr-result-text corzaguessr-result-meta"
              aria-hidden="true"
            >
              <h3 id="corzaguessr-result-title" class="modal-title"></h3>
              <p id="corzaguessr-result-text" class="modal-text"></p>
              <p id="corzaguessr-result-meta" class="result-meta"></p>
              <div class="actions">
                <button type="button" class="button next">NEW GAME</button>
                <button type="button" class="button spotify">SPOTIFY</button>
              </div>
            </div>
          </div>
        </div>
        <p class="mode-prompt" role="status" aria-hidden="false">
          SELECT A MODE TO BEGIN
        </p>
        <div
          id="corzaguessr-tracklist"
          class="tracklist-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="corzaguessr-tracklist-title"
          aria-hidden="true"
        >
          <div class="tracklist-shell">
            <div class="tracklist-panel glass">
              <h3 id="corzaguessr-tracklist-title" class="tracklist-title">
                <span>TRACKS DISCOVERED</span>
                <small>0 / 0</small>
              </h3>
              <div class="tracklist-items"></div>
              <div class="actions">
                <button type="button" class="button tracklist-close">CLOSE</button>
                <button type="button" class="button tracklist-reset">RESET</button>
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
    fill: $(".fill"),
    snippet: $(".snippet"),
    now: $(".now"),
    endtime: $(".endtime"),
    spotify: $(".spotify"),
    next: $(".next"),
    daily: $(".daily"),
    classic: $(".classic"),
    blitz: $(".blitz-button"),
    survival: $(".survival"),
    result: $(".corzaguessr-modal"),
    resultTitle: $(".modal-title"),
    resultText: $(".modal-text"),
    resultMeta: $(".result-meta"),
    modePrompt: $(".mode-prompt"),
    tracklistButton: $(".tracklist-button"),
    tracklistModal: $(".tracklist-modal"),
    tracklistShell: $(".tracklist-shell"),
    tracklistPanel: $(".tracklist-panel"),
    tracklistCount: $(".tracklist-title small"),
    tracklistItems: $(".tracklist-items"),
    tracklistClose: $(".tracklist-close"),
    tracklistReset: $(".tracklist-reset"),
    status: $(".status"),
    yt: $(".yt"),
    icon: $(".icon path"),
  };
  const modeButtons = {
    daily: ui.daily,
    classic: ui.classic,
    blitz: ui.blitz,
    survival: ui.survival,
  };

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
    personalBestBeaten: false,
    daily: loadDaily(),
    dailyDate: getBudapestDate(),
    playerReady: false,
    frame: 0,
    previousTick: 0,
    session: 0,
    activeSuggestion: -1,
    progressTimer: 0,
    slotsTimer: 0,
    resultTimer: 0,
    tracklistTimer: 0,
    returnFocus: null,
    pageScrollStyles: null,
    resumeAfterTracklist: false,
    endedDuringTracklist: false,
  };

  root.classList.add("awaiting-mode", "rules-visible");
  setBackgroundInert(false);

  function formatTime(seconds) {
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds) % 60).padStart(2, "0")}`;
  }

  function getBudapestDate(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: dailyTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
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

  function isResultOpen() {
    return ui.card.classList.contains("modal-open");
  }

  function isTracklistOpen() {
    return root.classList.contains("tracklist-open");
  }

  function isAwaitingMode() {
    return root.classList.contains("awaiting-mode");
  }

  function isModalOpen() {
    return isResultOpen() || isTracklistOpen();
  }

  function transitionDelay(milliseconds) {
    return matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : milliseconds;
  }

  function setBackgroundInert(inert) {
    ui.headerAction.inert = inert;
    ui.modes.inert = inert;
    ui.board.inert = inert || isAwaitingMode();
    ui.slots.inert = inert || isAwaitingMode();
  }

  function setProgress(text, scale) {
    ui.now.textContent = text;
    ui.fill.style.transform = `scaleX(${Math.max(0, Math.min(1, scale))})`;
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
    const saved = readStorage(storageKey, []);
    return new Set(
      Array.isArray(saved)
        ? saved.filter((title) => typeof title === "string")
        : [],
    );
  }

  function saveDiscoveries() {
    writeStorage(
      storageKey,
      [...state.discovered],
      "DISCOVERY PROGRESS COULD NOT BE SAVED IN THIS BROWSER.",
    );
  }

  function validRecord(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  function loadPersonalBests() {
    const saved = readStorage(personalBestStorageKey, {});
    const classicCurrent = validRecord(saved?.classic?.current);
    const classicBest = validRecord(saved?.classic?.best);
    return {
      classic: {
        current: classicCurrent,
        best: Math.max(classicCurrent, classicBest),
      },
      blitz: validRecord(saved?.blitz),
      survival: validRecord(saved?.survival),
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
      saved.step < steps.length
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

  function isDailyDone(date = getBudapestDate()) {
    return state.daily.date === date && state.daily.started;
  }

  function getDailyDoneText() {
    if (state.daily.date === state.dailyDate && state.daily.completed) {
      const attempts = state.daily.step + 1;
      return `COMPLETED IN ${attempts} ATTEMPT${attempts === 1 ? "" : "S"}, COME BACK TOMORROW`;
    }
    return dailyDoneText;
  }

  function markDailyStarted() {
    if (state.mode !== "daily" || isDailyDone(state.dailyDate)) return;
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
      ? modes[state.mode].timed ? "pause" : "stop"
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
    state.progressTimer = setTimeout(() => {
      state.progressTimer = 0;
      ui.fill.style.transition = "";
    }, 300);
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
    const mode = modes[state.mode];

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
          state.elapsed / (steps.at(-1) * 1000) + 0.0025,
        );
        if (state.elapsed >= steps[state.step] * 1000) {
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
    showRules(modes[state.mode].description);
    clearSlots(false);
    addSlot("COULD NOT PLAY TRACK, TRY AGAIN!", "blink");
    announce("THE SELECTED TRACK COULD NOT BE PLAYED. TRY AGAIN.");
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
    ui.rulesetText.textContent = text;
    ui.rulesetCopy.textContent = text;
    ui.ruleset.classList.remove("scroll");
    void ui.ruleset.offsetWidth;
    ui.ruleset.classList.add("scroll");
    root.classList.add("rules-visible");
  }

  function showGuess() {
    root.classList.remove("rules-visible");
    ui.ruleset.classList.remove("scroll");
    ui.guess.disabled = false;
  }

  function clearSlots(animate = true) {
    clearTimeout(state.slotsTimer);
    if (!ui.slots.children.length) return;
    if (!animate || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      ui.slots.replaceChildren();
      ui.slots.style.height = "";
      return;
    }

    ui.play.disabled = true;
    ui.slots.querySelectorAll(".slot").forEach((item) => item.classList.add("fade"));
    ui.slots.style.height = `${ui.slots.offsetHeight}px`;
    void ui.slots.offsetHeight;
    ui.slots.style.height = "0px";
    state.slotsTimer = setTimeout(() => {
      ui.slots.replaceChildren();
      ui.slots.style.height = "";
      ui.play.disabled =
        state.status === "loading" ||
        (modes[state.mode]?.daily && isDailyDone(state.dailyDate));
    }, 250);
  }

  function addSlot(text, style = "", replace = false) {
    const item = replace && ui.slots.firstElementChild
      ? ui.slots.firstElementChild
      : document.createElement("div");
    item.className = `slot ${replace ? "" : "fade"} ${style}`.trim();
    item.textContent = text;
    if (!replace || !item.isConnected) {
      ui.slots.prepend(item);
      if (modes[state.mode].timed) {
        while (ui.slots.children.length > maxTimedSlots) {
          ui.slots.lastElementChild.remove();
        }
      }
      requestAnimationFrame(() => item.classList.remove("fade"));
    }
  }

  function renderPrompt() {
    if (modes[state.mode].timed) {
      addSlot(`GUESS #${state.rounds}`);
      return;
    }

    const seconds = steps[state.step];
    const last = state.step === steps.length - 1;
    ui.endtime.textContent = formatTime(seconds);
    ui.snippet.style.width = `${seconds / steps.at(-1) * 100}%`;
    ui.skip.textContent = last
      ? "GIVE UP"
      : `ADD ${steps[state.step + 1] - seconds}S`;
    addSlot(
      last ? "LAST CHANCE TO GUESS" : `GUESS ${state.step + 1} OUT OF ${steps.length}`,
      last ? "blink" : "",
    );
  }

  function renderTracklist() {
    if (state.status === "loading" && !state.tracks.length) {
      ui.tracklistCount.textContent = "0 / 0";
      ui.tracklistItems.textContent = "LOADING...";
      return;
    }
    const validTitles = new Set(state.tracks.map((track) => track.title));
    const found = [...state.discovered].filter((title) => validTitles.has(title)).length;
    ui.tracklistCount.textContent = `${found} / ${state.tracks.length}`;
    ui.tracklistItems.replaceChildren(...state.tracks.map((track) => {
      const item = document.createElement("div");
      item.className = "tracklist-item";
      const discovered = state.discovered.has(track.title);
      item.textContent = discovered ? track.title : hiddenTitle;
      if (!discovered) item.setAttribute("aria-hidden", "true");
      return item;
    }));
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
    if (modes[state.mode].daily) {
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
    const mode = modes[state.mode];
    const selected = selectTrack();
    const timedSeconds = Math.min(
      Math.ceil(state.time / 1000),
      maxTimedClip,
    );
    const seconds = mode.timed
      ? Math.min(timedSeconds, selected.duration)
      : steps.at(-1);
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
    setPlaying(true);
    loadPlayerTrack(true);
    renderPrompt();
  }

  function togglePlay() {
    if (ui.play.disabled || state.status === "loading" || isModalOpen()) return;
    const mode = modes[state.mode];
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

  function recordDiscovery() {
    if (!state.track || state.discovered.has(state.track.title)) return;
    state.discovered.add(state.track.title);
    saveDiscoveries();
    renderTracklist();
  }

  function renderAttempt(type, title) {
    if (type === "skip") {
      if (modes[state.mode].timed) {
        addSlot("SKIPPED", "skip", true);
      } else {
        const last = state.step === steps.length - 1;
        const added = last ? 0 : steps[state.step + 1] - steps[state.step];
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
    const mode = modes[state.mode];
    if (type !== "skip") state.guesses++;
    if (type === "correct") state.correct++;
    if (mode.survival) {
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

    if (state.step === steps.length - 1) {
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

  function updateClassicStreak(type) {
    if (state.mode !== "classic" || state.step !== 0) return;

    if (type === "correct") {
      state.personalBests.classic.current++;
      if (state.personalBests.classic.current > state.personalBests.classic.best) {
        state.personalBests.classic.best = state.personalBests.classic.current;
        state.personalBestBeaten = true;
      }
      savePersonalBests();
      return;
    }

    if (state.personalBests.classic.current) {
      state.personalBests.classic.current = 0;
      savePersonalBests();
    }
  }

  function attempt(type, title = "") {
    if (!state.track || isModalOpen()) return;
    renderAttempt(type, title);
    if (type === "correct") recordDiscovery();
    updateClassicStreak(type);
    if (modes[state.mode].timed) resolveTimedAttempt(type);
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
    if (!modes[state.mode].timed) setPlaying(false);
    else attempt("skip");
  }

  function updateTimedPersonalBest() {
    if (state.mode === "blitz" && state.correct > state.personalBests.blitz) {
      state.personalBests.blitz = state.correct;
      state.personalBestBeaten = true;
      savePersonalBests();
    } else if (
      state.mode === "survival" &&
      Math.floor(state.elapsed) > state.personalBests.survival
    ) {
      state.personalBests.survival = Math.floor(state.elapsed);
      state.personalBestBeaten = true;
      savePersonalBests();
    }
  }

  function renderResultMeta() {
    const label = state.personalBestBeaten
      ? "NEW PERSONAL BEST"
      : "PERSONAL BEST";

    if (state.mode === "daily") {
      ui.resultMeta.textContent = getDailyDoneText();
    } else if (state.mode === "classic") {
      const { current, best } = state.personalBests.classic;
      ui.resultMeta.textContent = state.personalBestBeaten
        ? `1S STREAK: ${current} · NEW PERSONAL BEST: ${best}`
        : `1S STREAK: ${current} · PERSONAL BEST: ${best}`;
    } else if (state.mode === "blitz") {
      ui.resultMeta.textContent =
        `${label}: ${state.personalBests.blitz} CORRECT`;
    } else {
      ui.resultMeta.textContent =
        `${label}: ${formatTime(state.personalBests.survival / 1000)}`;
    }
  }

  function endGame(won) {
    if (!state.track) return;
    const mode = modes[state.mode];
    if (mode.timed || state.status === "playing") setPlaying(false, true);
    state.status = "ended";
    state.trackStarted = false;
    state.session++;
    ui.play.disabled = true;
    ui.skip.disabled = true;
    ui.guess.disabled = true;
    completeDaily(won);
    updateTimedPersonalBest();

    const mark = won ? "🎉" : "❌";
    ui.resultTitle.innerHTML = mode.timed
      ? '⏱️ <span class="end">TIME IS UP</span> ⏱️'
      : `${mark} <span class="end">${won ? "YOU GOT IT" : "YOU GOT IT ALL WRONG"}</span> ${mark}`;
    const percent = state.guesses
      ? Math.round(state.correct * 100 / state.guesses)
      : 0;
    ui.resultText.textContent = mode.timed
      ? mode.survival
        ? `TIME SURVIVED: ${formatTime(state.elapsed / 1000)}\nGUESSES MADE: ${state.guesses} (${percent}%)`
        : `GUESSES MADE: ${state.guesses}\nCORRECT GUESSES: ${state.correct} (${percent}%)`
      : `THE TRACK WAS\n${state.track.title}`;
    renderResultMeta();

    const hasSpotify = !mode.timed && Boolean(state.track.spotify);
    ui.spotify.style.display = hasSpotify ? "inline-flex" : "none";
    ui.spotify.onclick = hasSpotify
      ? () => window.open(
          `https://open.spotify.com/track/${state.track.spotify}`,
          "_blank",
          "noopener,noreferrer",
        )
      : null;

    openResult();
    announce(
      `${ui.resultText.textContent.replace("\n", ". ")}. ${ui.resultMeta.textContent}`,
    );
  }

  function openResult() {
    clearTimeout(state.resultTimer);
    ui.card.classList.remove("modal-closing");
    const card = ui.card.getBoundingClientRect();
    const board = ui.board.getBoundingClientRect();
    ui.card.style.setProperty("--modal-y", `${board.top - card.top + board.height / 2}px`);
    state.returnFocus = document.activeElement;
    ui.card.classList.add("modal-open");
    ui.result.setAttribute("aria-hidden", "false");
    setBackgroundInert(true);
    requestAnimationFrame(() => {
      ui.card.classList.add("modal-visible");
      ui.next.focus();
    });
  }

  function closeResult() {
    if (!isResultOpen()) return;
    ui.card.classList.add("modal-closing");
    ui.card.classList.remove("modal-visible");
    reset({ keepResultOpen: true });
    state.resultTimer = setTimeout(() => {
      state.resultTimer = 0;
      ui.card.classList.remove("modal-open", "modal-closing");
      ui.result.setAttribute("aria-hidden", "true");
      setBackgroundInert(false);
      ui.play.focus({ preventScroll: true });
    }, transitionDelay(350));
  }

  function cancelProgressTransition() {
    clearTimeout(state.progressTimer);
    state.progressTimer = 0;
    ui.fill.style.transition = "";
  }

  function resetSession({ keepResultOpen = false } = {}) {
    const mode = modes[state.mode];
    if (mode.daily) state.dailyDate = getBudapestDate();
    clearTimeout(state.slotsTimer);
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
      personalBestBeaten: false,
    });
    state.used.clear();
    ui.status.textContent = "";
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
    ui.snippet.style.width = `${100 / steps.at(-1)}%`;
    setProgress(mode.initialText, mode.initialProgress);
    setPlaying(false);
    applyModeAvailability();
  }

  function renderSavedDailyProgress() {
    const seconds = steps[state.daily.step] || steps[0];
    ui.endtime.textContent = formatTime(seconds);
    ui.snippet.style.width = `${seconds / steps.at(-1) * 100}%`;
    setProgress(formatTime(seconds), seconds / steps.at(-1) + 0.0025);
  }

  function applyModeAvailability() {
    const mode = modes[state.mode];
    if (mode.daily && isDailyDone(state.dailyDate)) {
      ui.play.disabled = true;
      ui.skip.disabled = true;
      ui.guess.disabled = true;
      showRules(getDailyDoneText());
      renderSavedDailyProgress();
      return;
    }
    showRules(mode.description);
  }

  function reset(options) {
    clearTimeout(state.resultTimer);
    state.resultTimer = 0;
    cancelProgressTransition();
    resetSession(options);
  }

  function renderModeSelection() {
    const mode = modes[state.mode];
    root.classList.toggle("timed", mode.timed);
    Object.entries(modeButtons).forEach(([name, button]) => {
      const selected = name === state.mode;
      button.disabled = selected;
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function setMode(mode) {
    if (!modes[mode] || (!isAwaitingMode() && state.mode === mode)) return;
    state.mode = mode;
    renderModeSelection();
    const message = modes[mode].daily && isDailyDone()
      ? getDailyDoneText()
      : modes[mode].description;
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
    const mode = modes[state.mode];
    state.session++;
    setPlaying(false, true);
    cancelProgressTransition();
    ui.fill.style.transition = "transform 250ms ease-out";
    setProgress(ui.now.textContent, mode.initialProgress);
    state.progressTimer = setTimeout(() => {
      state.progressTimer = 0;
      resetSession();
      state.progressTimer = setTimeout(() => {
        state.progressTimer = 0;
        ui.fill.style.transition = "";
      }, 300);
    }, 120);
  }

  function activateMode() {
    if (
      !isAwaitingMode() ||
      isTracklistOpen() ||
      !state.mode ||
      !state.tracks.length
    ) return;
    root.classList.remove("awaiting-mode");
    ui.modePrompt.setAttribute("aria-hidden", "true");
    setBackgroundInert(false);
    animateModeChange();
  }

  // Tracklist modal ---------------------------------------------------------

  function setTracklistHeight() {
    ui.tracklistShell.style.height = `${ui.tracklistPanel.offsetHeight}px`;
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

  function openTracklist() {
    clearTimeout(state.tracklistTimer);
    renderTracklist();
    state.returnFocus = document.activeElement;
    state.resumeAfterTracklist = state.status === "playing";
    state.endedDuringTracklist = false;
    if (state.resumeAfterTracklist) setPlaying(false, true);
    setBackgroundInert(true);
    ui.headerAction.inert = false;
    lockPageScroll();
    root.classList.add("tracklist-open");
    ui.tracklistButton.setAttribute("aria-expanded", "true");
    ui.tracklistModal.setAttribute("aria-hidden", "false");
    ui.tracklistShell.style.height = "0px";
    requestAnimationFrame(() => {
      root.classList.add("tracklist-visible");
      setTracklistHeight();
      ui.tracklistClose.focus({ preventScroll: true });
    });
  }

  function closeTracklist() {
    clearTimeout(state.tracklistTimer);
    root.classList.remove("tracklist-visible");
    ui.tracklistButton.setAttribute("aria-expanded", "false");
    ui.tracklistShell.style.height = `${ui.tracklistShell.offsetHeight}px`;
    void ui.tracklistShell.offsetHeight;
    ui.tracklistShell.style.height = "0px";
    state.tracklistTimer = setTimeout(() => {
      root.classList.remove("tracklist-open");
      ui.tracklistModal.setAttribute("aria-hidden", "true");
      setBackgroundInert(false);
      unlockPageScroll();
      state.returnFocus?.focus?.({ preventScroll: true });
      const ended = state.endedDuringTracklist;
      const resume = state.resumeAfterTracklist;
      state.endedDuringTracklist = false;
      state.resumeAfterTracklist = false;
      if (ended) {
        handleTrackEnded();
      } else if (resume && state.track && state.status !== "ended") {
        sendPlayerCommand("playVideo");
        setPlaying(true);
      }
      if (isAwaitingMode() && state.mode && state.tracks.length) activateMode();
    }, transitionDelay(450));
  }

  function toggleTracklist() {
    if (isTracklistOpen()) closeTracklist();
    else openTracklist();
  }

  function resetTracklist() {
    if (!window.confirm("RESET DISCOVERED TRACKS?")) return;
    state.discovered.clear();
    saveDiscoveries();
    renderTracklist();
    announce("DISCOVERED TRACKS RESET.");
  }

  function trapFocus(event, container) {
    if (event.key !== "Tab") return;
    const focusable = [...container.querySelectorAll("button:not([disabled]), input:not([disabled])")]
      .filter((element) => !element.hidden && element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
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
      togglePlay();
      return;
    }
    const active = ui.suggest.querySelector(".active");
    if (active) makeGuess(active.dataset.title);
    else if (!ui.guess.value.trim()) togglePlay();
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
  Object.entries(modeButtons).forEach(([name, button]) => {
    button.addEventListener("click", () => setMode(name));
  });
  ui.tracklistButton.addEventListener("click", toggleTracklist);
  ui.tracklistClose.addEventListener("click", closeTracklist);
  ui.tracklistReset.addEventListener("click", resetTracklist);
  ui.tracklistModal.addEventListener("click", (event) => {
    if (!event.target.closest(".tracklist-panel")) closeTracklist();
  });

  new ResizeObserver(() => {
    if (root.classList.contains("tracklist-visible")) setTracklistHeight();
  }).observe(ui.tracklistPanel);

  root.addEventListener("keydown", (event) => {
    if (isTracklistOpen()) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeTracklist();
      } else {
        trapFocus(event, ui.tracklistPanel);
      }
      return;
    }
    if (isResultOpen()) {
      trapFocus(event, ui.result);
      if (event.key === "Enter" && document.activeElement !== ui.spotify) {
        event.preventDefault();
        closeResult();
      }
    }
  }, true);

  root.addEventListener("pointerdown", (event) => {
    if (
      ui.guess.disabled ||
      isModalOpen() ||
      event.target.closest("button, input, .suggest")
    ) return;
    focusGuess();
  });

  window.addEventListener("message", (event) => {
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
    } else if (data.event === "onStateChange" && data.info === 1) {
      if (!state.track || isModalOpen() || state.status === "ended") return;
      markDailyStarted();
      state.trackStarted = true;
      ui.skip.disabled = false;
      setPlaying(true);
      startClock();
    } else if (data.event === "onStateChange" && data.info === 3) {
      cancelClock();
    } else if (
      data.event === "onStateChange" &&
      data.info === 0 &&
      state.track &&
      state.trackStarted &&
      state.status !== "ended"
    ) {
      if (isTracklistOpen()) state.endedDuringTracklist = true;
      else handleTrackEnded();
    } else if (data.event === "onError") {
      handlePlayerError();
    }
  });

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

  fetch(tracksUrl, { headers: { Accept: "application/json" } })
    .then((response) => {
      if (!response.ok) throw new Error(`Track catalog returned ${response.status}.`);
      return response.json();
    })
    .then((tracks) => {
      state.tracks = validateTracks(tracks);
      renderTracklist();
      if (state.mode) activateMode();
      else state.status = "ready";
    })
    .catch((error) => {
      console.error("Corzaguessr could not load its track catalog.", error);
      state.status = "error";
      ui.play.disabled = true;
      ui.skip.disabled = true;
      ui.guess.disabled = true;
      ui.daily.disabled = true;
      ui.classic.disabled = true;
      ui.blitz.disabled = true;
      ui.survival.disabled = true;
      ui.modePrompt.textContent = "COULD NOT LOAD TRACKLIST, PLEASE REFRESH!";
      root.classList.add("mode-error");
      announce("COULD NOT LOAD THE TRACKLIST. PLEASE REFRESH.");
    });
})();
