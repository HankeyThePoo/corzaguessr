(() => {
  "use strict";

  // Configuration -----------------------------------------------------------

  const root = document.querySelector("#corzaguessr");
  if (!root || root.dataset.corzaguessrReady) return;
  root.dataset.corzaguessrReady = "true";

  const scriptUrl = document.currentScript?.src || location.href;
  const tracksUrl = new URL("tracks.json", scriptUrl).href;
  const steps = [1, 2, 4, 8, 16, 32];
  const storageKey = "corzaguessrDiscoveredV1";
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
  const modes = {
    classic: { initialTime: 60000, endTime: "0:01", skip: "ADD 1s" },
    blitz: { initialTime: 60000, endTime: "1:00", skip: "SKIP" },
    survival: { initialTime: 30000, endTime: "0:30", skip: "SKIP" },
  };

  root.innerHTML = `
    <div class="wrap">
      <h1>CORZAGUESSR&#10022;</h1>
      <div class="row header-action">
        <button type="button" class="button tracklist-button">TRACKLIST</button>
      </div>
      <div class="modes" aria-label="Game mode">
        <button type="button" class="mode blitz-button" aria-pressed="false">BLITZ</button>
        <button type="button" class="mode classic" aria-pressed="true" disabled>CLASSIC</button>
        <button type="button" class="mode survival" aria-pressed="false">SURVIVAL</button>
      </div>
      <div class="card glass">
        <div class="stack">
          <div class="board">
            <div class="controls">
              <div class="time"><span class="now">0:00</span></div>
              <button type="button" class="play" aria-label="Play" disabled>
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
              <label class="sr-only" for="corzaguessr-guess">Search for a track</label>
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
              <div
                id="corzaguessr-suggestions"
                class="suggest"
                role="listbox"
              ></div>
            </div>
            <div class="row">
              <button type="button" class="button skip" disabled>ADD 1s</button>
            </div>
          </div>
          <div class="slots" aria-live="polite" aria-relevant="additions text"></div>
        </div>
        <div
          class="corzaguessr-modal glass"
          role="dialog"
          aria-modal="true"
          aria-labelledby="corzaguessr-result-title"
          aria-describedby="corzaguessr-result-text"
          aria-hidden="true"
        >
          <h3 id="corzaguessr-result-title" class="modal-title"></h3>
          <p id="corzaguessr-result-text" class="modal-text"></p>
          <div class="actions">
            <button type="button" class="button next">NEW GAME</button>
            <button type="button" class="button spotify">SPOTIFY</button>
          </div>
        </div>
        <div
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
      title="Corzaguessr audio player"
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
    fill: $(".fill"),
    snippet: $(".snippet"),
    now: $(".now"),
    endtime: $(".endtime"),
    spotify: $(".spotify"),
    next: $(".next"),
    classic: $(".classic"),
    blitz: $(".blitz-button"),
    survival: $(".survival"),
    result: $(".corzaguessr-modal"),
    resultTitle: $(".modal-title"),
    resultText: $(".modal-text"),
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

  // State and small utilities -----------------------------------------------

  const state = {
    mode: "classic",
    status: "loading",
    tracks: [],
    track: null,
    previousTrack: null,
    step: 0,
    elapsed: 0,
    time: modes.classic.initialTime,
    maxTime: modes.survival.initialTime,
    guesses: 0,
    correct: 0,
    used: new Set(),
    discovered: loadDiscoveries(),
    playerReady: false,
    frame: 0,
    previousTick: 0,
    session: 0,
    activeSuggestion: -1,
    fillTimer: 0,
    slotsTimer: 0,
    tracklistTimer: 0,
    returnFocus: null,
  };

  function formatTime(seconds) {
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds) % 60).padStart(2, "0")}`;
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

  function isModalOpen() {
    return isResultOpen() || isTracklistOpen();
  }

  function setBackgroundInert(inert) {
    ui.headerAction.inert = inert;
    ui.modes.inert = inert;
    ui.board.inert = inert;
    ui.slots.inert = inert;
  }

  function setProgress(text, scale) {
    ui.now.textContent = text;
    ui.fill.style.transform = `scaleX(${Math.max(0, Math.min(1, scale))})`;
  }

  function loadDiscoveries() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return new Set(Array.isArray(saved) ? saved.filter((title) => typeof title === "string") : []);
    } catch {
      return new Set();
    }
  }

  function saveDiscoveries() {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...state.discovered]));
    } catch {
      announce("Discovery progress could not be saved in this browser.");
    }
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
      ? state.mode === "classic" ? "stop" : "pause"
      : "play";
    ui.icon.setAttribute("d", icons[icon]);
    ui.play.setAttribute("aria-label", icon === "play" ? "Play" : icon === "pause" ? "Pause" : "Stop");
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
    clearTimeout(state.fillTimer);
    ui.fill.style.transition = "transform 250ms ease-out";
    setProgress("0:00", 0);
    state.fillTimer = setTimeout(() => {
      ui.fill.style.transition = "";
    }, 300);
  }

  function startClassic() {
    if (!state.track) return;
    rewindClassic();
    state.elapsed = 0;
    setPlaying(true);
    loadPlayerTrack(true);
    focusGuess();
  }

  function startClock() {
    if (state.frame || state.status !== "playing") return;
    const session = state.session;

    const tick = (now) => {
      if (session !== state.session || state.status !== "playing") {
        cancelClock();
        return;
      }

      state.previousTick ||= now;
      const delta = Math.min(now - state.previousTick, 250);
      state.previousTick = now;

      if (state.mode === "classic") {
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
        const survival = state.mode === "survival";
        if (survival) state.elapsed += delta;
        state.time = Math.max(0, state.time - delta);
        if (survival) ui.endtime.textContent = formatTime(Math.ceil(state.time / 1000));
        setProgress(
          formatTime((survival ? state.elapsed : state.time) / 1000),
          state.time / (survival ? state.maxTime : modes.blitz.initialTime),
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
    ui.skip.disabled = true;
    clearSlots(false);
    addSlot("COULD NOT PLAY TRACK, TRY AGAIN!", "blink");
    announce("The selected track could not be played. Try again.");
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
      ui.play.disabled = state.status === "loading";
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
      requestAnimationFrame(() => item.classList.remove("fade"));
    }
  }

  function renderPrompt() {
    if (state.mode !== "classic") {
      addSlot(`GUESS #${ui.slots.children.length + 1}`);
      return;
    }

    const seconds = steps[state.step];
    const last = state.step === steps.length - 1;
    ui.endtime.textContent = formatTime(seconds);
    ui.snippet.style.width = `${seconds / steps.at(-1) * 100}%`;
    ui.skip.textContent = last
      ? "GIVE UP"
      : `ADD ${steps[state.step + 1] - seconds}s`;
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
    const pool = state.tracks.length > 1
      ? state.tracks.filter((track) => track !== state.previousTrack)
      : state.tracks;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function startRound() {
    if (!state.tracks.length) return;
    const selected = selectTrack();
    const seconds = state.mode === "classic"
      ? steps.at(-1)
      : Math.min(Math.ceil(state.time / 1000), selected.duration);
    const available = Math.max(0, Math.floor(selected.duration - seconds));

    state.previousTrack = selected;
    state.track = {
      ...selected,
      at: Math.floor(Math.random() * (available + 1)),
    };
    state.used.clear();
    state.session++;
    setPlaying(true);
    loadPlayerTrack(true);
    renderPrompt();
  }

  function togglePlay() {
    if (ui.play.disabled || state.status === "loading" || isModalOpen()) return;
    if (!state.track) {
      ui.skip.disabled = false;
      startRound();
    } else if (state.status === "playing") {
      setPlaying(false, true);
      if (state.mode === "classic") rewindClassic();
    } else if (state.mode === "classic") {
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

  function attempt(type, title = "") {
    if (!state.track || isModalOpen()) return;

    if (type === "skip") {
      if (state.mode !== "classic") {
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

    if (type === "correct") recordDiscovery();

    if (state.mode !== "classic") {
      if (type !== "skip") state.guesses++;
      if (type === "correct") state.correct++;
      if (state.mode === "survival") {
        const change = type === "correct" ? 3000 : type === "wrong" ? -1000 : -2000;
        state.time = Math.max(0, state.time + change);
        state.maxTime = Math.max(state.maxTime, state.time);
        ui.endtime.textContent = formatTime(Math.ceil(state.time / 1000));
        setProgress(formatTime(state.elapsed / 1000), state.time / state.maxTime);
      }
      setPlaying(false);
      announce(type === "correct" ? "Correct." : type === "wrong" ? "Incorrect." : "Skipped.");
      if (!state.time) {
        endGame();
      } else {
        startRound();
      }
      return;
    }

    if (type === "correct") {
      endGame(true);
      return;
    }

    if (state.step === steps.length - 1) {
      endGame(false);
      return;
    }

    state.step++;
    renderPrompt();
    announce(type === "wrong" ? "Incorrect. Try again." : "Skipped. More time added.");
    if (state.status !== "playing") {
      if (type === "skip") startClassic();
      else togglePlay();
    }
  }

  function makeGuess(title = ui.guess.value.trim()) {
    if (!title || !state.track) return;
    state.used.add(title);
    attempt(title === state.track.title ? "correct" : "wrong", title);
  }

  function endGame(won) {
    if (!state.track) return;
    if (state.mode !== "classic" || state.status === "playing") setPlaying(false, true);
    state.status = "ended";
    state.session++;
    ui.play.disabled = true;
    ui.skip.disabled = true;
    ui.guess.disabled = true;

    const timed = state.mode !== "classic";
    const mark = won ? "🎉" : "❌";
    ui.resultTitle.innerHTML = timed
      ? '⏱️ <span class="end">TIME IS UP</span> ⏱️'
      : `${mark} <span class="end">${won ? "YOU GOT IT" : "YOU GOT IT ALL WRONG"}</span> ${mark}`;
    const percent = state.guesses
      ? Math.round(state.correct * 100 / state.guesses)
      : 0;
    ui.resultText.textContent = timed
      ? state.mode === "survival"
        ? `TIME SURVIVED: ${formatTime(state.elapsed / 1000)}\nGUESSES MADE: ${state.guesses} (${percent}%)`
        : `GUESSES MADE: ${state.guesses}\nCORRECT GUESSES: ${state.correct} (${percent}%)`
      : `THE TRACK WAS\n${state.track.title}`;

    const hasSpotify = !timed && Boolean(state.track.spotify);
    ui.spotify.style.display = hasSpotify ? "inline-flex" : "none";
    ui.spotify.onclick = hasSpotify
      ? () => window.open(
          `https://open.spotify.com/track/${state.track.spotify}`,
          "_blank",
          "noopener,noreferrer",
        )
      : null;

    const card = ui.card.getBoundingClientRect();
    const board = ui.board.getBoundingClientRect();
    ui.card.style.setProperty("--modal-y", `${board.top - card.top + board.height / 2}px`);
    state.returnFocus = document.activeElement;
    ui.card.classList.add("modal-open");
    ui.result.setAttribute("aria-hidden", "false");
    setBackgroundInert(true);
    requestAnimationFrame(() => ui.next.focus());
    announce(ui.resultText.textContent.replace("\n", ". "));
  }

  function reset(keepFillTransition = false) {
    clearTimeout(state.fillTimer);
    clearTimeout(state.slotsTimer);
    state.session++;
    cancelClock();
    if (!keepFillTransition) ui.fill.style.transition = "";
    if (state.track) sendPlayerCommand("pauseVideo");

    Object.assign(state, {
      status: "idle",
      track: null,
      step: 0,
      elapsed: 0,
      time: modes[state.mode].initialTime,
      maxTime: modes.survival.initialTime,
      guesses: 0,
      correct: 0,
      activeSuggestion: -1,
    });
    state.used.clear();
    clearGuess();
    ui.status.textContent = "";
    ui.card.classList.remove("modal-open");
    ui.result.setAttribute("aria-hidden", "true");
    setBackgroundInert(false);
    ui.play.disabled = false;
    ui.guess.disabled = false;
    ui.skip.disabled = true;
    clearSlots();

    const timed = state.mode !== "classic";
    const survival = state.mode === "survival";
    ui.endtime.textContent = modes[state.mode].endTime;
    ui.skip.textContent = modes[state.mode].skip;
    ui.snippet.style.width = `${100 / steps.at(-1)}%`;
    setProgress(survival ? "0:00" : timed ? "1:00" : "0:00", timed ? 1 : 0);
    setPlaying(false);
    focusGuess();
  }

  function setMode(mode) {
    if (state.mode === mode || !modes[mode]) return;
    state.mode = mode;
    root.classList.toggle("timed", mode !== "classic");
    ui.classic.disabled = mode === "classic";
    ui.blitz.disabled = mode === "blitz";
    ui.survival.disabled = mode === "survival";
    ui.classic.setAttribute("aria-pressed", String(mode === "classic"));
    ui.blitz.setAttribute("aria-pressed", String(mode === "blitz"));
    ui.survival.setAttribute("aria-pressed", String(mode === "survival"));

    state.session++;
    setPlaying(false, true);
    clearTimeout(state.fillTimer);
    ui.fill.style.transition = "transform 250ms ease-out";
    setProgress(ui.now.textContent, 1);
    state.fillTimer = setTimeout(() => {
      reset(true);
      state.fillTimer = setTimeout(() => {
        ui.fill.style.transition = "";
      }, 300);
    }, 120);
  }

  // Tracklist modal ---------------------------------------------------------

  function setTracklistHeight() {
    ui.tracklistShell.style.height = `${ui.tracklistPanel.offsetHeight}px`;
  }

  function openTracklist() {
    clearTimeout(state.tracklistTimer);
    renderTracklist();
    state.returnFocus = document.activeElement;
    setBackgroundInert(true);
    root.classList.add("tracklist-open");
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
    ui.tracklistShell.style.height = `${ui.tracklistShell.offsetHeight}px`;
    void ui.tracklistShell.offsetHeight;
    ui.tracklistShell.style.height = "0px";
    state.tracklistTimer = setTimeout(() => {
      root.classList.remove("tracklist-open");
      ui.tracklistModal.setAttribute("aria-hidden", "true");
      setBackgroundInert(false);
      state.returnFocus?.focus?.({ preventScroll: true });
    }, 450);
  }

  function resetTracklist() {
    if (!window.confirm("Reset discovered tracks?")) return;
    state.discovered.clear();
    saveDiscoveries();
    renderTracklist();
    announce("Discovered tracks reset.");
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
  ui.next.addEventListener("click", () => reset());
  ui.classic.addEventListener("click", () => setMode("classic"));
  ui.blitz.addEventListener("click", () => setMode("blitz"));
  ui.survival.addEventListener("click", () => setMode("survival"));
  ui.tracklistButton.addEventListener("click", openTracklist);
  ui.tracklistClose.addEventListener("click", closeTracklist);
  ui.tracklistReset.addEventListener("click", resetTracklist);
  ui.tracklistModal.addEventListener("click", (event) => {
    if (!event.target.closest(".tracklist-panel")) closeTracklist();
  });

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
        reset();
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
      setPlaying(true);
      startClock();
      focusGuess();
    } else if (data.event === "onStateChange" && data.info === 3) {
      cancelClock();
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

  function validateTracks(value) {
    if (!Array.isArray(value)) throw new Error("Track catalog is not an array.");
    const titles = new Set();
    const valid = [];
    for (const item of value) {
      const title = typeof item?.title === "string" ? item.title.trim() : "";
      const id = typeof item?.id === "string" ? item.id.trim() : "";
      const duration = Number(item?.duration);
      const spotify = typeof item?.spotify === "string" ? item.spotify.trim() : "";
      if (
        !title ||
        titles.has(title) ||
        !/^[\w-]{11}$/.test(id) ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        (spotify && !/^[A-Za-z0-9]{22}$/.test(spotify))
      ) continue;
      titles.add(title);
      valid.push({ title, id, duration, spotify });
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
      reset();
    })
    .catch((error) => {
      console.error("Corzaguessr could not load its track catalog.", error);
      state.status = "error";
      ui.play.disabled = true;
      ui.skip.disabled = true;
      ui.guess.disabled = true;
      addSlot("COULD NOT LOAD TRACKLIST, PLEASE REFRESH!", "blink");
      announce("Could not load the tracklist. Please refresh.");
    });
})();
