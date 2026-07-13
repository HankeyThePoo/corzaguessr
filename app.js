// @ts-check
(function installCorzaguessrEngine(globalScope, factory) {
  "use strict";

  const api = factory();
  if (globalScope && typeof globalScope === "object") {
    const scope = /** @type {any} */ (globalScope);
    scope.CorzaguessrEngine = api;
    const hook = scope.__CORZAGUESSR_TEST__;
    if (hook === true) scope.__CORZAGUESSR_TEST__ = { engine: api };
    else if (hook && typeof hook === "object") hook.engine = api;
  }
})(typeof globalThis === "object" ? globalThis : this, function createEngineApi() {
  "use strict";

  const SNIPPET_DURATIONS = Object.freeze([1, 2, 4, 8, 16, 32]);
  const MAX_TIMED_HISTORY = 50;
  const MINIMUM_TIMED_REMAINING_SECONDS = 60;
  const HIDDEN_TITLE = "????????????????????";
  const STORAGE_KEYS = Object.freeze({
    discoveries: "corzaguessrDiscoveredV2",
    daily: "corzaguessrDailyV2",
    personalBests: "corzaguessrPersonalBestsV2",
  });
  const APP_STATUSES = Object.freeze(["loading", "awaiting-mode", "ready", "error"]);
  const SESSION_STATUSES = Object.freeze(["idle", "preparing", "active", "paused", "audio-retry", "result"]);
  const OVERLAY_KINDS = Object.freeze(["result", "discovery"]);
  const OVERLAY_PHASES = Object.freeze(["closed", "opening", "open", "closing"]);
  const MODE_NAMES = Object.freeze(["classic", "daily", "blitz", "survival"]);

  const TEXT = Object.freeze({
    modePrompt: "SELECT A MODE TO BEGIN",
    loadingCatalog: "LOADING TRACKLIST...",
    catalogError: "COULD NOT LOAD THE TRACKLIST, RETRYING...",
    loadingTrack: "LOADING TRACK...",
    trackError: "COULD NOT PLAY TRACK, PRESS PLAY TO RETRY!",
    dailyTrackError: "COULD NOT LOAD TODAY'S TRACK, PRESS PLAY TO RETRY!",
    dailyCatalogLoading: "LOADING TODAY'S TRACK...",
    dailyCatalogError: "COULD NOT REFRESH TODAY'S TRACK, RETRYING...",
    dailyDone: "ALREADY DONE FOR TODAY, COME BACK TOMORROW",
    discovery: "REVEAL TRACKS YOU'VE GUESSED CORRECTLY AND TRACK YOUR DISCOVERY PROGRESS",
  });

  /** @typedef {"classic"|"daily"|"blitz"|"survival"} ModeName */
  /** @typedef {"loading"|"awaiting-mode"|"ready"|"error"} AppStatus */
  /** @typedef {"idle"|"preparing"|"active"|"paused"|"audio-retry"|"result"} SessionStatus */
  /** @typedef {"keyboard"|"pointer-fine"|"pointer-coarse"} InputModality */
  /** @typedef {"correct"|"wrong"|"skip"} AttemptKind */
  /** @typedef {Record<string, any>} GameState */

  /**
   * @typedef {Object} InitialStateOptions
   * @property {string} [date]
   * @property {number} [seed]
   * @property {{discoveriesV2?:unknown, dailyV2?:unknown, personalBestsV2?:unknown}} [persistence]
   * @property {InputModality} [modality]
   */

  /**
   * @typedef {Object} Track
   * @property {string} title
   * @property {number} duration
   * @property {string} spotify
   * @property {number} dailyNumber
   * @property {string} dailyFrom
   * @property {boolean} isNew
   */

  /**
   * @typedef {Object} Round
   * @property {number} id
   * @property {number} sessionId
   * @property {number} audioGeneration
   * @property {ModeName} modeName
   * @property {number} catalogVersion
   * @property {string|null} roundDate
   * @property {boolean} prepared
   * @property {boolean} hasPlayed
   * @property {number} ordinal Stable logical round number; candidate retries share it.
   * @property {Track & {at:number}} track
   */

  /* Named action records keep the discriminants parseable by TypeScript's
   * checkJs JSDoc parser and make adapter ownership explicit. */
  /** @typedef {{type:"APP/BOOTSTRAP", date:string}} AppBootstrapAction */
  /** @typedef {{type:"ENV/DATE_CHANGED", date:string}} EnvironmentDateChangedAction */
  /** @typedef {{type:"ENV/VISIBILITY_HIDDEN", atMs?:number}} EnvironmentVisibilityHiddenAction */
  /** @typedef {{type:"CATALOG/REQUEST", date?:string}} CatalogRequestAction */
  /** @typedef {{type:"CATALOG/SUCCEEDED", requestId:number, date:string, tracks:unknown}} CatalogSucceededAction */
  /** @typedef {{type:"CATALOG/FAILED", requestId:number, date:string, error?:string}} CatalogFailedAction */
  /** @typedef {{type:"CATALOG/RETRY_DUE", requestId:number, date:string}} CatalogRetryDueAction */
  /** @typedef {{type:"PERSISTENCE/LOADED", discoveriesV2?:unknown, dailyV2?:unknown, personalBestsV2?:unknown}} PersistenceLoadedAction */
  /** @typedef {{type:"PERSISTENCE/WRITE_SUCCEEDED", requestId:number}} PersistenceWriteSucceededAction */
  /** @typedef {{type:"PERSISTENCE/WRITE_FAILED", requestId:number, error?:string}} PersistenceWriteFailedAction */
  /** @typedef {{type:"PLAYER/SELECT_MODE", mode:ModeName}} PlayerSelectModeAction */
  /** @typedef {{type:"PLAYER/NEW_GAME"}} PlayerNewGameAction */
  /** @typedef {{type:"PLAYER/PLAY", atMs?:number}} PlayerPlayAction */
  /** @typedef {{type:"PLAYER/PLAYBACK_SHORTCUT", atMs?:number}} PlayerPlaybackShortcutAction */
  /** @typedef {{type:"PLAYER/SKIP", atMs?:number}} PlayerSkipAction */
  /** @typedef {{type:"PLAYER/GUESS", title:string, atMs?:number}} PlayerGuessAction */
  /** @typedef {{type:"PLAYER/QUERY_CHANGED", query:string}} PlayerQueryChangedAction */
  /** @typedef {{type:"PLAYER/SUGGESTION_CHANGED", index:number}} PlayerSuggestionChangedAction */
  /** @typedef {{type:"INPUT/MODALITY_CHANGED", modality:InputModality}} InputModalityChangedAction */
  /** @typedef {{type:"PREVIEW/SET", kind:"mode"|"discovery", mode?:ModeName}} PreviewSetAction */
  /** @typedef {{type:"PREVIEW/CLEAR"}} PreviewClearAction */
  /** @typedef {{type:"AUDIO/PREPARED", sessionId:number, roundId:number, audioGeneration:number, role?:"active"|"standby"}} AudioPreparedAction */
  /** @typedef {{type:"AUDIO/PLAYING", sessionId:number, roundId:number, audioGeneration:number, atMs?:number}} AudioPlayingAction */
  /** @typedef {{type:"AUDIO/WAITING", sessionId:number, roundId:number, audioGeneration:number, atMs?:number}} AudioWaitingAction */
  /** @typedef {{type:"AUDIO/ENDED", sessionId:number, roundId:number, audioGeneration:number, atMs?:number}} AudioEndedAction */
  /** @typedef {{type:"AUDIO/BLOCKED", sessionId:number, roundId:number, audioGeneration:number, atMs?:number}} AudioBlockedAction */
  /** @typedef {{type:"AUDIO/FAILED", sessionId:number, roundId:number, audioGeneration:number, role?:"active"|"standby", error?:string, atMs?:number}} AudioFailedAction */
  /** @typedef {{type:"CLOCK/EXPIRED", sessionId:number, generation:number, atMs?:number}} ClockExpiredAction */
  /** @typedef {{type:"CLOCK/RESYNCHRONIZED", sessionId:number, generation:number, atMs:number}} ClockResynchronizedAction */
  /** @typedef {{type:"OVERLAY/OPEN_REQUESTED", kind:"result"|"discovery", returnFocus?:string|null, atMs?:number}} OverlayOpenRequestedAction */
  /** @typedef {{type:"OVERLAY/CLOSE_REQUESTED", kind?:"result"|"discovery"}} OverlayCloseRequestedAction */
  /** @typedef {{type:"OVERLAY/TRANSITION_COMPLETED", kind:"result"|"discovery", phase:"opening"|"closing", generation:number}} OverlayTransitionCompletedAction */
  /** @typedef {{type:"DISCOVERY/RESET"}} DiscoveryResetAction */
  /** @typedef {AppBootstrapAction|EnvironmentDateChangedAction|EnvironmentVisibilityHiddenAction|CatalogRequestAction|CatalogSucceededAction|CatalogFailedAction|CatalogRetryDueAction|PersistenceLoadedAction|PersistenceWriteSucceededAction|PersistenceWriteFailedAction|PlayerSelectModeAction|PlayerNewGameAction|PlayerPlayAction|PlayerPlaybackShortcutAction|PlayerSkipAction|PlayerGuessAction|PlayerQueryChangedAction|PlayerSuggestionChangedAction|InputModalityChangedAction|PreviewSetAction|PreviewClearAction|AudioPreparedAction|AudioPlayingAction|AudioWaitingAction|AudioEndedAction|AudioBlockedAction|AudioFailedAction|ClockExpiredAction|ClockResynchronizedAction|OverlayOpenRequestedAction|OverlayCloseRequestedAction|OverlayTransitionCompletedAction|DiscoveryResetAction} Action */

  /** @typedef {{discoveries:string, daily:string, personalBests:string}} StorageKeys */
  /** @typedef {{type:"CATALOG_FETCH", requestId:number, date:string}} CatalogFetchEffect */
  /** @typedef {{type:"CATALOG_RETRY_SCHEDULE", requestId:number, date:string, delayMs:number}} CatalogRetryScheduleEffect */
  /** @typedef {{type:"STORAGE_LOAD", keys:StorageKeys}} StorageLoadEffect */
  /** @typedef {{type:"STORAGE_WRITE", requestId:number, key:string, value:unknown}} StorageWriteEffect */
  /** @typedef {{type:"AUDIO_RESET", sessionId:number}} AudioResetEffect */
  /** @typedef {{type:"AUDIO_PREPARE", role:"active"|"standby", round:Round}} AudioPrepareEffect */
  /** @typedef {{type:"AUDIO_PROMOTE_AND_PLAY", round:Round}} AudioPromoteAndPlayEffect */
  /** @typedef {{type:"AUDIO_PLAY", round:Round, rewind:boolean}} AudioPlayEffect */
  /** @typedef {{type:"AUDIO_PAUSE", sessionId:number, roundId:number|null}} AudioPauseEffect */
  /** @typedef {{type:"AUDIO_RELEASE", sessionId:number, roundId:number|null}} AudioReleaseEffect */
  /** @typedef {{type:"AUDIO_DISCARD_STANDBY", sessionId:number, roundId:number, audioGeneration:number}} AudioDiscardStandbyEffect */
  /** @typedef {{type:"AUDIO_SUSPEND", round:Round}} AudioSuspendEffect */
  /** @typedef {{type:"AUDIO_RESTORE", round:Round}} AudioRestoreEffect */
  /** @typedef {{type:"CLOCK_CANCEL", sessionId:number, generation:number}} ClockCancelEffect */
  /** @typedef {{type:"CLOCK_SCHEDULE", sessionId:number, generation:number, anchorMs:number, remainingMs:number}} ClockScheduleEffect */
  /** @typedef {{type:"ANNOUNCE", message:string}} AnnounceEffect */
  /** @typedef {{type:"FEEDBACK_FLASH", sessionId:number, amountSeconds:number}} FeedbackFlashEffect */
  /** @typedef {{type:"FOCUS", target:"play"|"guess", modality:InputModality, sessionId:number, roundId:number|null}} FocusEffect */
  /** @typedef {{type:"OVERLAY_SYNC", kind:"result"|"discovery", phase:"opening"|"closing", generation:number, returnFocus:string|null}} OverlaySyncEffect */
  /** @typedef {CatalogFetchEffect|CatalogRetryScheduleEffect|StorageLoadEffect|StorageWriteEffect|AudioResetEffect|AudioPrepareEffect|AudioPromoteAndPlayEffect|AudioPlayEffect|AudioPauseEffect|AudioReleaseEffect|AudioDiscardStandbyEffect|AudioSuspendEffect|AudioRestoreEffect|ClockCancelEffect|ClockScheduleEffect|AnnounceEffect|FeedbackFlashEffect|FocusEffect|OverlaySyncEffect} Effect */

  /** @type {Record<string, {timed:boolean, daily:boolean, survival:boolean, initialTimeMs:number, endTime:string, skip:string, description:string}>} */
  const MODE_DEFINITIONS = Object.freeze({
    classic: Object.freeze({ timed: false, daily: false, survival: false, initialTimeMs: 60000, endTime: "0:01", skip: "ADD 1S", description: "GUESS THE TRACK IN SIX TRIES AS MORE AUDIO IS REVEALED" }),
    daily: Object.freeze({ timed: false, daily: true, survival: false, initialTimeMs: 60000, endTime: "0:01", skip: "ADD 1S", description: "ONE SHARED TRACK EACH DAY, GUESS IT IN SIX TRIES" }),
    blitz: Object.freeze({ timed: true, daily: false, survival: false, initialTimeMs: 60000, endTime: "1:00", skip: "SKIP", description: "GUESS AS MANY TRACKS AS POSSIBLE BEFORE THE TIMER RUNS OUT" }),
    survival: Object.freeze({ timed: true, daily: false, survival: true, initialTimeMs: 30000, endTime: "0:30", skip: "SKIP", description: "CORRECT GUESSES ADD TIME; MISTAKES AND SKIPS DRAIN IT" }),
  });

  /** @type {Record<string, {clockDelta:(kind:AttemptKind)=>number, countsGuess:(kind:AttemptKind)=>boolean, prompt:(value:number)=>{text:string,tone:string}}>} */
  const MODE_STRATEGIES = Object.freeze({
    classic: Object.freeze({ clockDelta: () => 0, countsGuess: (/** @type {AttemptKind} */ kind) => kind !== "skip", prompt: classicPrompt }),
    daily: Object.freeze({ clockDelta: () => 0, countsGuess: (/** @type {AttemptKind} */ kind) => kind !== "skip", prompt: classicPrompt }),
    blitz: Object.freeze({ clockDelta: () => 0, countsGuess: (/** @type {AttemptKind} */ kind) => kind !== "skip", prompt: timedPrompt }),
    survival: Object.freeze({ clockDelta: (/** @type {AttemptKind} */ kind) => ({ correct: 3000, wrong: -1000, skip: -2000 })[kind] || 0, countsGuess: (/** @type {AttemptKind} */ kind) => kind !== "skip", prompt: timedPrompt }),
  });

  /** @param {any} value @returns {any} */
  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (!value || typeof value !== "object") return value;
    /** @type {Record<string, any>} */
    const result = {};
    for (const key of Object.keys(value)) result[key] = clone(value[key]);
    return result;
  }

  /** @param {number|undefined} value @returns {number} */
  function uint32(value) {
    const resolved = Number.isFinite(value) ? Number(value) >>> 0 : 0x9e3779b9;
    return resolved || 0x6d2b79f5;
  }

  /** @param {number|undefined} seed @returns {{seed:number, value:number}} */
  function nextRandom(seed) {
    let next = uint32(seed);
    next ^= next << 13;
    next ^= next >>> 17;
    next ^= next << 5;
    next >>>= 0;
    if (!next) next = 0x6d2b79f5;
    return { seed: next, value: next / 0x100000000 };
  }

  /** @param {string} value @returns {number} */
  function hashDaily(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  /** @param {unknown} value @returns {value is string} */
  function isCalendarDate(value) {
    if (typeof value !== "string") return false;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1) return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= days[month - 1];
  }

  /** @param {unknown} value @returns {Track[]} */
  function validateTracks(value) {
    if (!Array.isArray(value)) throw new Error("Track catalog is not an array.");
    if (!value.length) throw new Error("Track catalog is empty.");
    const titles = new Set();
    const numbers = new Set();
    return value.map((source, index) => {
      /** @param {string} message @returns {never} */
      const fail = (message) => { throw new Error(`Track catalog entry ${index + 1} ${message}`); };
      if (!source || typeof source !== "object" || Array.isArray(source)) fail("is not an object.");
      const item = /** @type {Record<string, unknown>} */ (source);
      const title = typeof item.title === "string" ? item.title.trim() : "";
      const duration = item.duration;
      const spotify = typeof item.spotify === "string" ? item.spotify.trim() : "";
      const dailyNumber = item.dailyNumber;
      const dailyFrom = typeof item.dailyFrom === "string" ? item.dailyFrom.trim() : "";
      if (!title) fail("has no title.");
      if (titles.has(title)) fail(`duplicates title \"${title}\".`);
      if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) fail("has an invalid duration.");
      if (!Number.isSafeInteger(dailyNumber) || Number(dailyNumber) <= 0) fail("has an invalid dailyNumber.");
      if (numbers.has(dailyNumber)) fail(`duplicates dailyNumber ${dailyNumber}.`);
      if (spotify && !/^[A-Za-z0-9]{22}$/.test(spotify)) fail("has an invalid Spotify track ID.");
      if (!isCalendarDate(dailyFrom)) fail("has an invalid dailyFrom date.");
      titles.add(title);
      numbers.add(dailyNumber);
      return { title, duration: Number(duration), spotify, dailyNumber: Number(dailyNumber), dailyFrom, isNew: item.isNew === true };
    });
  }

  /** @param {Track[]} tracks */
  function createIndexes(tracks) {
    /** @type {Record<string, number>} */
    const byDailyNumber = {};
    /** @type {Record<string, number>} */
    const byTitle = {};
    /** @type {{index:number, normalized:string}[]} */
    const search = [];
    tracks.forEach((track, index) => {
      byDailyNumber[String(track.dailyNumber)] = index;
      byTitle[track.title] = index;
      search.push({ index, normalized: track.title.toLocaleLowerCase() });
    });
    return { byDailyNumber, byTitle, search };
  }

  /** @param {unknown} saved */
  function normalizeDaily(saved) {
    const source = /** @type {Record<string, any>} */ (saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {});
    const started = source.started === true;
    const completed = started && source.completed === true;
    const step = Number.isSafeInteger(source.step) && Number(source.step) >= 0 && Number(source.step) < SNIPPET_DURATIONS.length ? Number(source.step) : 0;
    return {
      date: typeof source.date === "string" && isCalendarDate(source.date) ? source.date : "",
      dailyNumber: Number.isSafeInteger(source.dailyNumber) && Number(source.dailyNumber) > 0 ? Number(source.dailyNumber) : null,
      started,
      completed,
      won: completed && source.won === true,
      step,
    };
  }

  /** @param {unknown} value @returns {number} */
  function validRecord(value) {
    return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
  }

  /** @param {unknown} value @returns {number|null} */
  function validAccuracy(value) {
    return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100 ? Number(value) : null;
  }

  /** @param {unknown} saved */
  function normalizePersonalBests(saved) {
    const source = /** @type {Record<string, any>} */ (saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {});
    const classicSource = source.classic && typeof source.classic === "object" ? source.classic : {};
    let current = validRecord(classicSource.current);
    let snippetTotal = validRecord(classicSource.snippetTotal);
    if (snippetTotal < current || snippetTotal > current * 32) { current = 0; snippetTotal = 0; }
    let best = Math.max(current, validRecord(classicSource.best));
    let bestSnippetTotal = validRecord(classicSource.bestSnippetTotal);
    if (bestSnippetTotal < best || bestSnippetTotal > best * 32) bestSnippetTotal = current === best ? snippetTotal : 0;
    const normalizeTimed = (/** @type {any} */ record) => ({
      score: validRecord(record && typeof record === "object" ? record.score : 0),
      accuracy: validAccuracy(record && typeof record === "object" ? record.accuracy : null),
    });
    return {
      classic: { current, best, snippetTotal, bestSnippetTotal },
      daily: validRecord(source.daily),
      blitz: normalizeTimed(source.blitz),
      survival: normalizeTimed(source.survival),
    };
  }

  /** @param {ModeName} modeName @param {number} generation */
  function createClock(modeName, generation) {
    const mode = MODE_DEFINITIONS[modeName];
    const kind = !mode ? "classic" : modeName === "survival" ? "survival" : mode.timed ? "blitz" : "classic";
    const initial = mode ? mode.initialTimeMs : 60000;
    return {
      kind,
      generation,
      running: false,
      anchorMs: null,
      elapsedMs: 0,
      remainingMs: initial,
      limitMs: mode && !mode.timed ? 1000 : 0,
      maxRemainingMs: initial,
      expired: false,
    };
  }

  /** @param {number} id @param {ModeName|null} mode @param {number|undefined} seed @param {number} nextRoundId */
  function createSession(id, mode, seed, nextRoundId) {
    return {
      id,
      status: /** @type {SessionStatus} */ ("idle"),
      mode,
      rounds: 0,
      guesses: 0,
      correct: 0,
      step: 0,
      current: null,
      pending: null,
      standby: null,
      previousDailyNumber: null,
      nextRoundId,
      nextAudioGeneration: 0,
      history: [],
      nextHistoryId: 0,
      promptEntryId: null,
      retryEntryId: null,
      playbackRequested: false,
      randomSeed: uint32(seed),
      usedTitles: [],
      quarantine: [],
      notice: null,
      result: null,
      recovery: { automaticRetriesRemaining: 1, prefetchBlocked: false, retryOrdinal: null },
      clock: createClock(mode || "classic", id),
    };
  }

  /** @param {InitialStateOptions} [options] @returns {GameState} */
  function createInitialState(options = {}) {
    const date = typeof options.date === "string" && isCalendarDate(options.date) ? options.date : "1970-01-01";
    const persistence = options.persistence && typeof options.persistence === "object" ? options.persistence : {};
    const discoveries = Array.isArray(persistence.discoveriesV2)
      ? persistence.discoveriesV2.filter((/** @type {unknown} */ number) => Number.isSafeInteger(number) && Number(number) > 0).map(Number)
      : [];
    return {
      schemaVersion: 1,
      app: { status: /** @type {AppStatus} */ ("loading"), budapestDate: date, notice: null, catalogError: null, previewText: null },
      catalog: { status: "idle", requestId: 0, appliedDate: null, version: 0, tracks: [], indexes: { byDailyNumber: {}, byTitle: {}, search: [] }, retry: null, staged: null },
      session: createSession(0, null, options.seed, 0),
      daily: { roundDate: date, progress: normalizeDaily(persistence.dailyV2), retryRound: null },
      discovery: { dailyNumbers: [...new Set(discoveries)].sort((a, b) => a - b) },
      personalBests: normalizePersonalBests(persistence.personalBestsV2),
      input: { query: "", selectedSuggestion: -1, modality: options.modality === "keyboard" || options.modality === "pointer-coarse" ? options.modality : "pointer-fine" },
      overlay: { kind: null, phase: "closed", generation: 0, returnFocus: null, suspension: null },
      persistence: {
        status: "idle",
        nextRequestId: 0,
        pendingWrites: [],
        lastError: null,
      },
    };
  }

  /** @param {unknown} value @returns {value is ModeName} */
  function isMode(value) {
    return typeof value === "string" && MODE_NAMES.includes(/** @type {ModeName} */ (value));
  }

  /** @param {GameState} state */
  function modeOf(state) {
    return state.session.mode ? MODE_DEFINITIONS[state.session.mode] : null;
  }

  /** @param {GameState} state */
  function isOverlayOpen(state) {
    return state.overlay.phase !== "closed";
  }

  /** @param {GameState} state @param {string} [date] */
  function dailyDone(state, date = state.daily.roundDate) {
    const progress = state.daily.progress;
    return progress.date === date && progress.completed;
  }

  /** @param {GameState} state @param {string} [date] */
  function dailyInProgress(state, date = state.daily.roundDate) {
    const progress = state.daily.progress;
    return progress.date === date && progress.started && !progress.completed;
  }

  /** @param {GameState} state */
  function dailyCatalogPending(state) {
    return state.session.mode === "daily" && state.catalog.appliedDate !== state.daily.roundDate;
  }

  /** @param {GameState} state @param {string} date @returns {Track|null} */
  function selectDailyTrack(state, date) {
    /** @type {Track[]} */
    const eligible = state.catalog.tracks.filter((/** @type {Track} */ track) => track.dailyFrom <= date);
    if (!eligible.length) return null;
    if (state.daily.progress.date === date && state.daily.progress.dailyNumber) {
      const persisted = eligible.find((/** @type {Track} */ track) => track.dailyNumber === state.daily.progress.dailyNumber);
      if (persisted) return persisted;
    }
    /** @type {Track|null} */
    let winner = null;
    let winnerScore = -1;
    for (const track of eligible) {
      const score = hashDaily(`corzaguessr-daily-v1:${date}:${track.dailyNumber}`);
      if (!winner || score > winnerScore) { winner = track; winnerScore = score; }
    }
    return winner;
  }

  /** @param {GameState} state @param {Effect[]} effects @param {string} key @param {unknown} value */
  function queueStorageWrite(state, effects, key, value) {
    const requestId = ++state.persistence.nextRequestId;
    state.persistence.pendingWrites.push({ requestId, key });
    effects.push({ type: "STORAGE_WRITE", requestId, key, value: clone(value) });
  }

  /** @param {GameState} state @param {Effect[]} effects @param {string} date @returns {Track|null} */
  function persistDailyIdentity(state, effects, date) {
    const selected = selectDailyTrack(state, date);
    if (!selected) return null;
    const progress = state.daily.progress;
    if (progress.date === date && progress.dailyNumber === selected.dailyNumber) return selected;
    if (progress.date === date && progress.started) return selected;
    state.daily.progress = { date, dailyNumber: selected.dailyNumber, started: false, completed: false, won: false, step: 0 };
    queueStorageWrite(state, effects, STORAGE_KEYS.daily, state.daily.progress);
    return selected;
  }

  /** @param {GameState} state @param {Effect[]} effects @param {string} date */
  function requestCatalog(state, effects, date) {
    if (!isCalendarDate(date)) return;
    const requestId = state.catalog.requestId + 1;
    state.catalog.requestId = requestId;
    state.catalog.status = "loading";
    state.catalog.retry = null;
    if (!state.catalog.tracks.length) state.app.status = "loading";
    effects.push({ type: "CATALOG_FETCH", requestId, date });
  }

  /** @param {GameState} state @param {number} length @returns {number} */
  function randomIndex(state, length) {
    const draw = nextRandom(state.session.randomSeed);
    state.session.randomSeed = draw.seed;
    return Math.min(length - 1, Math.floor(draw.value * length));
  }

  /** @param {GameState} state @returns {Track|null} */
  function selectRandomTrack(state) {
    const unavailable = new Set(state.session.quarantine);
    /** @type {Track[]} */
    const available = state.catalog.tracks.filter((/** @type {Track} */ track) => !unavailable.has(track.dailyNumber));
    if (!available.length) return null;
    const withoutPrevious = available.length > 1
      ? available.filter((/** @type {Track} */ track) => track.dailyNumber !== state.session.previousDailyNumber)
      : available;
    return withoutPrevious[randomIndex(state, withoutPrevious.length)];
  }

  /** @param {GameState} state @param {Track|null} selected @param {{ordinal?:number}} [options] @returns {Round|null} */
  function createRound(state, selected, options = {}) {
    const modeName = state.session.mode;
    if (!modeName || !selected) return null;
    const mode = MODE_DEFINITIONS[modeName];
    const minimumRemaining = Math.min(mode.timed ? MINIMUM_TIMED_REMAINING_SECONDS : Number(SNIPPET_DURATIONS.at(-1)), selected.duration);
    const available = Math.max(0, Math.floor(selected.duration - minimumRemaining));
    let at;
    if (mode.daily) at = hashDaily(`corzaguessr-daily-clip-v1:${state.daily.roundDate}:${selected.dailyNumber}`) % (available + 1);
    else {
      const draw = nextRandom(state.session.randomSeed);
      state.session.randomSeed = draw.seed;
      at = Math.floor(draw.value * (available + 1));
    }
    return {
      id: ++state.session.nextRoundId,
      sessionId: state.session.id,
      audioGeneration: ++state.session.nextAudioGeneration,
      modeName,
      catalogVersion: state.catalog.version,
      roundDate: mode.daily ? state.daily.roundDate : null,
      prepared: false,
      hasPlayed: false,
      ordinal: Number.isSafeInteger(options.ordinal) && Number(options.ordinal) > 0
        ? Number(options.ordinal)
        : state.session.rounds + 1,
      track: { ...clone(selected), at },
    };
  }

  /** @param {GameState} state @param {number} [ordinal] @returns {Round|null} */
  function selectRoundCandidate(state, ordinal = state.session.rounds + 1) {
    const mode = modeOf(state);
    if (!mode) return null;
    if (mode.daily && state.daily.retryRound) {
      const selected = state.daily.retryRound.track;
      const track = state.catalog.tracks.find((/** @type {Track} */ item) => item.dailyNumber === selected.dailyNumber) || selected;
      return createRound(state, track, { ordinal });
    }
    const track = mode.daily ? selectDailyTrack(state, state.daily.roundDate) : selectRandomTrack(state);
    return createRound(state, track, { ordinal });
  }

  /** @param {GameState} state @param {Effect[]} effects */
  function prefetchStandby(state, effects) {
    if (!state.session.mode || !state.catalog.tracks.length || state.session.standby || !["idle", "active", "paused"].includes(state.session.status) || state.session.recovery.prefetchBlocked) return;
    if (dailyCatalogPending(state)) return;
    if (MODE_DEFINITIONS[state.session.mode].daily && (state.session.current || state.session.pending || dailyDone(state))) return;
    const round = selectRoundCandidate(state);
    if (!round) return;
    state.session.standby = round;
    effects.push({ type: "AUDIO_PREPARE", role: "standby", round: clone(round) });
  }

  /** @param {GameState} state @param {Effect[]} effects @param {boolean} [manualRetry] @param {number|null} [retryOrdinal] @returns {boolean} */
  function beginRound(state, effects, manualRetry = false, retryOrdinal = null) {
    if (!state.session.mode || !state.catalog.tracks.length || isOverlayOpen(state)) return false;
    if (dailyCatalogPending(state)) return false;
    if (MODE_DEFINITIONS[state.session.mode].daily && dailyDone(state) && !state.session.current) return false;
    if (manualRetry) {
      state.session.recovery.prefetchBlocked = false;
      if (!MODE_DEFINITIONS[state.session.mode].daily && !selectRandomTrackPreview(state)) state.session.quarantine = [];
    }
    let round = state.session.standby;
    if (round && (round.sessionId !== state.session.id || round.catalogVersion !== state.catalog.version)) round = null;
    if (round) {
      state.session.standby = null;
      round.ordinal = Number.isSafeInteger(retryOrdinal) && Number(retryOrdinal) > 0 ? Number(retryOrdinal) : state.session.rounds + 1;
      state.session.pending = round;
      state.session.status = "preparing";
      state.session.playbackRequested = true;
      state.session.notice = null;
      effects.push({ type: "AUDIO_PROMOTE_AND_PLAY", round: clone(round) });
      return true;
    }
    round = selectRoundCandidate(state, Number.isSafeInteger(retryOrdinal) && Number(retryOrdinal) > 0 ? Number(retryOrdinal) : state.session.rounds + 1);
    if (!round) {
      state.session.status = "audio-retry";
      state.session.recovery.prefetchBlocked = true;
      state.session.notice = MODE_DEFINITIONS[state.session.mode].daily ? "daily-audio-error" : "track-audio-error";
      return false;
    }
    state.session.pending = round;
    state.session.status = "preparing";
    state.session.playbackRequested = true;
    state.session.notice = null;
    effects.push({ type: "AUDIO_PREPARE", role: "active", round: clone(round) });
    return true;
  }

  /** @param {GameState} state @returns {boolean} */
  function selectRandomTrackPreview(state) {
    const unavailable = new Set(state.session.quarantine);
    return state.catalog.tracks.some((/** @type {Track} */ track) => !unavailable.has(track.dailyNumber));
  }

  /** @param {GameState} state @param {Effect[]} effects @param {ModeName} modeName */
  function resetSession(state, effects, modeName) {
    const old = state.session;
    const id = old.id + 1;
    const nextRoundId = old.nextRoundId;
    const seed = nextRandom(old.randomSeed).seed;
    state.session = createSession(id, modeName, seed, nextRoundId);
    if (modeName === "daily" && dailyInProgress(state)) state.session.step = state.daily.progress.step;
    state.daily.retryRound = null;
    state.input.query = "";
    state.input.selectedSuggestion = -1;
    state.app.previewText = null;
    state.app.notice = null;
    if (state.catalog.tracks.length) state.app.status = "ready";
    effects.push({ type: "AUDIO_RESET", sessionId: id });
    effects.push({ type: "CLOCK_CANCEL", sessionId: old.id, generation: old.clock.generation });
    if (state.overlay.phase !== "closed") state.overlay.suspension = null;
    prefetchStandby(state, effects);
  }

  /** @param {Round|null} round @param {{sessionId:number, roundId:number, audioGeneration:number}} action @returns {boolean} */
  function matchesRound(round, action) {
    return Boolean(round && round.sessionId === action.sessionId && round.id === action.roundId && round.audioGeneration === action.audioGeneration);
  }

  /** @param {any} clock @param {number|null|undefined} atMs */
  function updateClockAt(clock, atMs) {
    if (!clock.running || clock.anchorMs === null || !Number.isFinite(atMs)) return;
    const resolvedAtMs = Number(atMs);
    const delta = Math.max(0, resolvedAtMs - clock.anchorMs);
    clock.anchorMs = resolvedAtMs;
    clock.elapsedMs += delta;
    if (clock.kind === "classic") {
      clock.remainingMs = Math.max(0, clock.limitMs - clock.elapsedMs);
    } else {
      clock.remainingMs = Math.max(0, clock.remainingMs - delta);
    }
    if (!clock.remainingMs) clock.expired = true;
  }

  /** @param {GameState} state @param {number|null|undefined} atMs @param {Effect[]} effects */
  function pauseClock(state, atMs, effects) {
    const clock = state.session.clock;
    const generation = clock.generation;
    const wasRunning = clock.running;
    updateClockAt(clock, Number.isFinite(atMs) ? atMs : clock.anchorMs);
    clock.running = false;
    clock.anchorMs = null;
    if (wasRunning) {
      effects.push({ type: "CLOCK_CANCEL", sessionId: state.session.id, generation });
      clock.generation++;
    }
  }

  /** @param {GameState} state @param {Effect[]} effects @param {number|null|undefined} atMs */
  function startClock(state, effects, atMs) {
    const clock = state.session.clock;
    if (clock.expired) return;
    clock.running = true;
    clock.anchorMs = Number.isFinite(atMs) ? atMs : 0;
    effects.push({ type: "CLOCK_SCHEDULE", sessionId: state.session.id, generation: clock.generation, anchorMs: clock.anchorMs, remainingMs: clock.remainingMs });
  }

  /** @param {GameState} state @param {Effect[]} effects @param {number} limitMs @param {number|null|undefined} atMs */
  function extendClassicClock(state, effects, limitMs, atMs) {
    const clock = state.session.clock;
    const wasRunning = clock.running;
    const generation = clock.generation;
    updateClockAt(clock, Number.isFinite(atMs) ? atMs : clock.anchorMs);
    clock.limitMs = limitMs;
    clock.remainingMs = Math.max(0, limitMs - clock.elapsedMs);
    clock.expired = clock.remainingMs === 0;
    if (wasRunning && !clock.expired) {
      effects.push({ type: "CLOCK_CANCEL", sessionId: state.session.id, generation });
      clock.generation++;
      effects.push({ type: "CLOCK_SCHEDULE", sessionId: state.session.id, generation: clock.generation, anchorMs: Number(clock.anchorMs), remainingMs: clock.remainingMs });
    }
  }

  /** @param {number} step @returns {{text:string,tone:string}} */
  function classicPrompt(step) {
    const last = step === SNIPPET_DURATIONS.length - 1;
    return { text: last ? "LAST CHANCE TO GUESS" : `GUESS ${step + 1} OUT OF ${SNIPPET_DURATIONS.length}`, tone: last ? "blink prompt" : "prompt" };
  }

  /** @param {number} rounds @returns {{text:string,tone:string}} */
  function timedPrompt(rounds) {
    return { text: `GUESS #${rounds}`, tone: "prompt" };
  }

  /** @param {GameState} state @param {string} text @param {string} tone @param {string} status @param {number|null} roundId @param {number|null} [replaceId] */
  function addHistory(state, text, tone, status, roundId, replaceId = null) {
    const history = state.session.history;
    const index = replaceId === null ? -1 : history.findIndex((/** @type {any} */ entry) => entry.id === replaceId);
    if (index >= 0) {
      history[index] = { id: replaceId, text, tone, status, roundId };
      return history[index];
    }
    const entry = { id: ++state.session.nextHistoryId, text, tone, status, roundId };
    history.unshift(entry);
    if (modeOf(state)?.timed && history.length > MAX_TIMED_HISTORY) history.length = MAX_TIMED_HISTORY;
    return entry;
  }

  /** @param {GameState} state @param {boolean} [replaceRetry] */
  function addPrompt(state, replaceRetry = false) {
    const modeName = state.session.mode;
    const round = state.session.current;
    if (!modeName || !round) return;
    const mode = modeOf(state);
    if (!mode) return;
    const prompt = MODE_STRATEGIES[modeName].prompt(mode.timed ? state.session.rounds : state.session.step);
    const entry = addHistory(state, prompt.text, prompt.tone, "prompt", round.id, replaceRetry ? state.session.retryEntryId : null);
    state.session.promptEntryId = entry.id;
    state.session.retryEntryId = null;
  }

  /** @param {GameState} state @returns {string} */
  function addTechnicalError(state) {
    const daily = state.session.mode === "daily";
    const text = daily ? TEXT.dailyTrackError : TEXT.trackError;
    const replaceId = state.session.promptEntryId || state.session.retryEntryId;
    if (replaceId === null) return text;
    const roundId = state.session.current?.id || state.session.pending?.id || null;
    const entry = addHistory(state, text, "blink technical", "technical", roundId, replaceId);
    state.session.promptEntryId = null;
    state.session.retryEntryId = entry.id;
    return text;
  }

  /** @param {GameState} state @param {Effect[]} effects */
  function markDailyStarted(state, effects) {
    if (state.session.mode !== "daily" || !state.session.current) return;
    const date = state.session.current.roundDate;
    if (!date || (state.daily.progress.date === date && state.daily.progress.started)) return;
    state.daily.progress = { date, dailyNumber: state.session.current.track.dailyNumber, started: true, completed: false, won: false, step: state.session.step };
    queueStorageWrite(state, effects, STORAGE_KEYS.daily, state.daily.progress);
  }

  /** @param {GameState} state @param {Effect[]} effects */
  function recordDiscovery(state, effects) {
    const number = state.session.current?.track.dailyNumber;
    if (!number || state.discovery.dailyNumbers.includes(number)) return;
    state.discovery.dailyNumbers.push(number);
    state.discovery.dailyNumbers.sort((/** @type {number} */ a, /** @type {number} */ b) => a - b);
    queueStorageWrite(state, effects, STORAGE_KEYS.discoveries, state.discovery.dailyNumbers);
  }

  /** @param {GameState} state @returns {number} */
  function accuracy(state) {
    return state.session.guesses ? Math.round(state.session.correct * 100 / state.session.guesses) : 0;
  }

  /** @param {GameState} state @param {Effect[]} effects @param {boolean} won @param {number|null|undefined} atMs */
  function finishGame(state, effects, won, atMs) {
    if (!state.session.current || state.session.status === "result") return;
    pauseClock(state, atMs, effects);
    const modeName = state.session.mode;
    const track = state.session.current.track;
    state.session.status = "result";
    state.session.playbackRequested = false;
    state.session.current.hasPlayed = false;
    state.session.result = { won: Boolean(won), trackTitle: track.title, spotify: track.spotify, newPersonalBest: false };
    effects.push({ type: "AUDIO_PAUSE", sessionId: state.session.id, roundId: state.session.current.id });
    if (modeName === "daily") {
      state.daily.progress = { date: state.session.current.roundDate, dailyNumber: track.dailyNumber, started: true, completed: true, won: Boolean(won), step: state.session.step };
      queueStorageWrite(state, effects, STORAGE_KEYS.daily, state.daily.progress);
      if (won) {
        const attempts = state.session.step + 1;
        if (!state.personalBests.daily || attempts < state.personalBests.daily) {
          state.personalBests.daily = attempts;
          state.session.result.newPersonalBest = true;
        }
      }
    } else if (modeName === "classic") {
      const record = state.personalBests.classic;
      if (won) {
        record.current++;
        record.snippetTotal += SNIPPET_DURATIONS[state.session.step];
        state.session.result.classicRun = {
          won: true,
          streak: record.current,
          average: record.current ? record.snippetTotal / record.current : 0,
        };
        if (record.current > record.best || (record.current === record.best && (!record.bestSnippetTotal || record.snippetTotal < record.bestSnippetTotal))) {
          record.best = record.current;
          record.bestSnippetTotal = record.snippetTotal;
          state.session.result.newPersonalBest = true;
        }
      } else {
        state.session.result.classicRun = {
          won: false,
          streak: record.current,
          average: record.current ? record.snippetTotal / record.current : 0,
        };
        record.current = 0;
        record.snippetTotal = 0;
      }
    } else if (modeName) {
      const score = modeName === "survival" ? Math.floor(state.session.clock.elapsedMs) : state.session.correct;
      const record = state.personalBests[modeName];
      if (score > record.score) {
        state.personalBests[modeName] = { score, accuracy: accuracy(state) };
        state.session.result.newPersonalBest = true;
      }
    }
    queueStorageWrite(state, effects, STORAGE_KEYS.personalBests, state.personalBests);
    const generation = state.overlay.generation + 1;
    state.overlay = { kind: "result", phase: "opening", generation, returnFocus: "play", suspension: null };
    effects.push({ type: "OVERLAY_SYNC", kind: "result", phase: "opening", generation, returnFocus: "play" });
  }

  /** @param {GameState} state @param {AttemptKind} kind @param {string} title */
  function renderAttemptHistory(state, kind, title) {
    const mode = modeOf(state);
    if (!mode || !state.session.current) return;
    const replaceId = state.session.promptEntryId;
    let text;
    let tone;
    if (kind === "skip") {
      tone = "skip";
      if (mode.timed) text = "SKIPPED";
      else {
        const last = state.session.step === SNIPPET_DURATIONS.length - 1;
        const added = last ? 0 : SNIPPET_DURATIONS[state.session.step + 1] - SNIPPET_DURATIONS[state.session.step];
        text = last ? "FINAL GUESS SKIPPED" : `GUESS ${state.session.step + 1} SKIPPED, ${added} SECOND${added === 1 ? "" : "S"} ADDED`;
      }
    } else {
      text = title;
      tone = kind;
    }
    addHistory(state, text, tone, "attempt", state.session.current.id, replaceId);
    state.session.promptEntryId = null;
    state.input.query = "";
    state.input.selectedSuggestion = -1;
  }

  /** @param {GameState} state @param {Effect[]} effects @param {AttemptKind} kind @param {string} title @param {number|null|undefined} atMs */
  function resolveAttempt(state, effects, kind, title, atMs) {
    if (!state.session.current || !["active", "paused"].includes(state.session.status) || isOverlayOpen(state)) return;
    const mode = modeOf(state);
    if (!mode) return;
    if (mode.timed) pauseClock(state, atMs, effects);
    if (mode.timed && state.session.clock.expired) { finishGame(state, effects, false, atMs); return; }
    renderAttemptHistory(state, kind, title);
    if (kind === "correct") recordDiscovery(state, effects);
    effects.push({
      type: "ANNOUNCE",
      message: mode.timed
        ? kind === "correct" ? "CORRECT." : kind === "wrong" ? "INCORRECT." : "SKIPPED."
        : kind === "wrong" ? "INCORRECT. TRY AGAIN." : kind === "skip" ? "SKIPPED. MORE TIME ADDED." : "CORRECT.",
    });

    if (!mode.timed) {
      if (kind === "correct") { finishGame(state, effects, true, atMs); return; }
      if (state.session.step === SNIPPET_DURATIONS.length - 1) { finishGame(state, effects, false, atMs); return; }
      const wasPlaying = state.session.playbackRequested && state.session.clock.running;
      state.session.step++;
      const limitMs = SNIPPET_DURATIONS[state.session.step] * 1000;
      if (state.session.mode === "daily" && state.daily.progress.started && !state.daily.progress.completed) {
        state.daily.progress.step = state.session.step;
        queueStorageWrite(state, effects, STORAGE_KEYS.daily, state.daily.progress);
      }
      addPrompt(state, false);
      if (wasPlaying) {
        extendClassicClock(state, effects, limitMs, atMs);
      } else {
        state.session.clock = createClock(state.session.mode, state.session.clock.generation + 1);
        state.session.clock.limitMs = limitMs;
        state.session.clock.remainingMs = limitMs;
        state.session.current.hasPlayed = false;
        state.session.status = "paused";
        state.session.playbackRequested = true;
        effects.push({ type: "AUDIO_PLAY", round: clone(state.session.current), rewind: true });
      }
      return;
    }

    effects.push({ type: "AUDIO_PAUSE", sessionId: state.session.id, roundId: state.session.current.id });
    const strategy = MODE_STRATEGIES[state.session.mode];
    if (strategy.countsGuess(kind)) state.session.guesses++;
    if (kind === "correct") state.session.correct++;
    const delta = strategy.clockDelta(kind);
    if (delta) {
      effects.push({ type: "FEEDBACK_FLASH", sessionId: state.session.id, amountSeconds: delta / 1000 });
      state.session.clock.remainingMs = Math.max(0, state.session.clock.remainingMs + delta);
      state.session.clock.maxRemainingMs = Math.max(state.session.clock.maxRemainingMs, state.session.clock.remainingMs);
      if (!state.session.clock.remainingMs) state.session.clock.expired = true;
    }
    if (state.session.clock.expired || !state.session.clock.remainingMs) { finishGame(state, effects, false, atMs); return; }
    state.session.current = null;
    state.session.status = "idle";
    state.session.playbackRequested = false;
    state.session.recovery.automaticRetriesRemaining = 1;
    beginRound(state, effects, false, null);
  }

  /** @param {GameState} state @param {AudioFailedAction} action @param {Effect[]} effects @returns {boolean} */
  function handleAudioFailure(state, action, effects) {
    if (action.sessionId !== state.session.id) return false;
    if (action.role === "standby") {
      if (!matchesRound(state.session.standby, action)) return false;
      const failed = state.session.standby;
      state.session.standby = null;
      if (!state.session.quarantine.includes(failed.track.dailyNumber)) state.session.quarantine.push(failed.track.dailyNumber);
      state.session.recovery.prefetchBlocked = true;
      if (failed.modeName === "daily" && !state.session.current) {
        state.daily.retryRound = clone(failed);
        state.session.status = "audio-retry";
        state.session.notice = "daily-audio-error";
        const message = addTechnicalError(state);
        effects.push({ type: "ANNOUNCE", message });
      }
      return true;
    }
    const failed = matchesRound(state.session.pending, action) ? state.session.pending : matchesRound(state.session.current, action) ? state.session.current : null;
    if (!failed || state.session.status === "result") return false;
    pauseClock(state, action.atMs, effects);
    const wasCommitted = Boolean(state.session.current && failed.id === state.session.current.id);
    const message = addTechnicalError(state);
    if (!state.session.quarantine.includes(failed.track.dailyNumber)) state.session.quarantine.push(failed.track.dailyNumber);
    if (failed.modeName === "daily") state.daily.retryRound = clone(failed);
    state.session.current = null;
    state.session.pending = null;
    state.session.playbackRequested = false;
    state.session.recovery.retryOrdinal = wasCommitted ? state.session.rounds : null;
    effects.push({ type: "AUDIO_RELEASE", sessionId: state.session.id, roundId: failed.id });
    const timed = MODE_DEFINITIONS[failed.modeName].timed;
    if (timed && state.session.recovery.automaticRetriesRemaining > 0 && failed.modeName !== "daily") {
      state.session.recovery.automaticRetriesRemaining--;
      state.session.recovery.prefetchBlocked = false;
      state.session.status = "idle";
      effects.push({ type: "ANNOUNCE", message: "THE SELECTED TRACK COULD NOT BE PLAYED. TRYING ANOTHER." });
      if (beginRound(state, effects, true, wasCommitted ? state.session.rounds : null)) return true;
    }
    state.session.status = "audio-retry";
    state.session.recovery.prefetchBlocked = true;
    state.session.notice = failed.modeName === "daily" ? "daily-audio-error" : "track-audio-error";
    effects.push({ type: "ANNOUNCE", message });
    effects.push({ type: "FOCUS", target: "play", modality: state.input.modality, sessionId: state.session.id, roundId: null });
    return true;
  }

  /** @param {GameState} state @param {Track[]} tracks @param {string} date @param {Effect[]} effects */
  function applyCatalog(state, tracks, date, effects) {
    const staleStandby = state.session.standby;
    if (staleStandby) {
      effects.push({
        type: "AUDIO_DISCARD_STANDBY",
        sessionId: staleStandby.sessionId,
        roundId: staleStandby.id,
        audioGeneration: staleStandby.audioGeneration,
      });
    }
    state.session.standby = null;
    state.session.quarantine = [];
    state.session.recovery.prefetchBlocked = false;
    state.session.recovery.automaticRetriesRemaining = 1;
    state.daily.retryRound = null;
    state.catalog = { status: "ready", requestId: state.catalog.requestId, appliedDate: date, version: state.catalog.version + 1, tracks, indexes: createIndexes(tracks), retry: null, staged: null };
    state.app.catalogError = null;
    state.daily.roundDate = date;
    persistDailyIdentity(state, effects, date);
    state.app.status = state.session.mode ? "ready" : "awaiting-mode";
    if (state.session.mode) prefetchStandby(state, effects);
  }

  /** @param {GameState} state @returns {{state:GameState,effects:Effect[]}} */
  function noChange(state) {
    return { state, effects: [] };
  }

  /** @param {GameState} state @param {Action} action @returns {{state:GameState,effects:Effect[]}} */
  function reduce(state, action) {
    if (!state || !action || typeof action.type !== "string") return noChange(state);
    const next = clone(state);
    /** @type {Effect[]} */
    const effects = [];
    switch (action.type) {
      case "APP/BOOTSTRAP":
        if (!isCalendarDate(action.date)) return noChange(state);
        next.app.budapestDate = action.date;
        next.daily.roundDate = action.date;
        next.persistence.status = "loading";
        effects.push({ type: "STORAGE_LOAD", keys: STORAGE_KEYS });
        requestCatalog(next, effects, action.date);
        break;

      case "ENV/DATE_CHANGED":
        if (!isCalendarDate(action.date) || action.date === next.app.budapestDate) return noChange(state);
        next.app.budapestDate = action.date;
        if (!(next.session.mode === "daily" && (dailyInProgress(next) || next.session.status === "result"))) {
          next.daily.roundDate = action.date;
          if (next.session.mode === "daily") resetSession(next, effects, "daily");
        }
        requestCatalog(next, effects, action.date);
        break;

      case "ENV/VISIBILITY_HIDDEN": {
        const owned = next.session.current || next.session.pending;
        if (!next.session.playbackRequested || !owned || next.session.status === "result") return noChange(state);
        pauseClock(next, action.atMs, effects);
        next.session.playbackRequested = false;
        next.session.status = next.session.current ? "paused" : "preparing";
        effects.push({ type: "AUDIO_PAUSE", sessionId: next.session.id, roundId: owned.id });
        break;
      }

      case "CATALOG/REQUEST":
        requestCatalog(next, effects, action.date || next.app.budapestDate);
        break;

      case "CATALOG/SUCCEEDED": {
        if (action.requestId !== next.catalog.requestId || action.date !== next.app.budapestDate) return noChange(state);
        let tracks;
        try { tracks = validateTracks(action.tracks); }
        catch (error) {
          next.catalog.status = "error";
          next.catalog.retry = { requestId: action.requestId, date: action.date, error: error instanceof Error ? error.message : String(error) };
          next.app.catalogError = next.catalog.retry.error;
          if (!next.catalog.tracks.length) next.app.status = "error";
          effects.push({ type: "ANNOUNCE", message: TEXT.catalogError });
          effects.push({ type: "CATALOG_RETRY_SCHEDULE", requestId: action.requestId, date: action.date, delayMs: 5000 });
          break;
        }
        const protectedDaily = next.session.mode === "daily" && next.daily.progress.started && (next.session.status !== "idle" || dailyInProgress(next));
        if (protectedDaily && next.catalog.appliedDate && next.catalog.appliedDate !== action.date) {
          next.catalog.status = "staged";
          next.catalog.staged = { date: action.date, tracks };
        } else applyCatalog(next, tracks, action.date, effects);
        break;
      }

      case "CATALOG/FAILED":
        if (action.requestId !== next.catalog.requestId || action.date !== next.app.budapestDate) return noChange(state);
        next.catalog.status = "error";
        next.catalog.retry = { requestId: action.requestId, date: action.date, error: action.error || "Track catalog request failed." };
        next.app.catalogError = next.catalog.retry.error;
        if (!next.catalog.tracks.length) next.app.status = "error";
        effects.push({ type: "ANNOUNCE", message: TEXT.catalogError });
        effects.push({ type: "CATALOG_RETRY_SCHEDULE", requestId: action.requestId, date: action.date, delayMs: 5000 });
        break;

      case "CATALOG/RETRY_DUE":
        if (!next.catalog.retry || next.catalog.retry.requestId !== action.requestId || next.catalog.retry.date !== action.date || action.date !== next.app.budapestDate) return noChange(state);
        requestCatalog(next, effects, action.date);
        break;

      case "PERSISTENCE/LOADED": {
        next.persistence.status = "ready";
        if (Array.isArray(action.discoveriesV2)) {
          next.discovery.dailyNumbers = [...new Set(action.discoveriesV2.filter((number) => Number.isSafeInteger(number) && Number(number) > 0).map(Number))].sort((a, b) => a - b);
        }
        if (action.dailyV2 && typeof action.dailyV2 === "object") {
          const normalized = normalizeDaily(action.dailyV2);
          if (!normalized.started || (normalized.date && normalized.dailyNumber)) {
            next.daily.progress = normalized;
          }
        }
        next.personalBests = normalizePersonalBests(action.personalBestsV2);
        if (next.catalog.tracks.length) {
          persistDailyIdentity(next, effects, next.daily.roundDate);
        }
        break;
      }

      case "PERSISTENCE/WRITE_SUCCEEDED": {
        const write = next.persistence.pendingWrites.find((/** @type {any} */ item) => item.requestId === action.requestId);
        if (!write) return noChange(state);
        next.persistence.pendingWrites = next.persistence.pendingWrites.filter((/** @type {any} */ item) => item.requestId !== action.requestId);
        break;
      }

      case "PERSISTENCE/WRITE_FAILED":
        if (!next.persistence.pendingWrites.some((/** @type {any} */ item) => item.requestId === action.requestId)) return noChange(state);
        next.persistence.pendingWrites = next.persistence.pendingWrites.filter((/** @type {any} */ item) => item.requestId !== action.requestId);
        next.persistence.lastError = action.error || "Storage write failed.";
        effects.push({ type: "ANNOUNCE", message: "PROGRESS COULD NOT BE SAVED IN THIS BROWSER." });
        break;

      case "PLAYER/SELECT_MODE":
        if (!isMode(action.mode) || action.mode === next.session.mode || next.app.status === "error" || isOverlayOpen(next)) return noChange(state);
        resetSession(next, effects, action.mode);
        effects.push({ type: "ANNOUNCE", message: MODE_DEFINITIONS[action.mode].description });
        break;

      case "PLAYER/NEW_GAME":
        if (!next.session.mode) return noChange(state);
        resetSession(next, effects, next.session.mode);
        break;

      case "PLAYER/PLAYBACK_SHORTCUT":
      case "PLAYER/PLAY": {
        if (next.app.status !== "ready" || !next.session.mode || isOverlayOpen(next)) return noChange(state);
        const shortcut = action.type === "PLAYER/PLAYBACK_SHORTCUT";
        if (next.session.status === "idle" || next.session.status === "audio-retry") {
          beginRound(next, effects, next.session.status === "audio-retry", next.session.recovery.retryOrdinal);
        } else if (next.session.status === "preparing" && next.session.pending && !next.session.playbackRequested) {
          next.session.playbackRequested = true;
          effects.push({ type: "AUDIO_PLAY", round: clone(next.session.pending), rewind: false });
        } else if ((next.session.status === "active" || next.session.status === "paused") && next.session.current) {
          if (shortcut && !modeOf(next)?.timed) {
            pauseClock(next, action.atMs, effects);
            next.session.clock = createClock(next.session.mode, next.session.clock.generation + 1);
            next.session.clock.limitMs = SNIPPET_DURATIONS[next.session.step] * 1000;
            next.session.clock.remainingMs = next.session.clock.limitMs;
            next.session.current.hasPlayed = false;
            next.session.status = "paused";
            next.session.playbackRequested = true;
            effects.push({ type: "AUDIO_PLAY", round: clone(next.session.current), rewind: true });
          } else if (next.session.playbackRequested) {
            pauseClock(next, action.atMs, effects);
            next.session.status = "paused";
            next.session.playbackRequested = false;
            effects.push({ type: "AUDIO_PAUSE", sessionId: next.session.id, roundId: next.session.current.id });
          } else {
            if (!modeOf(next)?.timed) {
              next.session.clock = createClock(next.session.mode, next.session.clock.generation + 1);
              next.session.clock.limitMs = SNIPPET_DURATIONS[next.session.step] * 1000;
              next.session.clock.remainingMs = next.session.clock.limitMs;
              next.session.current.hasPlayed = false;
              next.session.status = "paused";
            }
            next.session.playbackRequested = true;
            effects.push({ type: "AUDIO_PLAY", round: clone(next.session.current), rewind: !modeOf(next)?.timed });
          }
        } else return noChange(state);
        break;
      }

      case "PLAYER/SKIP":
        resolveAttempt(next, effects, "skip", "", action.atMs);
        break;

      case "PLAYER/GUESS": {
        const title = typeof action.title === "string" ? action.title.trim() : "";
        if (!title || !next.session.current) return noChange(state);
        if (!["active", "paused"].includes(next.session.status) || isOverlayOpen(next)) return noChange(state);
        if (!Number.isSafeInteger(next.catalog.indexes.byTitle[title]) || next.session.usedTitles.includes(title)) return noChange(state);
        if (modeOf(next)?.timed && !next.session.current.hasPlayed) return noChange(state);
        next.session.usedTitles.push(title);
        resolveAttempt(next, effects, title === next.session.current.track.title ? "correct" : "wrong", title, action.atMs);
        break;
      }

      case "PLAYER/QUERY_CHANGED":
        next.input.query = String(action.query || "");
        next.input.selectedSuggestion = selectSuggestions(next).length ? 0 : -1;
        break;

      case "PLAYER/SUGGESTION_CHANGED": {
        const count = selectSuggestions(next).length;
        if (!count) return noChange(state);
        const selectedSuggestion = (action.index % count + count) % count;
        if (selectedSuggestion === next.input.selectedSuggestion) return noChange(state);
        next.input.selectedSuggestion = selectedSuggestion;
        break;
      }

      case "INPUT/MODALITY_CHANGED":
        if (!["keyboard", "pointer-fine", "pointer-coarse"].includes(action.modality)) return noChange(state);
        next.input.modality = action.modality;
        break;

      case "PREVIEW/SET":
        if (isOverlayOpen(next) || !["idle", "preparing", "audio-retry", "result"].includes(next.session.status)) return noChange(state);
        if (action.kind === "discovery") next.app.previewText = TEXT.discovery;
        else if (action.mode && isMode(action.mode)) next.app.previewText = modeRulesText(next, action.mode);
        else return noChange(state);
        break;

      case "PREVIEW/CLEAR":
        if (next.app.previewText === null) return noChange(state);
        next.app.previewText = null;
        break;

      case "AUDIO/PREPARED": {
        const target = action.role === "standby" ? next.session.standby : next.session.pending;
        if (!matchesRound(target, action)) return noChange(state);
        target.prepared = true;
        if (action.role !== "standby") effects.push({ type: "AUDIO_PLAY", round: clone(target), rewind: false });
        break;
      }

      case "AUDIO/PLAYING": {
        if (matchesRound(next.session.pending, action)) {
          if (!next.session.playbackRequested) return noChange(state);
          const round = next.session.pending;
          next.session.pending = null;
          next.session.current = round;
          next.session.status = "active";
          next.session.playbackRequested = true;
          round.hasPlayed = true;
          next.session.previousDailyNumber = round.track.dailyNumber;
          next.session.usedTitles = [];
          next.session.rounds = Math.max(next.session.rounds, round.ordinal);
          next.session.notice = null;
          if (!modeOf(next)?.timed) {
            next.session.clock = createClock(next.session.mode, next.session.clock.generation + 1);
            next.session.clock.limitMs = SNIPPET_DURATIONS[next.session.step] * 1000;
            next.session.clock.remainingMs = next.session.clock.limitMs;
          }
          addPrompt(next, true);
          next.session.recovery.prefetchBlocked = false;
          next.session.recovery.retryOrdinal = null;
          if (next.session.mode === "daily") next.daily.retryRound = null;
          markDailyStarted(next, effects);
          startClock(next, effects, action.atMs);
          prefetchStandby(next, effects);
          if (next.input.modality !== "pointer-coarse") effects.push({ type: "FOCUS", target: "guess", modality: next.input.modality, sessionId: next.session.id, roundId: round.id });
        } else if (matchesRound(next.session.current, action)) {
          if (!next.session.playbackRequested) return noChange(state);
          next.session.current.hasPlayed = true;
          next.session.status = "active";
          next.session.playbackRequested = true;
          startClock(next, effects, action.atMs);
        } else return noChange(state);
        break;
      }

      case "AUDIO/WAITING":
        if (!matchesRound(next.session.current || next.session.pending, action)) return noChange(state);
        pauseClock(next, action.atMs, effects);
        break;

      case "AUDIO/BLOCKED":
        if (!matchesRound(next.session.current || next.session.pending, action)) return noChange(state);
        pauseClock(next, action.atMs, effects);
        next.session.status = next.session.current ? "paused" : "preparing";
        next.session.playbackRequested = false;
        effects.push({ type: "ANNOUNCE", message: "PRESS PLAY TO START THE AUDIO." });
        break;

      case "AUDIO/ENDED":
        if (!matchesRound(next.session.current, action) || !next.session.current.hasPlayed || next.session.status === "result") return noChange(state);
        pauseClock(next, action.atMs, effects);
        next.session.current.hasPlayed = false;
        next.session.status = "paused";
        next.session.playbackRequested = false;
        if (modeOf(next)?.timed) resolveAttempt(next, effects, "skip", "", action.atMs);
        break;

      case "AUDIO/FAILED":
        if (!handleAudioFailure(next, action, effects)) return noChange(state);
        break;

      case "CLOCK/EXPIRED":
        if (action.sessionId !== next.session.id || action.generation !== next.session.clock.generation || next.session.status === "result" || !next.session.current || !next.session.clock.running) return noChange(state);
        updateClockAt(next.session.clock, action.atMs);
        next.session.clock.remainingMs = 0;
        next.session.clock.expired = true;
        next.session.clock.running = false;
        next.session.clock.anchorMs = null;
        if (modeOf(next)?.timed) finishGame(next, effects, false, action.atMs);
        else {
          next.session.status = "paused";
          next.session.playbackRequested = false;
          effects.push({ type: "AUDIO_PAUSE", sessionId: next.session.id, roundId: next.session.current?.id || null });
        }
        break;

      case "CLOCK/RESYNCHRONIZED":
        if (action.sessionId !== next.session.id || action.generation !== next.session.clock.generation || !next.session.current || !next.session.clock.running) return noChange(state);
        updateClockAt(next.session.clock, action.atMs);
        if (next.session.clock.expired && modeOf(next)?.timed) finishGame(next, effects, false, action.atMs);
        break;

      case "OVERLAY/OPEN_REQUESTED": {
        if (!OVERLAY_KINDS.includes(action.kind) || isOverlayOpen(next)) return noChange(state);
        if (action.kind === "result" && next.session.status !== "result") return noChange(state);
        if (action.kind === "discovery" && next.session.status === "result") return noChange(state);
        let suspension = null;
        if (action.kind === "discovery" && (next.session.current || next.session.pending)) {
          const round = next.session.current || next.session.pending;
          const shouldResume = next.session.playbackRequested;
          pauseClock(next, action.atMs, effects);
          suspension = {
            sessionId: next.session.id,
            roundId: round.id,
            audioGeneration: round.audioGeneration,
            shouldResume,
          };
          next.session.playbackRequested = false;
          if (next.session.status === "active") next.session.status = "paused";
          effects.push({ type: "AUDIO_SUSPEND", round: clone(round) });
        }
        const generation = next.overlay.generation + 1;
        next.overlay = { kind: action.kind, phase: "opening", generation, returnFocus: action.returnFocus || null, suspension };
        effects.push({ type: "OVERLAY_SYNC", kind: action.kind, phase: "opening", generation, returnFocus: next.overlay.returnFocus });
        break;
      }

      case "OVERLAY/CLOSE_REQUESTED": {
        if (!isOverlayOpen(next) || !next.overlay.kind || (action.kind && action.kind !== next.overlay.kind)) return noChange(state);
        const generation = next.overlay.generation + 1;
        const kind = next.overlay.kind;
        next.overlay.phase = "closing";
        next.overlay.generation = generation;
        effects.push({ type: "OVERLAY_SYNC", kind, phase: "closing", generation, returnFocus: next.overlay.returnFocus });
        break;
      }

      case "OVERLAY/TRANSITION_COMPLETED": {
        if (next.overlay.kind !== action.kind || next.overlay.generation !== action.generation || next.overlay.phase !== action.phase) return noChange(state);
        if (action.phase === "opening") next.overlay.phase = "open";
        else {
          const suspension = next.overlay.suspension;
          next.overlay = { kind: null, phase: "closed", generation: next.overlay.generation, returnFocus: null, suspension: null };
          if (action.kind === "result") {
            const modeName = next.session.mode;
            if (modeName) {
              if (next.catalog.staged) {
                const staged = next.catalog.staged;
                applyCatalog(next, staged.tracks, staged.date, effects);
              } else if (modeName === "daily" && next.daily.roundDate !== next.app.budapestDate) {
                next.daily.roundDate = next.app.budapestDate;
              }
              resetSession(next, effects, modeName);
              effects.push({ type: "FOCUS", target: "play", modality: next.input.modality, sessionId: next.session.id, roundId: null });
            }
          } else if (
            suspension &&
            (next.session.current || next.session.pending) &&
            suspension.sessionId === next.session.id &&
            suspension.roundId === (next.session.current || next.session.pending).id &&
            suspension.audioGeneration === (next.session.current || next.session.pending).audioGeneration
          ) {
            next.session.playbackRequested = suspension.shouldResume;
            effects.push({ type: "AUDIO_RESTORE", round: clone(next.session.current || next.session.pending) });
          }
        }
        break;
      }

      case "DISCOVERY/RESET":
        if (next.overlay.kind !== "discovery" || !isOverlayOpen(next)) return noChange(state);
        next.discovery.dailyNumbers = [];
        queueStorageWrite(next, effects, STORAGE_KEYS.discoveries, []);
        break;

      default:
        return noChange(state);
    }
    return { state: next, effects };
  }

  /** @param {GameState} state @param {ModeName} modeName @returns {string} */
  function modeRulesText(state, modeName) {
    if (state.session.mode === modeName && state.session.notice === "track-audio-error") return TEXT.trackError;
    if (state.session.mode === modeName && state.session.notice === "daily-audio-error") return TEXT.dailyTrackError;
    if (modeName === "daily" && state.session.mode === "daily") {
      if (dailyCatalogPending(state)) return state.catalog.status === "error" ? TEXT.dailyCatalogError : TEXT.dailyCatalogLoading;
      if (dailyDone(state)) {
        const attempts = state.daily.progress.step + 1;
        return `${state.daily.progress.won ? "COMPLETED" : "FAILED"} IN ${attempts} ATTEMPT${attempts === 1 ? "" : "S"}, COME BACK TOMORROW`;
      }
      if (dailyInProgress(state)) return `DAILY IN PROGRESS, CONTINUE FROM ATTEMPT ${state.daily.progress.step + 1}`;
    }
    return MODE_DEFINITIONS[modeName].description;
  }

  /** @param {GameState} state @returns {string} */
  function persistentRulesText(state) {
    if (state.app.status === "loading") return state.app.catalogError ? TEXT.catalogError : TEXT.loadingCatalog;
    if (state.app.status === "error") return TEXT.catalogError;
    if (!state.session.mode) return TEXT.modePrompt;
    if (state.session.status === "preparing") return TEXT.loadingTrack;
    return modeRulesText(state, state.session.mode);
  }

  /** @param {GameState} state @returns {string[]} */
  function selectSuggestions(state) {
    const query = state.input.query.trim().toLocaleLowerCase();
    if (!query) return [];
    const used = new Set(state.session.usedTitles);
    return state.catalog.indexes.search
      .filter((/** @type {{index:number, normalized:string}} */ entry) => entry.normalized.includes(query) && !used.has(state.catalog.tracks[entry.index].title))
      .slice(0, 8)
      .map((/** @type {{index:number, normalized:string}} */ entry) => state.catalog.tracks[entry.index].title);
  }

  /** @param {GameState} state */
  function selectView(state) {
    const mode = modeOf(state);
    const overlayOpen = isOverlayOpen(state);
    const inputVisible = Boolean(state.session.current && (state.session.status === "active" || state.session.status === "paused"));
    const dailyBlocked = Boolean(mode?.daily && (dailyCatalogPending(state) || (dailyDone(state) && !state.session.current)));
    const playStatus = ["idle", "active", "paused", "audio-retry"].includes(state.session.status) || (state.session.status === "preparing" && state.session.pending && !state.session.playbackRequested);
    const playEnabled = Boolean(state.app.status === "ready" && mode && !overlayOpen && !dailyBlocked && playStatus);
    const roundControls = Boolean(state.app.status === "ready" && state.session.current && !overlayOpen && (state.session.status === "active" || state.session.status === "paused"));
    const modesEnabled = state.app.status !== "error";
    const discovered = new Set(state.discovery.dailyNumbers);
    const discoveryItems = [...state.catalog.tracks].sort((a, b) => b.dailyNumber - a.dailyNumber).map((track) => ({
      dailyNumber: track.dailyNumber,
      title: discovered.has(track.dailyNumber) ? track.title : HIDDEN_TITLE,
      discovered: discovered.has(track.dailyNumber),
      isNew: track.isNew && !discovered.has(track.dailyNumber),
    }));
    return {
      appStatus: state.app.status,
      sessionStatus: state.session.status,
      mode: state.session.mode,
      selectedMode: state.session.mode,
      selectedModeDisabled: Boolean(state.session.mode),
      modesEnabled,
      modeButtons: MODE_NAMES.map((name) => ({
        name,
        selected: name === state.session.mode,
        disabled: !modesEnabled || name === state.session.mode,
        ariaPressed: name === state.session.mode,
      })),
      awaitingMode: state.app.status === "awaiting-mode",
      rulesText: state.app.previewText || persistentRulesText(state),
      inputVisible,
      playEnabled,
      skipEnabled: roundControls,
      guessEnabled: roundControls,
      playbackIcon: state.session.playbackRequested ? mode?.timed ? "pause" : "stop" : "play",
      history: clone(state.session.history),
      suggestions: selectSuggestions(state),
      selectedSuggestion: state.input.selectedSuggestion,
      clock: clone(state.session.clock),
      snippetSeconds: SNIPPET_DURATIONS[state.session.step],
      endTime: mode?.timed ? mode.endTime : `0:${String(SNIPPET_DURATIONS[state.session.step]).padStart(2, "0")}`,
      skipText: mode?.timed ? "SKIP" : state.session.step === SNIPPET_DURATIONS.length - 1 ? "GIVE UP" : `ADD ${SNIPPET_DURATIONS[state.session.step + 1] - SNIPPET_DURATIONS[state.session.step]}S`,
      overlay: clone(state.overlay),
      result: clone(state.session.result),
      discovery: {
        found: discoveryItems.filter((item) => item.discovered).length,
        total: discoveryItems.length,
        items: discoveryItems,
      },
      backgroundInert: overlayOpen,
      inert: {
        headerAction: overlayOpen,
        modes: overlayOpen,
        board: overlayOpen || state.app.status === "awaiting-mode",
        slots: overlayOpen || state.app.status === "awaiting-mode",
      },
      rootClasses: [
        `app-${state.app.status}`,
        `session-${state.session.status}`,
        state.app.status === "awaiting-mode" ? "awaiting-mode" : "",
        !inputVisible ? "rules-visible" : "",
        mode?.timed ? "timed" : "",
        state.app.status === "error" ? "mode-error" : "",
      ].filter(Boolean),
    };
  }

  /** @param {unknown} value @param {string} [path] @param {Set<object>} [seen] @returns {string[]} */
  function serializabilityErrors(value, path = "state", seen = new Set()) {
    /** @type {string[]} */
    const errors = [];
    if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") return [`${path} is not serializable.`];
    if (typeof value === "number" && !Number.isFinite(value)) return [`${path} is not a finite number.`];
    if (!value || typeof value !== "object") return errors;
    if (seen.has(value)) return [`${path} contains a cycle.`];
    if (value instanceof Set || value instanceof Map || value instanceof Date || (typeof Promise === "function" && value instanceof Promise)) return [`${path} contains a forbidden object.`];
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) return [`${path} is not a plain object or array.`];
    seen.add(value);
    const record = /** @type {Record<string, unknown>} */ (value);
    for (const key of Object.keys(record)) errors.push(...serializabilityErrors(record[key], Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`, seen));
    seen.delete(value);
    return errors;
  }

  /** @param {GameState} state @returns {string[]} */
  function checkInvariants(state) {
    const errors = serializabilityErrors(state);
    if (!APP_STATUSES.includes(state?.app?.status)) errors.push("Invalid app lifecycle state.");
    if (!SESSION_STATUSES.includes(state?.session?.status)) errors.push("Invalid session lifecycle state.");
    if (state?.session?.mode !== null && !isMode(state.session.mode)) errors.push("Invalid mode.");
    if (!OVERLAY_PHASES.includes(state?.overlay?.phase)) errors.push("Invalid overlay phase.");
    if (state?.overlay?.kind !== null && !OVERLAY_KINDS.includes(state.overlay.kind)) errors.push("Invalid overlay kind.");
    if (state?.overlay?.phase === "closed" && state.overlay.kind !== null) errors.push("A closed overlay must not own a kind.");
    if (state?.overlay?.phase !== "closed" && state?.overlay?.kind === null) errors.push("An active overlay phase requires a kind.");
    if (state?.session?.status === "preparing" && !state.session.pending) errors.push("Preparing requires a pending round.");
    if (["active", "paused", "result"].includes(state?.session?.status) && !state.session.current) errors.push(`${state.session.status} requires a current round.`);
    if (state?.session?.current && state.session.pending) errors.push("Current and pending rounds are mutually exclusive.");
    if (state?.session?.playbackRequested && !state.session.current && !state.session.pending) errors.push("Playback intent requires a current or pending round.");
    for (const round of [state?.session?.current, state?.session?.pending, state?.session?.standby].filter(Boolean)) {
      if (round.sessionId !== state.session.id) errors.push("A round belongs to a stale session.");
    }
    for (const round of [state?.session?.current, state?.session?.pending].filter(Boolean)) {
      if (round.modeName !== state.session.mode) errors.push("An owned round must match the selected mode.");
      if (!Number.isSafeInteger(round.audioGeneration) || round.audioGeneration <= 0 || round.audioGeneration > state.session.nextAudioGeneration) {
        errors.push("An owned round has invalid audio generation ownership.");
      }
    }
    if (!Number.isSafeInteger(state?.session?.rounds) || state.session.rounds < 0) errors.push("Invalid round count.");
    if (state?.session?.current && state.session.current.ordinal !== state.session.rounds) errors.push("Current round ordinal must equal the displayed round count.");
    if (state?.session?.pending) {
      const nextOrdinal = state.session.rounds + 1;
      const retryOrdinal = state.session.recovery.retryOrdinal;
      if (state.session.pending.ordinal !== nextOrdinal && state.session.pending.ordinal !== retryOrdinal) {
        errors.push("Pending round ordinal must be the next round or the explicit retry ordinal.");
      }
      if (state.session.pending.ordinal <= state.session.rounds && state.session.pending.ordinal !== retryOrdinal) {
        errors.push("Pending round ordinal is already included in committed rounds.");
      }
    }
    if (
      state?.session?.recovery?.retryOrdinal !== null &&
      (!Number.isSafeInteger(state.session.recovery.retryOrdinal) || state.session.recovery.retryOrdinal <= 0 || state.session.recovery.retryOrdinal > state.session.rounds)
    ) errors.push("Invalid technical retry ordinal.");
    if (state?.session?.mode === "daily") {
      for (const round of [state.session.current, state.session.pending].filter(Boolean)) {
        if (!state.daily.progress.dailyNumber || round.track.dailyNumber !== state.daily.progress.dailyNumber) {
          errors.push("Daily round identity must match persisted Daily progress.");
        }
      }
    }
    if (!Number.isSafeInteger(state?.session?.step) || state.session.step < 0 || state.session.step >= SNIPPET_DURATIONS.length) errors.push("Invalid snippet step.");
    if (state?.session?.correct > state?.session?.guesses) errors.push("Correct guesses exceed counted guesses.");
    const historyIds = state?.session?.history?.map((/** @type {any} */ entry) => entry.id) || [];
    if (new Set(historyIds).size !== historyIds.length) errors.push("History entry IDs are not unique.");
    if (state?.session?.promptEntryId !== null && !historyIds.includes(state.session.promptEntryId)) errors.push("Prompt history owner is missing.");
    if (state?.session?.retryEntryId !== null && !historyIds.includes(state.session.retryEntryId)) errors.push("Retry history owner is missing.");
    const promptOwner = state?.session?.history?.find((/** @type {any} */ entry) => entry.id === state.session.promptEntryId);
    const retryOwner = state?.session?.history?.find((/** @type {any} */ entry) => entry.id === state.session.retryEntryId);
    if (promptOwner && promptOwner.status !== "prompt") errors.push("Prompt history owner must reference a prompt entry.");
    if (retryOwner && retryOwner.status !== "technical") errors.push("Retry history owner must reference a technical entry.");
    if (state?.session?.clock?.remainingMs < 0 || state?.session?.clock?.elapsedMs < 0) errors.push("Clock values cannot be negative.");
    const numbers = state?.catalog?.tracks?.map((/** @type {Track} */ track) => track.dailyNumber) || [];
    if (new Set(numbers).size !== numbers.length) errors.push("Catalog daily numbers are not unique.");
    return errors;
  }

  /** @param {GameState} state @returns {true} */
  function assertInvariants(state) {
    const errors = checkInvariants(state);
    if (errors.length) throw new Error(`Corzaguessr engine invariant failure:\n- ${errors.join("\n- ")}`);
    return true;
  }

  return Object.freeze({
    createInitialState,
    reduce,
    selectView,
    selectSuggestions,
    validateTracks,
    checkInvariants,
    assertInvariants,
    nextRandom,
    hashDaily,
    MODE_DEFINITIONS,
    MODE_STRATEGIES,
    SNIPPET_DURATIONS,
    STORAGE_KEYS,
    TEXT,
  });
});

// @ts-check

/**
 * @typedef {object} Track
 * @property {string} title
 * @property {number} duration
 * @property {string} spotify
 * @property {number} dailyNumber
 * @property {string} dailyFrom
 * @property {boolean} isNew
 * @property {number} at
 */

/**
 * @typedef {object} Round
 * @property {number} id
 * @property {number} sessionId
 * @property {number} audioGeneration
 * @property {Track} track
 */

/** @typedef {"empty"|"active"|"standby"} AudioRole */
/** @typedef {"active"|"standby"} AssignedAudioRole */
/** @typedef {"empty"|"paused"|"starting"|"playing"|"buffering"|"ended"|"error"} TransportPhase */
/** @typedef {"prepared"|"playing"|"waiting"|"ended"|"blocked"|"failed"} AudioEventType */

/**
 * @typedef {object} AudioSlot
 * @property {number} id
 * @property {HTMLMediaElement} element
 * @property {number} generation
 * @property {AudioRole} role
 * @property {Round|null} round
 * @property {AbortController|null} events
 * @property {boolean} failed
 */

/**
 * @typedef {object} AudioEventPayload
 * @property {Round} round
 * @property {AudioRole} role
 * @property {number} slotId
 * @property {number} generation
 */

/**
 * @typedef {object} AudioDeckEvent
 * @property {AudioEventType} type
 * @property {Round} round
 * @property {AudioRole} role
 * @property {number} slotId
 * @property {number} generation
 * @property {unknown} [error]
 */

/**
 * @typedef {object} AudioSuspension
 * @property {number} slotId
 * @property {number} generation
 * @property {Round} round
 * @property {boolean} shouldResume
 * @property {AudioDeckEvent|null} terminal
 */

/**
 * @typedef {object} RoundIdentity
 * @property {number} sessionId
 * @property {number} roundId
 * @property {number} audioGeneration
 */

/**
 * @typedef {object} ActiveRoundIdentity
 * @property {number} sessionId
 * @property {number|null} roundId
 */

/**
 * @typedef {object} AudioDeckOptions
 * @property {HTMLMediaElement[]} elements
 * @property {(round: Round) => string} sourceForRound
 * @property {(event: AudioDeckEvent) => void} onEvent
 */

/**
 * @typedef {object} ClockState
 * @property {"classic"|"blitz"|"survival"} kind
 * @property {boolean} running
 * @property {number|null} anchorMs
 * @property {number} elapsedMs
 * @property {number} remainingMs
 * @property {number} limitMs
 * @property {number} maxRemainingMs
 * @property {boolean} expired
 */

/**
 * @typedef {object} ClockSchedule
 * @property {number} sessionId
 * @property {number} generation
 * @property {number} anchorMs
 * @property {number} remainingMs
 */

/**
 * @typedef {object} ClockOwner
 * @property {number} sessionId
 * @property {number} generation
 * @property {number} token
 */

/**
 * @typedef {object} ClockExpiry
 * @property {number} sessionId
 * @property {number} generation
 * @property {number} atMs
 */

/**
 * @typedef {object} ClockPresenterOptions
 * @property {() => ClockState|null} getClock
 * @property {(sample: ClockState) => void} onSample
 * @property {(expiry: ClockExpiry) => void} onExpired
 * @property {() => number} [now]
 * @property {(callback: FrameRequestCallback) => number} [requestFrame]
 * @property {(handle: number) => void} [cancelFrame]
 * @property {(callback: () => void, delay: number) => number} [setTimer]
 * @property {(handle: number) => void} [clearTimer]
 */

/**
 * @typedef {object} BudapestDateOptions
 * @property {(date: string) => void} onDate
 */

(function installCorzaguessrAdapters(/** @type {any} */ globalScope, /** @type {() => object} */ factory) {
  "use strict";
  const api = factory();
  if (globalScope && typeof globalScope === "object") globalScope.CorzaguessrAdapters = api;
})(typeof globalThis === "object" ? globalThis : this, function createAdapterApi() {
  "use strict";

  /** @param {Round|null|undefined} left @param {Round|null|undefined} right */
  const sameRound = (left, right) => Boolean(
    left && right &&
    left.sessionId === right.sessionId &&
    left.id === right.id &&
    left.audioGeneration === right.audioGeneration
  );

  /** @param {AudioDeckOptions} options */
  function createAudioDeck({ elements, sourceForRound, onEvent }) {
    /** @type {AudioSlot[]} */
    const slots = elements.map((element, id) => ({
      id, element, generation: 0, role: /** @type {AudioRole} */ ("empty"), round: null, events: null, failed: false,
    }));
    /** @type {AudioSlot|null} */
    let active = null;
    /** @type {AudioSlot|null} */
    let standby = null;
    /** @type {number|null} */
    let lastActiveSlotId = null;
    /** @type {TransportPhase} */
    let phase = "empty";
    /** @type {AudioSuspension|null} */
    let suspension = null;

    /** @param {AudioSlot|null|undefined} slot @param {AudioRole} [role] @returns {AudioEventPayload|null} */
    const snapshot = (slot, role = slot ? slot.role : "empty") => slot && slot.round ? {
      round: slot.round,
      role,
      slotId: slot.id,
      generation: slot.generation,
    } : null;
    /** @param {AudioSlot|null|undefined} slot @param {number} generation @param {Round|null} round */
    const live = (slot, generation, round) => Boolean(
      slot && slot.generation === generation && slot.role !== "empty" && sameRound(slot.round, round)
    );
    /** @param {AudioSlot|null|undefined} slot */
    const suspendedSlot = (slot) => Boolean(
      suspension && slot && suspension.slotId === slot.id && suspension.generation === slot.generation && sameRound(suspension.round, slot.round)
    );

    /** @param {AudioSlot|null|undefined} slot */
    function seek(slot) {
      if (!slot?.round || slot.element.readyState < HTMLMediaElement.HAVE_METADATA) return;
      try {
        slot.element.currentTime = Math.min(slot.round.track.at, Math.max(0, slot.element.duration - 0.05));
      } catch {
        // The media fragment remains the fallback until seeking is available.
      }
    }

    /** @param {AudioSlot|null|undefined} slot */
    function releaseSlot(slot) {
      if (!slot) return;
      slot.events?.abort();
      slot.events = null;
      slot.role = "empty";
      slot.round = null;
      slot.failed = false;
      const element = slot.element;
      element.pause();
      element.removeAttribute("src");
      element.load();
      const fresh = /** @type {HTMLMediaElement} */ (element.cloneNode(false));
      element.replaceWith(fresh);
      slot.element = fresh;
    }

    /** @param {AudioSlot|null|undefined} slot @param {AudioEventType} type @param {AudioRole} [role] @param {unknown} [error] */
    function emit(slot, type, role = slot ? slot.role : "empty", error = null) {
      const payload = snapshot(slot, role);
      if (!payload) return;
      onEvent({ type, ...payload, error });
    }

    /** @param {AudioSlot|null|undefined} slot @param {AssignedAudioRole} role @param {unknown} error */
    function fail(slot, role, error) {
      if (!slot || slot.failed || !slot.round) return;
      slot.failed = true;
      if (role === "standby") {
        standby = standby === slot ? null : standby;
        const payload = snapshot(slot, role);
        releaseSlot(slot);
        if (payload) onEvent({ type: "failed", ...payload, error });
        return;
      }
      phase = "error";
      if (suspension && suspendedSlot(slot)) {
        const payload = snapshot(slot, "active");
        if (payload) suspension.terminal = { type: "failed", ...payload, error };
        return;
      }
      emit(slot, "failed", "active", error);
    }

    /** @param {AudioSlot} slot */
    function bind(slot) {
      const generation = slot.generation;
      const round = slot.round;
      const controller = new AbortController();
      const current = () => live(slot, generation, round);
      slot.events = controller;
      slot.element.addEventListener("loadedmetadata", () => current() && seek(slot), { signal: controller.signal });
      slot.element.addEventListener("playing", () => {
        if (!current() || slot !== active || (phase !== "starting" && phase !== "buffering")) return;
        phase = "playing";
        emit(slot, "playing", "active");
      }, { signal: controller.signal });
      slot.element.addEventListener("waiting", () => {
        if (!current() || slot !== active || phase === "paused") return;
        phase = "buffering";
        emit(slot, "waiting", "active");
      }, { signal: controller.signal });
      slot.element.addEventListener("ended", () => {
        if (!current() || slot !== active) return;
        phase = "ended";
        const payload = snapshot(slot, "active");
        if (suspension && suspendedSlot(slot) && payload) suspension.terminal = { type: "ended", ...payload };
        else emit(slot, "ended", "active");
      }, { signal: controller.signal });
      slot.element.addEventListener("error", () => {
        if (!current() || !slot.element.error) return;
        fail(slot, slot === standby ? "standby" : "active", slot.element.error);
      }, { signal: controller.signal });
    }

    /** @param {AudioSlot|null} [exclude] @returns {AudioSlot|null} */
    function chooseSlot(exclude = null) {
      const available = slots.filter((slot) => slot !== exclude);
      return available.find((slot) => slot.id !== lastActiveSlotId) || available[0] || null;
    }

    /** @param {Round} round @param {AssignedAudioRole} role */
    function assign(round, role) {
      /** @type {AudioSlot|null} */
      let slot;
      if (role === "standby") {
        if (standby) releaseSlot(standby);
        standby = null;
        slot = chooseSlot(active);
      } else {
        if (active) {
          lastActiveSlotId = active.id;
          releaseSlot(active);
        }
        active = null;
        slot = chooseSlot(standby);
      }
      if (!slot) return false;
      releaseSlot(slot);
      Object.assign(slot, {
        generation: round.audioGeneration,
        role,
        round,
        failed: false,
      });
      if (role === "standby") standby = slot;
      else {
        active = slot;
        phase = "paused";
      }
      slot.element.preload = "auto";
      bind(slot);
      slot.element.src = sourceForRound(round);
      slot.element.load();
      if (slot.element.error) {
        fail(slot, role, slot.element.error);
        return false;
      }
      emit(slot, "prepared", role);
      return true;
    }

    /** @param {Round} round */
    function promoteAndPlay(round) {
      const slot = standby;
      if (!slot || !sameRound(slot.round, round)) {
        onEvent({ type: "failed", role: "active", round, slotId: -1, generation: round.audioGeneration, error: new Error("Prepared audio is unavailable.") });
        return false;
      }
      const error = slot.element.error;
      if (slot.failed || error) {
        const payload = snapshot(slot, "active");
        standby = null;
        releaseSlot(slot);
        if (payload) onEvent({ type: "failed", ...payload, error: error || new Error("Prepared audio failed before promotion.") });
        return false;
      }
      const previous = active;
      active = slot;
      standby = null;
      active.role = "active";
      phase = "paused";
      if (previous && previous !== active) {
        lastActiveSlotId = previous.id;
        releaseSlot(previous);
      }
      return play(round, false);
    }

    /** @param {Round} round @param {boolean} [rewind] */
    function play(round, rewind = false) {
      const slot = active;
      if (!slot || !sameRound(slot.round, round)) return false;
      const generation = slot.generation;
      if (rewind) {
        // A seek on already-playing media is not guaranteed to emit another
        // `playing` event. Force a real transport restart so the reducer can
        // safely use that event as the clock/round commit boundary.
        slot.element.pause();
        seek(slot);
      }
      phase = "starting";
      const promise = slot.element.play();
      promise?.catch((/** @type {any} */ error) => {
        if (!live(slot, generation, round) || slot !== active || error?.name === "AbortError") return;
        if (error?.name === "NotAllowedError") {
          phase = "paused";
          emit(slot, "blocked", "active", error);
        } else fail(slot, "active", error);
      });
      return true;
    }

    function pauseActive() {
      if (!active) return false;
      phase = "paused";
      active.element.pause();
      return true;
    }

    function releaseActive() {
      if (!active) return false;
      lastActiveSlotId = active.id;
      const slot = active;
      active = null;
      suspension = null;
      releaseSlot(slot);
      if (!active) phase = standby ? "paused" : "empty";
      return true;
    }

    /** @param {ActiveRoundIdentity} identity */
    function matchesActiveIdentity(identity) {
      return Boolean(
        identity && active?.round &&
        active.round.sessionId === identity.sessionId &&
        (identity.roundId === null || active.round.id === identity.roundId)
      );
    }

    /** @param {ActiveRoundIdentity} identity */
    function pause(identity) {
      if (!matchesActiveIdentity(identity)) return false;
      return pauseActive();
    }

    /** @param {ActiveRoundIdentity} identity */
    function release(identity) {
      if (!matchesActiveIdentity(identity)) return false;
      return releaseActive();
    }

    function reset() {
      releaseActive();
      if (standby) {
        const slot = standby;
        standby = null;
        releaseSlot(slot);
      }
      suspension = null;
      phase = "empty";
    }

    /** @param {RoundIdentity} identity */
    function discardStandby(identity) {
      if (!standby || !standby.round ||
          standby.round.sessionId !== identity.sessionId ||
          standby.round.id !== identity.roundId ||
          standby.round.audioGeneration !== identity.audioGeneration) return false;
      const slot = standby;
      standby = null;
      releaseSlot(slot);
      if (!active) phase = "empty";
      return true;
    }

    /** @param {Round} round */
    function suspend(round) {
      if (!active || !sameRound(active.round, round)) return false;
      suspension = {
        slotId: active.id,
        generation: active.generation,
        round,
        shouldResume: ["starting", "playing", "buffering"].includes(phase),
        terminal: null,
      };
      pauseActive();
      return true;
    }

    /** @param {Round} round */
    function restore(round) {
      if (!active || !suspension || !sameRound(active.round, round) || !sameRound(suspension.round, round)) {
        suspension = null;
        return false;
      }
      const saved = suspension;
      suspension = null;
      if (saved.terminal) {
        onEvent(saved.terminal);
        return true;
      }
      if (saved.shouldResume) return play(round, false);
      return true;
    }

    return Object.freeze({ assign, promoteAndPlay, play, pause, release, reset, discardStandby, suspend, restore });
  }

  /** @param {ClockPresenterOptions} options */
  function createClockPresenter({
    getClock,
    onSample,
    onExpired,
    now = () => performance.now(),
    requestFrame = (callback) => requestAnimationFrame(callback),
    cancelFrame = (handle) => cancelAnimationFrame(handle),
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = (handle) => clearTimeout(handle),
  }) {
    /** @type {ClockOwner|null} */
    let owner = null;
    let nextToken = 0;
    let expiryTimer = 0;
    let frame = 0;

    function stopFrame() {
      if (!frame) return;
      cancelFrame(frame);
      frame = 0;
    }

    function stopTimer() {
      if (!expiryTimer) return;
      clearTimer(expiryTimer);
      expiryTimer = 0;
    }

    /** @param {number} [atMs] @returns {ClockState|null} */
    function sample(atMs = now()) {
      const clock = getClock();
      if (!clock) return null;
      const result = { ...clock };
      if (clock.running && clock.anchorMs !== null) {
        const delta = Math.max(0, atMs - clock.anchorMs);
        result.elapsedMs += delta;
        result.remainingMs = clock.kind === "classic"
          ? Math.max(0, clock.limitMs - result.elapsedMs)
          : Math.max(0, clock.remainingMs - delta);
      }
      return result;
    }

    /** @param {number} atMs @param {ClockOwner} scheduledOwner */
    function tick(atMs, scheduledOwner) {
      if (owner !== scheduledOwner) return;
      frame = 0;
      const current = sample(atMs);
      if (current) onSample(current);
      if (owner === scheduledOwner && current?.running && current.remainingMs > 0) {
        frame = requestFrame((nextMs) => tick(nextMs, scheduledOwner));
      }
    }

    /** @param {ClockSchedule} effect */
    function schedule(effect) {
      stopTimer();
      stopFrame();
      const scheduledOwner = {
        sessionId: effect.sessionId,
        generation: effect.generation,
        token: ++nextToken,
      };
      owner = scheduledOwner;
      const elapsedSinceAnchor = Math.max(0, now() - effect.anchorMs);
      const delay = Math.max(0, effect.remainingMs - elapsedSinceAnchor);
      expiryTimer = setTimer(() => {
        if (owner !== scheduledOwner) return;
        expiryTimer = 0;
        owner = null;
        stopFrame();
        onExpired({
          sessionId: scheduledOwner.sessionId,
          generation: scheduledOwner.generation,
          atMs: now(),
        });
      }, delay);
      frame = requestFrame((atMs) => tick(atMs, scheduledOwner));
    }

    /** @param {{sessionId:number,generation:number}|null} [effect] */
    function cancel(effect = null) {
      if (effect && owner && (effect.sessionId !== owner.sessionId || effect.generation !== owner.generation)) return false;
      owner = null;
      stopTimer();
      stopFrame();
      const current = sample();
      if (current) onSample(current);
      return true;
    }

    return Object.freeze({ schedule, cancel, sample });
  }

  /** @param {BudapestDateOptions} options */
  function createBudapestDateAdapter({ onDate }) {
    const formatter = new Intl.DateTimeFormat("en", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" });
    let timer = 0;
    let currentDate = "";
    /** @param {number} milliseconds */
    const dateAt = (milliseconds) => {
      const values = /** @type {Record<string,string>} */ (Object.fromEntries(formatter.formatToParts(new Date(milliseconds)).map(({ type, value }) => [type, value])));
      return `${values.year}-${values.month}-${values.day}`;
    };

    /** @param {number} nowMs @param {string} date */
    function nextBoundary(nowMs, date) {
      let low = nowMs;
      let high = nowMs + 30 * 60 * 60 * 1000;
      while (dateAt(high) === date) high += 6 * 60 * 60 * 1000;
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (dateAt(middle) === date) low = middle;
        else high = middle;
      }
      return high;
    }

    function schedule() {
      if (timer) clearTimeout(timer);
      const now = Date.now();
      const date = dateAt(now);
      currentDate = date;
      const delay = Math.max(1, nextBoundary(now, date) - now);
      timer = setTimeout(reconcile, delay);
    }

    function reconcile() {
      if (timer) clearTimeout(timer);
      timer = 0;
      const date = dateAt(Date.now());
      if (date !== currentDate) {
        currentDate = date;
        onDate(date);
      }
      schedule();
      return date;
    }

    function start() {
      currentDate = dateAt(Date.now());
      schedule();
      return currentDate;
    }

    function stop() {
      if (timer) clearTimeout(timer);
      timer = 0;
    }

    return Object.freeze({ start, stop, reconcile, getDate: () => dateAt(Date.now()) });
  }

  return Object.freeze({ createAudioDeck, createClockPresenter, createBudapestDateAdapter });
});

// @ts-check
(() => {
  "use strict";

  /** @typedef {"classic"|"daily"|"blitz"|"survival"} ModeName */
  /** @typedef {"loading"|"awaiting-mode"|"ready"|"error"} AppStatus */
  /** @typedef {"idle"|"preparing"|"active"|"paused"|"audio-retry"|"result"} SessionStatus */
  /** @typedef {"keyboard"|"pointer-fine"|"pointer-coarse"} InputModality */
  /** @typedef {"result"|"discovery"} OverlayKind */
  /** @typedef {"closed"|"opening"|"open"|"closing"} OverlayPhase */
  /** @typedef {"play"|"pause"|"stop"} PlaybackIcon */
  /** @typedef {"play"|"guess"|"discovery"} FocusTarget */
  /** @typedef {"active"|"standby"} AssignedAudioRole */

  /** @typedef {{title:string, duration:number, spotify:string, dailyNumber:number, dailyFrom:string, isNew:boolean}} Track */
  /** @typedef {{id:number, sessionId:number, audioGeneration:number, modeName:ModeName, catalogVersion:number, roundDate:string|null, prepared:boolean, hasPlayed:boolean, ordinal:number, track:Track & {at:number}}} Round */
  /** @typedef {{kind:"classic"|"blitz"|"survival", generation:number, running:boolean, anchorMs:number|null, elapsedMs:number, remainingMs:number, limitMs:number, maxRemainingMs:number, expired:boolean}} ClockState */
  /** @typedef {{id:number, text:string, tone:string, status?:string}} HistoryEntry */
  /** @typedef {{won:boolean, trackTitle:string, spotify:string, newPersonalBest:boolean, classicRun?:{won:boolean, streak:number, average:number}|null}} GameResult */
  /** @typedef {{classic:{current:number, best:number, snippetTotal:number, bestSnippetTotal:number}, daily:number, blitz:{score:number, accuracy:number|null}, survival:{score:number, accuracy:number|null}}} PersonalBests */
  /** @typedef {{kind:OverlayKind|null, phase:OverlayPhase, generation:number, returnFocus:FocusTarget|null}} OverlayState */
  /** @typedef {{date:string, dailyNumber:number|null, started:boolean, completed:boolean, won:boolean, step:number}} DailyProgress */
  /** @typedef {{id:number, mode:ModeName|null, status:SessionStatus, current:Round|null, pending:Round|null, playbackRequested:boolean, step:number, guesses:number, correct:number, history:HistoryEntry[], result:GameResult|null, clock:ClockState}} SessionState */
  /** @typedef {{app:{status:AppStatus}, session:SessionState, daily:{roundDate:string, progress:DailyProgress}, personalBests:PersonalBests, input:{query:string, selectedSuggestion:number, modality:InputModality}, overlay:OverlayState}} GameState */
  /** @typedef {{dailyNumber:number, title:string, discovered:boolean, isNew:boolean}} DiscoveryItem */
  /** @typedef {{appStatus:AppStatus, sessionStatus:SessionStatus, mode:ModeName|null, selectedMode:ModeName|null, modesEnabled:boolean, awaitingMode:boolean, rulesText:string, inputVisible:boolean, playEnabled:boolean, skipEnabled:boolean, guessEnabled:boolean, playbackIcon:PlaybackIcon, history:HistoryEntry[], suggestions:string[], snippetSeconds:number, skipText:string, overlay:OverlayState, discovery:{found:number, total:number, items:DiscoveryItem[]}}} ViewModel */
  /** @typedef {{timed:boolean, daily:boolean, survival:boolean, initialTimeMs:number, endTime:string}} ModeDefinition */
  /** @typedef {{discoveries:string, daily:string, personalBests:string}} StorageKeys */
  /** @typedef {{type:string, [key:string]:unknown}} ShellAction */

  /** @typedef {{type:"CATALOG_FETCH", requestId:number, date:string}} CatalogFetchEffect */
  /** @typedef {{type:"CATALOG_RETRY_SCHEDULE", requestId:number, date:string, delayMs:number}} CatalogRetryEffect */
  /** @typedef {{type:"STORAGE_LOAD", keys:StorageKeys}} StorageLoadEffect */
  /** @typedef {{type:"STORAGE_WRITE", requestId:number, key:string, value:unknown}} StorageWriteEffect */
  /** @typedef {{type:"AUDIO_RESET", sessionId:number}} AudioResetEffect */
  /** @typedef {{type:"AUDIO_PREPARE", role:AssignedAudioRole, round:Round}} AudioPrepareEffect */
  /** @typedef {{type:"AUDIO_PROMOTE_AND_PLAY", round:Round}} AudioPromoteEffect */
  /** @typedef {{type:"AUDIO_PLAY", round:Round, rewind:boolean}} AudioPlayEffect */
  /** @typedef {{type:"AUDIO_PAUSE", sessionId:number, roundId:number|null}} AudioPauseEffect */
  /** @typedef {{type:"AUDIO_RELEASE", sessionId:number, roundId:number|null}} AudioReleaseEffect */
  /** @typedef {{type:"AUDIO_DISCARD_STANDBY", sessionId:number, roundId:number, audioGeneration:number}} AudioDiscardEffect */
  /** @typedef {{type:"AUDIO_SUSPEND", round:Round}} AudioSuspendEffect */
  /** @typedef {{type:"AUDIO_RESTORE", round:Round}} AudioRestoreEffect */
  /** @typedef {{type:"CLOCK_CANCEL", sessionId:number, generation:number}} ClockCancelEffect */
  /** @typedef {{type:"CLOCK_SCHEDULE", sessionId:number, generation:number, anchorMs:number, remainingMs:number}} ClockScheduleEffect */
  /** @typedef {{type:"ANNOUNCE", message:string}} AnnounceEffect */
  /** @typedef {{type:"FEEDBACK_FLASH", sessionId:number, amountSeconds:number}} FeedbackEffect */
  /** @typedef {{type:"FOCUS", target:"play"|"guess", modality:InputModality, sessionId:number, roundId:number|null}} FocusEffect */
  /** @typedef {{type:"OVERLAY_SYNC", kind:OverlayKind, phase:"opening"|"closing", generation:number, returnFocus:FocusTarget|null}} OverlayEffect */
  /** @typedef {CatalogFetchEffect|CatalogRetryEffect|StorageLoadEffect|StorageWriteEffect|AudioResetEffect|AudioPrepareEffect|AudioPromoteEffect|AudioPlayEffect|AudioPauseEffect|AudioReleaseEffect|AudioDiscardEffect|AudioSuspendEffect|AudioRestoreEffect|ClockCancelEffect|ClockScheduleEffect|AnnounceEffect|FeedbackEffect|FocusEffect|OverlayEffect} Effect */

  /** @typedef {{type:"prepared"|"playing"|"waiting"|"ended"|"blocked"|"failed", round:Round, role:"empty"|AssignedAudioRole, error?:unknown}} AudioDeckEvent */
  /** @typedef {{assign:(round:Round, role:AssignedAudioRole)=>void, promoteAndPlay:(round:Round)=>boolean, play:(round:Round, rewind:boolean)=>boolean, pause:(identity:{sessionId:number, roundId:number|null})=>boolean, release:(identity:{sessionId:number, roundId:number|null})=>void, reset:()=>void, discardStandby:(identity:{sessionId:number, roundId:number, audioGeneration:number})=>boolean, suspend:(round:Round)=>boolean, restore:(round:Round)=>boolean}} AudioDeck */
  /** @typedef {{schedule:(schedule:ClockScheduleEffect)=>void, cancel:(owner:ClockCancelEffect)=>void}} ClockPresenter */
  /** @typedef {{start:()=>string, reconcile:()=>void}} BudapestDateAdapter */
  /** @typedef {{createAudioDeck:(options:{elements:HTMLMediaElement[], sourceForRound:(round:Round)=>string, onEvent:(event:AudioDeckEvent)=>void})=>AudioDeck, createClockPresenter:(options:{getClock:()=>ClockState|null, onSample:(sample:ClockState)=>void, onExpired:(expiry:{sessionId:number, generation:number, atMs:number})=>void})=>ClockPresenter, createBudapestDateAdapter:(options:{onDate:(date:string)=>void})=>BudapestDateAdapter}} AdapterApiShape */
  /** @typedef {{TEXT:{modePrompt:string}, STORAGE_KEYS:StorageKeys, MODE_DEFINITIONS:Record<ModeName,ModeDefinition>, SNIPPET_DURATIONS:readonly number[], createInitialState:(options:{date:string, seed:number, modality:InputModality})=>GameState, selectView:(state:GameState)=>ViewModel, reduce:(state:GameState, action:ShellAction)=>{state:GameState, effects:Effect[]}, selectSuggestions:(state:GameState)=>string[], checkInvariants:(state:GameState)=>string[], assertInvariants:(state:GameState)=>void}} EngineApiShape */
  /** @typedef {{CorzaguessrEngine?:unknown, CorzaguessrAdapters?:unknown, __CORZAGUESSR_TEST__?:unknown}} CorzaguessrGlobals */

  /** @type {typeof globalThis & CorzaguessrGlobals} */
  const runtimeGlobal = /** @type {typeof globalThis & CorzaguessrGlobals} */ (globalThis);
  const engineCandidate = /** @type {EngineApiShape|undefined} */ (runtimeGlobal.CorzaguessrEngine);
  const adapterCandidate = /** @type {AdapterApiShape|undefined} */ (runtimeGlobal.CorzaguessrAdapters);
  const rootCandidate = document.querySelector("#corzaguessr");
  if (!(rootCandidate instanceof HTMLElement) || rootCandidate.dataset.corzaguessrReady || !engineCandidate || !adapterCandidate) return;
  const Engine = engineCandidate;
  const AdapterApi = adapterCandidate;
  const root = rootCandidate;
  root.dataset.corzaguessrReady = "true";

  const currentScript = document.currentScript;
  const scriptUrl = new URL(currentScript instanceof HTMLScriptElement ? currentScript.src : location.href);
  const tracksUrl = new URL("tracks.json", scriptUrl);
  tracksUrl.search = scriptUrl.search;
  const audioFolderUrl = "https://cdn.jsdelivr.net/gh/HankeyThePoo/corzaguessr@main/tracks/";
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = matchMedia("(pointer: fine)");
  const interactiveSelector = "button, input, a, .suggest";
  /** @type {Record<"feedback"|"slot"|"result"|"discovery"|"progress", string>} */
  const durationProperties = {
    feedback: "--duration-feedback",
    slot: "--duration-slot",
    result: "--duration-result",
    discovery: "--duration-discovery",
    progress: "--duration-progress",
  };
  /** @type {Record<PlaybackIcon,string>} */
  const icons = {
    play: "M8 5v14l11-7z",
    pause: "M6 5h4v14H6zM14 5h4v14h-4z",
    stop: "M7 7h10v10H7z",
  };

  root.innerHTML = `
    <div class="wrap">
      <h1>CORZAGUESSR&#10022;</h1>
      <div class="row header-action">
        <button type="button" class="button discovery-button" aria-controls="corzaguessr-discovery" aria-expanded="false">DISCOVERY</button>
      </div>
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
              <button type="button" class="play" aria-label="PLAY" disabled>
                <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${icons.play}"></path></svg>
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
              <input id="corzaguessr-guess" class="guess" placeholder="HAVE A GUESS? SEARCH FOR IT HERE!" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="corzaguessr-suggestions" aria-expanded="false" disabled>
              <div class="ruleset" aria-hidden="true">
                <div class="ruleset-track">
                  <span class="ruleset-text">${Engine.TEXT.modePrompt}</span>
                  <span class="ruleset-copy">${Engine.TEXT.modePrompt}</span>
                </div>
              </div>
              <div id="corzaguessr-suggestions" class="suggest" role="listbox"></div>
            </div>
            <div class="row"><button type="button" class="button skip" disabled>ADD 1S</button></div>
          </div>
          <div class="slots" aria-live="polite" aria-relevant="additions text"></div>
        </div>
        <div class="result-modal">
          <div class="result-shell">
            <div class="corzaguessr-modal glass" role="dialog" aria-modal="true" aria-labelledby="corzaguessr-result-title" aria-describedby="corzaguessr-result-meta" aria-hidden="true">
              <h3 id="corzaguessr-result-title" class="modal-title"></h3>
              <div id="corzaguessr-result-meta" class="result-meta"></div>
              <div class="actions">
                <button type="button" class="button next">NEW GAME</button>
                <button type="button" class="button spotify">SPOTIFY</button>
              </div>
            </div>
          </div>
        </div>
        <p class="mode-prompt" role="status" aria-hidden="false">${Engine.TEXT.modePrompt}</p>
        <div id="corzaguessr-discovery" class="discovery-modal" role="dialog" aria-modal="true" aria-labelledby="corzaguessr-discovery-title" aria-hidden="true" tabindex="-1">
          <div class="discovery-shell">
            <div class="discovery-panel glass">
              <h3 id="corzaguessr-discovery-title" class="discovery-title"><span>DISCOVERY</span><small>0 / 0 (0%)</small></h3>
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

  /**
   * Query a required element once at bootstrap and retain its concrete type.
   * @template {Element} T
   * @param {string} selector
   * @returns {T}
   */
  function requiredElement(selector) {
    const element = root.querySelector(selector);
    if (!element) throw new Error(`Missing required Corzaguessr element: ${selector}`);
    return /** @type {T} */ (element);
  }

  const ui = {
    headerAction: /** @type {HTMLElement} */ (requiredElement(".header-action")), modes: /** @type {HTMLElement} */ (requiredElement(".modes")), card: /** @type {HTMLElement} */ (requiredElement(".card")), board: /** @type {HTMLElement} */ (requiredElement(".board")), slots: /** @type {HTMLElement} */ (requiredElement(".slots")),
    play: /** @type {HTMLButtonElement} */ (requiredElement(".play")), skip: /** @type {HTMLButtonElement} */ (requiredElement(".skip")), guess: /** @type {HTMLInputElement} */ (requiredElement(".guess")), suggest: /** @type {HTMLElement} */ (requiredElement(".suggest")), ruleset: /** @type {HTMLElement} */ (requiredElement(".ruleset")),
    rulesetText: /** @type {HTMLElement} */ (requiredElement(".ruleset-text")), rulesetCopy: /** @type {HTMLElement} */ (requiredElement(".ruleset-copy")), feedback: /** @type {HTMLElement} */ (requiredElement(".feedback")), timeChange: /** @type {HTMLElement} */ (requiredElement(".time-change")),
    timeChangeText: /** @type {HTMLElement} */ (requiredElement(".time-change span")), fill: /** @type {HTMLElement} */ (requiredElement(".fill")), snippet: /** @type {HTMLElement} */ (requiredElement(".snippet")), now: /** @type {HTMLElement} */ (requiredElement(".now")), endtime: /** @type {HTMLElement} */ (requiredElement(".endtime")),
    spotify: /** @type {HTMLButtonElement} */ (requiredElement(".spotify")), next: /** @type {HTMLButtonElement} */ (requiredElement(".next")), result: /** @type {HTMLElement} */ (requiredElement(".corzaguessr-modal")), resultTitle: /** @type {HTMLElement} */ (requiredElement(".modal-title")), resultMeta: /** @type {HTMLElement} */ (requiredElement(".result-meta")),
    modePrompt: /** @type {HTMLElement} */ (requiredElement(".mode-prompt")), discoveryButton: /** @type {HTMLButtonElement} */ (requiredElement(".discovery-button")), discoveryModal: /** @type {HTMLElement} */ (requiredElement(".discovery-modal")),
    discoveryShell: /** @type {HTMLElement} */ (requiredElement(".discovery-shell")), discoveryPanel: /** @type {HTMLElement} */ (requiredElement(".discovery-panel")), discoveryCount: /** @type {HTMLElement} */ (requiredElement("#corzaguessr-discovery-title small")),
    discoveryItems: /** @type {HTMLElement} */ (requiredElement(".discovery-items")), discoveryClose: /** @type {HTMLButtonElement} */ (requiredElement(".discovery-close")), discoveryReset: /** @type {HTMLButtonElement} */ (requiredElement(".discovery-reset")), status: /** @type {HTMLElement} */ (requiredElement(".status")),
    audioPlayers: /** @type {HTMLMediaElement[]} */ ([...root.querySelectorAll(".audio")]), icon: /** @type {SVGPathElement} */ (requiredElement(".icon path")),
  };
  /** @type {Record<ModeName,HTMLButtonElement>} */
  const modeButtons = {
    daily: /** @type {HTMLButtonElement} */ (requiredElement('[data-mode="daily"]')),
    blitz: /** @type {HTMLButtonElement} */ (requiredElement('[data-mode="blitz"]')),
    classic: /** @type {HTMLButtonElement} */ (requiredElement('[data-mode="classic"]')),
    survival: /** @type {HTMLButtonElement} */ (requiredElement('[data-mode="survival"]')),
  };
  const rootStyles = getComputedStyle(root);
  const durations = /** @type {Record<keyof typeof durationProperties,number>} */ (Object.fromEntries(Object.entries(durationProperties).map(([name, property]) => {
    const raw = rootStyles.getPropertyValue(property).trim();
    const milliseconds = raw.endsWith("ms") ? Number.parseFloat(raw) : raw.endsWith("s") ? Number.parseFloat(raw) * 1000 : Number.NaN;
    return [name, Number.isFinite(milliseconds) ? milliseconds : 0];
  })));
  const maxSnippetSeconds = Engine.SNIPPET_DURATIONS[Engine.SNIPPET_DURATIONS.length - 1];

  /** @param {number} milliseconds */
  const transitionDelay = (milliseconds) => reducedMotion.matches ? 0 : milliseconds;
  /** @param {number} seconds */
  const formatTime = (seconds) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds)) % 60).padStart(2, "0")}`;
  /** @param {number|null} value */
  const formatAccuracy = (value) => Number.isSafeInteger(value) ? `${value}%` : "--";
  /** @param {number} value */
  const formatAttempts = (value) => value ? `ATTEMPTS: ${value}` : "ATTEMPTS: --";
  const budapestFormatter = new Intl.DateTimeFormat("en", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" });
  /** @param {Date} [date] */
  const getBudapestDate = (date = new Date()) => {
    const parts = /** @type {Record<string,string>} */ (Object.fromEntries(budapestFormatter.formatToParts(date).map(({ type, value }) => [type, value])));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };

  let state = Engine.createInitialState({
    date: getBudapestDate(),
    seed: Math.floor(Math.random() * 0x100000000),
    modality: finePointer.matches ? "pointer-fine" : "pointer-coarse",
  });
  let view = Engine.selectView(state);
  let renderRevision = 0;
  let historySignature = "";
  let discoverySignature = "";
  let suggestionsSignature = "";
  let resultSignature = "";
  /** @type {string|null} */
  let rulesText = null;
  let renderedSessionId = state.session.id;
  /** @type {Map<string,number>} */
  const timers = new Map();

  /** @param {string} name */
  function clearTimer(name) {
    if (!timers.has(name)) return;
    clearTimeout(timers.get(name));
    timers.delete(name);
  }

  /** @param {string} name @param {()=>void} callback @param {number} delay */
  function setTimer(name, callback, delay) {
    clearTimer(name);
    const id = setTimeout(() => {
      if (timers.get(name) !== id) return;
      timers.delete(name);
      callback();
    }, Math.max(0, delay));
    timers.set(name, id);
    return id;
  }

  /** @param {string} text @param {number} scale */
  function setProgress(text, scale) {
    const clamped = Math.max(0, Math.min(1, Number(scale) || 0));
    ui.now.textContent = text;
    ui.fill.style.transform = `scaleX(${clamped})`;
    ui.feedback.style.transform = `scaleX(${clamped})`;
  }

  /** @param {ClockState} [sample] */
  function renderClock(sample = state.session.clock) {
    const modeName = state.session.mode;
    const mode = modeName ? Engine.MODE_DEFINITIONS[modeName] : null;
    if (!mode) {
      ui.endtime.textContent = "0:01";
      setProgress("0:00", 0);
      return;
    }
    if (!mode.timed) {
      const savedDaily = mode.daily && !state.session.current && state.daily.progress.date === state.daily.roundDate && state.daily.progress.started;
      const seconds = savedDaily ? Engine.SNIPPET_DURATIONS[state.session.step] : Math.max(0, sample.elapsedMs) / 1000;
      ui.endtime.textContent = `0:${String(Engine.SNIPPET_DURATIONS[state.session.step]).padStart(2, "0")}`;
      ui.snippet.style.width = `${Engine.SNIPPET_DURATIONS[state.session.step] / maxSnippetSeconds * 100}%`;
      setProgress(formatTime(seconds), seconds ? seconds / maxSnippetSeconds + 0.0025 : 0);
      return;
    }
    if (mode.survival) ui.endtime.textContent = formatTime(Math.ceil(sample.remainingMs / 1000));
    else ui.endtime.textContent = mode.endTime;
    const seconds = (mode.survival ? sample.elapsedMs : sample.remainingMs) / 1000;
    const denominator = mode.survival ? sample.maxRemainingMs : mode.initialTimeMs;
    setProgress(formatTime(seconds), denominator ? sample.remainingMs / denominator : 0);
  }

  /** @param {number} amount */
  function flashSurvivalChange(amount) {
    if (state.session.mode !== "survival" || !amount) return;
    const className = amount > 0 ? "survival-reward" : "survival-penalty";
    clearTimer("feedback");
    ui.timeChangeText.textContent = amount > 0 ? `+${amount}S` : `${amount}S`;
    ui.feedback.classList.remove("survival-penalty", "survival-reward");
    ui.timeChange.classList.remove("survival-change");
    void ui.feedback.offsetWidth;
    void ui.timeChange.offsetWidth;
    ui.feedback.classList.add(className);
    ui.timeChange.classList.add("survival-change");
    setTimer("feedback", () => {
      ui.feedback.classList.remove("survival-penalty", "survival-reward");
      ui.timeChange.classList.remove("survival-change");
      ui.timeChangeText.textContent = "";
    }, transitionDelay(durations.feedback));
  }

  function finishHistoryClear() {
    clearTimer("slots");
    ui.slots.replaceChildren();
    ui.slots.style.height = "";
  }

  /** @param {HistoryEntry[]} entries */
  function renderHistory(entries) {
    const signature = entries.map(({ id, text, tone }) => `${id}:${tone}:${text}`).join("\u001f");
    if (signature === historySignature && renderedSessionId === state.session.id) return;
    const sessionChanged = renderedSessionId !== state.session.id;
    renderedSessionId = state.session.id;
    historySignature = signature;

    if (!entries.length) {
      if (!ui.slots.children.length) return;
      if (reducedMotion.matches || !sessionChanged) {
        finishHistoryClear();
        return;
      }
      /** @type {HTMLElement[]} */ ([...ui.slots.children]).forEach((item) => item.classList.add("fade"));
      ui.slots.style.height = `${ui.slots.offsetHeight}px`;
      void ui.slots.offsetHeight;
      ui.slots.style.height = "0px";
      setTimer("slots", finishHistoryClear, durations.slot);
      return;
    }

    if (timers.has("slots")) finishHistoryClear();
    const existing = new Map(/** @type {HTMLElement[]} */ ([...ui.slots.children]).map((item) => [Number(item.dataset.historyId), item]));
    /** @type {HTMLElement[]} */
    const newItems = [];
    const nodes = entries.map((entry) => {
      let item = existing.get(entry.id);
      const isNew = !item;
      if (!item) {
        item = document.createElement("div");
        item.dataset.historyId = String(entry.id);
        newItems.push(item);
      }
      item.className = `slot ${isNew ? "fade " : ""}${entry.tone || ""}`.trim();
      item.textContent = entry.text;
      return item;
    });
    ui.slots.replaceChildren(...nodes);
    if (newItems.length) {
      void ui.slots.offsetWidth;
      newItems.forEach((item) => item.classList.remove("fade"));
    }
  }

  function renderSuggestions() {
    const signature = `${state.input.selectedSuggestion}|${view.suggestions.join("\u001f")}`;
    if (signature === suggestionsSignature) return;
    suggestionsSignature = signature;
    const nodes = view.suggestions.map((title, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.id = `corzaguessr-option-${index}`;
      button.textContent = title;
      button.setAttribute("role", "option");
      const active = index === state.input.selectedSuggestion;
      button.setAttribute("aria-selected", String(active));
      if (active) button.className = "active";
      return button;
    });
    ui.suggest.replaceChildren(...nodes);
    const open = Boolean(nodes.length);
    ui.suggest.style.display = open ? "block" : "none";
    ui.guess.setAttribute("aria-expanded", String(open));
    if (open && state.input.selectedSuggestion >= 0) ui.guess.setAttribute("aria-activedescendant", `corzaguessr-option-${state.input.selectedSuggestion}`);
    else ui.guess.removeAttribute("aria-activedescendant");
  }

  function renderDiscovery() {
    const signature = `${view.discovery.found}/${view.discovery.total}|${view.discovery.items.map((item) => `${item.dailyNumber}:${item.discovered}:${item.isNew}:${item.title}`).join("\u001f")}`;
    if (signature === discoverySignature) return;
    discoverySignature = signature;
    const percent = view.discovery.total ? Math.round(view.discovery.found * 100 / view.discovery.total) : 0;
    ui.discoveryCount.textContent = `${view.discovery.found} / ${view.discovery.total} (${percent}%)`;
    ui.discoveryItems.replaceChildren(...view.discovery.items.map((track) => {
      const item = document.createElement("div");
      item.className = "discovery-item";
      item.setAttribute("role", "listitem");
      if (track.isNew) {
        item.classList.add("discovery-item-new");
        const before = document.createElement("span");
        before.className = "discovery-new";
        before.textContent = "NEW";
        before.setAttribute("aria-hidden", "true");
        const title = document.createElement("span");
        title.className = "discovery-track";
        title.textContent = track.title;
        item.append(before, title, before.cloneNode(true));
        item.setAttribute("aria-label", "NEW UNDISCOVERED TRACK");
      } else {
        item.textContent = track.title;
        if (!track.discovered) item.setAttribute("aria-hidden", "true");
      }
      return item;
    }));
  }

  /** @param {string[]} lines @param {boolean} newPersonalBest */
  function createResultModule(lines, newPersonalBest) {
    const module = document.createElement("div");
    module.className = "result-module";
    module.replaceChildren(...lines.map((line, index) => {
      const item = document.createElement("span");
      item.className = index ? "result-value" : "result-label";
      if (!index && newPersonalBest && line === "NEW PERSONAL BEST:") item.classList.add("blink");
      item.textContent = line;
      return item;
    }));
    return module;
  }

  /** @param {number} seconds */
  function formatSnippetAverage(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "--";
    const rounded = Math.round(seconds * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}S`;
  }

  /** @returns {string[][]} */
  function resultModules() {
    const result = state.session.result;
    const mode = state.session.mode;
    if (!result || !mode) return [];
    const pb = state.personalBests;
    const accuracy = state.session.guesses ? Math.round(state.session.correct * 100 / state.session.guesses) : 0;
    /** @type {string[][]} */
    const modules = [];
    if (!Engine.MODE_DEFINITIONS[mode].timed) modules.push(["TRACK:", result.trackTitle]);
    if (mode === "daily") {
      modules.push(["RUN:", formatAttempts(state.session.step + 1)], [result.newPersonalBest ? "NEW PERSONAL BEST:" : "PERSONAL BEST:", formatAttempts(pb.daily)]);
    } else if (mode === "classic") {
      const run = result.classicRun || { won: result.won, streak: pb.classic.current, average: pb.classic.current ? pb.classic.snippetTotal / pb.classic.current : 0 };
      const bestAverage = pb.classic.best ? pb.classic.bestSnippetTotal / pb.classic.best : 0;
      modules.push(
        ["RUN:", `${run.won ? "STREAK" : "STREAK ENDED"}: ${run.streak} \u00b7 AVERAGE SNIPPET: ${formatSnippetAverage(run.average)}`],
        [result.newPersonalBest ? "NEW PERSONAL BEST:" : "PERSONAL BEST:", `STREAK: ${pb.classic.best} \u00b7 AVERAGE SNIPPET: ${formatSnippetAverage(bestAverage)}`],
      );
    } else if (mode === "blitz") {
      modules.push(
        ["RUN:", `CORRECT GUESSES: ${state.session.correct} \u00b7 ACCURACY: ${formatAccuracy(accuracy)}`],
        [result.newPersonalBest ? "NEW PERSONAL BEST:" : "PERSONAL BEST:", `CORRECT GUESSES: ${pb.blitz.score} \u00b7 ACCURACY: ${formatAccuracy(pb.blitz.accuracy)}`],
      );
    } else {
      modules.push(
        ["RUN:", `TIME SURVIVED: ${formatTime(state.session.clock.elapsedMs / 1000)} \u00b7 ACCURACY: ${formatAccuracy(accuracy)}`],
        [result.newPersonalBest ? "NEW PERSONAL BEST:" : "PERSONAL BEST:", `TIME SURVIVED: ${formatTime(pb.survival.score / 1000)} \u00b7 ACCURACY: ${formatAccuracy(pb.survival.accuracy)}`],
      );
    }
    return modules;
  }

  function renderResult() {
    const result = state.session.result;
    const signature = result ? JSON.stringify({ result, mode: state.session.mode, pb: state.personalBests, correct: state.session.correct, guesses: state.session.guesses, elapsed: state.session.clock.elapsedMs }) : "";
    if (signature === resultSignature) return;
    resultSignature = signature;
    const mode = state.session.mode;
    if (!result || !mode) {
      ui.resultTitle.textContent = "";
      ui.resultMeta.replaceChildren();
      return;
    }
    const timed = Engine.MODE_DEFINITIONS[mode].timed;
    ui.resultTitle.innerHTML = timed
      ? '&#9201;&#65039; <span class="end">TIME IS UP</span> &#9201;&#65039;'
      : `${result.won ? "&#127881;" : "&#10060;"} <span class="end">${result.won ? "YOU GOT IT" : "YOU GOT IT ALL WRONG"}</span> ${result.won ? "&#127881;" : "&#10060;"}`;
    const modules = resultModules();
    ui.resultMeta.replaceChildren(...modules.map((lines) => createResultModule(lines, result.newPersonalBest)));
    ui.resultMeta.dataset.announcement = modules.map((lines) => lines.join(". ")).join(". ");
    ui.spotify.hidden = timed || !result.spotify;
  }

  /** @param {ClockState} clock @param {number} [now] @returns {ClockState} */
  function projectClock(clock, now = performance.now()) {
    if (!clock.running || clock.anchorMs === null) return clock;
    const delta = Math.max(0, now - clock.anchorMs);
    const projected = { ...clock, elapsedMs: clock.elapsedMs + delta };
    if (clock.kind === "classic") projected.remainingMs = Math.max(0, clock.limitMs - projected.elapsedMs);
    else projected.remainingMs = Math.max(0, clock.remainingMs - delta);
    return projected;
  }

  function render() {
    view = Engine.selectView(state);
    renderRevision++;
    root.dataset.appStatus = view.appStatus;
    root.dataset.sessionStatus = view.sessionStatus;
    for (const status of ["loading", "awaiting-mode", "ready", "error"]) root.classList.toggle(`app-${status}`, view.appStatus === status);
    for (const status of ["idle", "preparing", "active", "paused", "audio-retry", "result"]) root.classList.toggle(`session-${status}`, view.sessionStatus === status);
    root.classList.toggle("awaiting-mode", view.awaitingMode);
    root.classList.toggle("rules-visible", !view.inputVisible);
    root.classList.toggle("timed", Boolean(view.mode && Engine.MODE_DEFINITIONS[view.mode].timed));
    root.classList.toggle("mode-error", view.appStatus === "error");

    const overlayOpen = view.overlay.phase !== "closed";
    const resultOpen = view.overlay.kind === "result" && overlayOpen;
    const discoveryOpen = view.overlay.kind === "discovery" && overlayOpen;
    root.classList.toggle("discovery-open", discoveryOpen);
    root.classList.toggle("discovery-visible", discoveryOpen && view.overlay.phase === "open");
    ui.card.classList.toggle("modal-open", resultOpen);
    ui.card.classList.toggle("modal-visible", resultOpen && view.overlay.phase === "open");
    ui.card.classList.toggle("modal-closing", resultOpen && view.overlay.phase === "closing");
    ui.result.setAttribute("aria-hidden", String(!resultOpen));
    ui.discoveryModal.setAttribute("aria-hidden", String(!discoveryOpen));
    ui.discoveryButton.setAttribute("aria-expanded", String(discoveryOpen && view.overlay.phase !== "closing"));
    ui.modePrompt.setAttribute("aria-hidden", String(!view.awaitingMode));

    ui.play.disabled = !view.playEnabled;
    ui.skip.disabled = !view.skipEnabled;
    ui.guess.disabled = !view.guessEnabled;
    for (const [name, button] of Object.entries(modeButtons)) {
      const selected = name === view.selectedMode;
      button.disabled = !view.modesEnabled || selected;
      button.setAttribute("aria-pressed", String(selected));
    }
    ui.icon.setAttribute("d", icons[view.playbackIcon]);
    ui.play.setAttribute("aria-label", view.playbackIcon === "play" ? "PLAY" : view.playbackIcon === "pause" ? "PAUSE" : "STOP");
    ui.skip.textContent = view.skipText;
    ui.snippet.style.width = `${view.snippetSeconds / maxSnippetSeconds * 100}%`;
    if (ui.guess.value !== state.input.query) ui.guess.value = state.input.query;

    if (rulesText !== view.rulesText) {
      rulesText = view.rulesText;
      ui.modePrompt.textContent = rulesText;
      ui.rulesetText.textContent = rulesText;
      ui.rulesetCopy.textContent = rulesText;
      ui.ruleset.classList.remove("scroll");
      if (!reducedMotion.matches && !view.inputVisible) {
        void ui.ruleset.offsetWidth;
        ui.ruleset.classList.add("scroll");
      }
    }
    if (view.inputVisible) ui.ruleset.classList.remove("scroll");

    ui.headerAction.inert = overlayOpen;
    ui.modes.inert = overlayOpen;
    ui.board.inert = overlayOpen || view.awaitingMode;
    ui.slots.inert = overlayOpen || view.awaitingMode;

    renderHistory(view.history);
    renderSuggestions();
    renderDiscovery();
    renderResult();
    renderClock(projectClock(state.session.clock));
  }

  /** @type {ShellAction[]} */
  const actionQueue = [];
  /** @type {Effect[]} */
  const effectQueue = [];
  let reducing = false;
  let effectDrainScheduled = false;

  /** @param {ShellAction} action */
  function dispatch(action) {
    actionQueue.push(action);
    if (reducing) return;
    reducing = true;
    let changed = false;
    /** @type {Effect[]} */
    const batchEffects = [];
    while (actionQueue.length) {
      const nextAction = actionQueue.shift();
      if (!nextAction) continue;
      const result = Engine.reduce(state, nextAction);
      if (result.state !== state) changed = true;
      state = result.state;
      if (result.effects?.length) batchEffects.push(...result.effects);
    }
    reducing = false;
    if (changed) render();
    if (batchEffects.length) scheduleEffects(batchEffects);
  }

  /** @param {Effect[]} effects */
  function scheduleEffects(effects) {
    effectQueue.push(...effects);
    if (effectDrainScheduled) return;
    effectDrainScheduled = true;
    queueMicrotask(() => {
      effectDrainScheduled = false;
      while (effectQueue.length) {
        const effect = effectQueue.shift();
        if (effect) runEffect(effect);
      }
    });
  }

  /** @param {ShellAction} action */
  const complete = (action) => queueMicrotask(() => dispatch(action));

  /** @param {Round} round */
  function audioSource(round) {
    const url = new URL(`${String(round.track.dailyNumber).padStart(2, "0")}.mp3`, audioFolderUrl);
    url.hash = `t=${round.track.at}`;
    return url.href;
  }

  const audioDeck = AdapterApi.createAudioDeck({
    elements: ui.audioPlayers,
    sourceForRound: audioSource,
    onEvent(event) {
      const round = event.round;
      if (!round) return;
      const identity = {
        sessionId: round.sessionId,
        roundId: round.id,
        audioGeneration: round.audioGeneration,
        atMs: performance.now(),
      };
      /** @type {Record<AudioDeckEvent["type"],string>} */
      const audioActionTypes = {
        prepared: "AUDIO/PREPARED",
        playing: "AUDIO/PLAYING",
        waiting: "AUDIO/WAITING",
        ended: "AUDIO/ENDED",
        blocked: "AUDIO/BLOCKED",
        failed: "AUDIO/FAILED",
      };
      const type = audioActionTypes[event.type];
      if (!type) return;
      complete({
        type,
        ...identity,
        role: event.role,
        error: event.error ? errorMessage(event.error) : undefined,
      });
    },
  });

  const clockPresenter = AdapterApi.createClockPresenter({
    getClock: () => state.session.clock,
    onSample: renderClock,
    onExpired: ({ sessionId, generation, atMs }) => complete({ type: "CLOCK/EXPIRED", sessionId, generation, atMs }),
  });

  const dateAdapter = AdapterApi.createBudapestDateAdapter({
    onDate: (date) => complete({ type: "ENV/DATE_CHANGED", date }),
  });

  /** @type {{htmlOverflow:string, htmlScrollbarGutter:string, bodyOverflow:string}|null} */
  let lockedScroll = null;

  function lockScroll() {
    if (lockedScroll) return;
    lockedScroll = {
      htmlOverflow: document.documentElement.style.overflow,
      htmlScrollbarGutter: document.documentElement.style.scrollbarGutter,
      bodyOverflow: document.body.style.overflow,
    };
    document.documentElement.style.scrollbarGutter = "stable";
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
  }

  function unlockScroll() {
    if (!lockedScroll) return;
    document.documentElement.style.overflow = lockedScroll.htmlOverflow;
    document.documentElement.style.scrollbarGutter = lockedScroll.htmlScrollbarGutter;
    document.body.style.overflow = lockedScroll.bodyOverflow;
    lockedScroll = null;
  }

  /** @param {HTMLButtonElement|HTMLInputElement|null|undefined} element */
  function canFocus(element) {
    return Boolean(element?.isConnected && !element.disabled && !element.hidden && !element.closest("[inert]"));
  }

  /** @param {FocusTarget} target */
  function focusTarget(target) {
    const preferred = target === "guess" ? ui.guess : target === "discovery" ? ui.discoveryButton : ui.play;
    const fallback = [preferred, ui.play, ui.discoveryButton, ...Object.values(modeButtons)].find(canFocus);
    fallback?.focus({ preventScroll: true });
  }

  /** @param {string} message */
  function announce(message) {
    if (!message) return;
    clearTimer("announcement");
    ui.status.textContent = "";
    setTimer("announcement", () => { ui.status.textContent = message; }, 0);
  }

  /** @param {OverlayEffect} effect */
  function overlayMatches(effect) {
    return state.overlay.kind === effect.kind && state.overlay.phase === effect.phase && state.overlay.generation === effect.generation;
  }

  /** @param {OverlayEffect} effect */
  function runOverlayEffect(effect) {
    clearTimer("overlay-open");
    clearTimer("result");
    clearTimer("discovery");
    if (effect.phase === "opening") {
      lockScroll();
      if (effect.kind === "result") {
        ui.next.focus({ preventScroll: true });
        announce(ui.resultMeta.dataset.announcement || "RESULT");
      } else {
        ui.discoveryShell.style.height = "0px";
        void ui.discoveryShell.offsetHeight;
      }
      setTimer("overlay-open", () => {
        if (!overlayMatches(effect)) return;
        if (effect.kind === "discovery") {
          ui.discoveryShell.style.height = `${ui.discoveryPanel.offsetHeight}px`;
          ui.discoveryModal.focus({ preventScroll: true });
        }
        dispatch({ type: "OVERLAY/TRANSITION_COMPLETED", kind: effect.kind, phase: "opening", generation: effect.generation });
      }, 0);
      return;
    }

    if (effect.kind === "discovery") {
      ui.discoveryShell.style.height = `${ui.discoveryShell.offsetHeight}px`;
      void ui.discoveryShell.offsetHeight;
      ui.discoveryShell.style.height = "0px";
    }
    setTimer(effect.kind, () => {
      if (!overlayMatches(effect)) return;
      dispatch({ type: "OVERLAY/TRANSITION_COMPLETED", kind: effect.kind, phase: "closing", generation: effect.generation });
      if (effect.kind === "discovery") ui.discoveryShell.style.height = "";
      unlockScroll();
      focusTarget(effect.returnFocus || (effect.kind === "result" ? "play" : "discovery"));
    }, transitionDelay(effect.kind === "result" ? durations.result : durations.discovery));
  }

  /** @param {string} key @returns {unknown|undefined} */
  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? undefined : JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  /** @param {unknown} error @returns {string} */
  function errorMessage(error) {
    if (error instanceof Error) return `${error.name || "Error"}: ${error.message || String(error)}`;
    return String(error);
  }

  /** @param {FocusEffect} effect */
  function focusEffectOwned(effect) {
    if (effect.sessionId !== state.session.id) return false;
    if (effect.roundId === null) return true;
    return state.session.current?.id === effect.roundId || state.session.pending?.id === effect.roundId;
  }

  /** @param {Effect} effect */
  function runEffect(effect) {
    switch (effect.type) {
      case "STORAGE_LOAD":
        complete({
          type: "PERSISTENCE/LOADED",
          discoveriesV2: readJson(effect.keys.discoveries),
          dailyV2: readJson(effect.keys.daily),
          personalBestsV2: readJson(effect.keys.personalBests),
        });
        break;
      case "STORAGE_WRITE":
        try {
          if (effect.key === Engine.STORAGE_KEYS.discoveries && Array.isArray(effect.value) && effect.value.length === 0) localStorage.removeItem(effect.key);
          else localStorage.setItem(effect.key, JSON.stringify(effect.value));
          complete({ type: "PERSISTENCE/WRITE_SUCCEEDED", requestId: effect.requestId });
        } catch (error) {
          complete({ type: "PERSISTENCE/WRITE_FAILED", requestId: effect.requestId, error: errorMessage(error) });
        }
        break;
      case "CATALOG_FETCH": {
        const url = new URL(tracksUrl);
        url.searchParams.set("date", effect.date);
        void fetch(url, { headers: { Accept: "application/json" } }).then(async (response) => {
          if (!response.ok) throw new Error(`Track catalog returned ${response.status}.`);
          complete({ type: "CATALOG/SUCCEEDED", requestId: effect.requestId, date: effect.date, tracks: await response.json() });
        }).catch((error) => {
          complete({ type: "CATALOG/FAILED", requestId: effect.requestId, date: effect.date, error: errorMessage(error) });
        });
        break;
      }
      case "CATALOG_RETRY_SCHEDULE":
        setTimer(`catalog-${effect.requestId}`, () => complete({ type: "CATALOG/RETRY_DUE", requestId: effect.requestId, date: effect.date }), effect.delayMs);
        break;
      case "AUDIO_RESET":
        audioDeck.reset();
        break;
      case "AUDIO_PREPARE":
        audioDeck.assign(effect.round, effect.role);
        break;
      case "AUDIO_PROMOTE_AND_PLAY":
        audioDeck.promoteAndPlay(effect.round);
        break;
      case "AUDIO_PLAY":
        if (!audioDeck.play(effect.round, effect.rewind)) {
          complete({ type: "AUDIO/FAILED", sessionId: effect.round.sessionId, roundId: effect.round.id, audioGeneration: effect.round.audioGeneration, role: "active", error: "Active audio is unavailable.", atMs: performance.now() });
        }
        break;
      case "AUDIO_PAUSE":
        audioDeck.pause(effect);
        break;
      case "AUDIO_RELEASE":
        audioDeck.release(effect);
        break;
      case "AUDIO_DISCARD_STANDBY":
        audioDeck.discardStandby(effect);
        break;
      case "AUDIO_SUSPEND":
        audioDeck.suspend(effect.round);
        break;
      case "AUDIO_RESTORE":
        audioDeck.restore(effect.round);
        break;
      case "CLOCK_SCHEDULE":
        clockPresenter.schedule(effect);
        break;
      case "CLOCK_CANCEL":
        clockPresenter.cancel(effect);
        break;
      case "ANNOUNCE":
        announce(effect.message);
        break;
      case "FEEDBACK_FLASH":
        if (effect.sessionId === state.session.id) flashSurvivalChange(effect.amountSeconds);
        break;
      case "FOCUS":
        if (effect.target === "guess" && effect.modality === "pointer-coarse") break;
        if (!focusEffectOwned(effect)) break;
        {
          const target = effect.target === "guess" ? ui.guess : ui.play;
          if (!canFocus(target)) break;
          setTimer(`${effect.target}-focus`, () => {
            if (!focusEffectOwned(effect) || !canFocus(target)) return;
            target.focus({ preventScroll: true });
          }, 0);
        }
        break;
      case "OVERLAY_SYNC":
        runOverlayEffect(effect);
        break;
    }
  }

  function playbackShortcut() {
    dispatch({ type: "PLAYER/PLAYBACK_SHORTCUT", atMs: performance.now() });
  }

  /** @param {OverlayKind} kind */
  function closeOverlay(kind) {
    dispatch({ type: "OVERLAY/CLOSE_REQUESTED", kind });
  }

  /** @param {KeyboardEvent} event @param {HTMLElement} container */
  function trapFocus(event, container) {
    if (event.key !== "Tab") return;
    const focusable = /** @type {HTMLElement[]} */ ([...container.querySelectorAll("button:not([disabled]), input:not([disabled])")])
      .filter((element) => !element.hidden && element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
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

  /** @param {HTMLElement} element @param {ShellAction} action */
  function bindPreview(element, action) {
    element.addEventListener("pointerenter", () => dispatch(action));
    element.addEventListener("pointerleave", () => dispatch({ type: "PREVIEW/CLEAR" }));
    element.addEventListener("focus", () => dispatch(action));
    element.addEventListener("blur", () => dispatch({ type: "PREVIEW/CLEAR" }));
  }

  ui.guess.addEventListener("input", () => dispatch({ type: "PLAYER/QUERY_CHANGED", query: ui.guess.value }));
  ui.guess.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      dispatch({ type: "PLAYER/QUERY_CHANGED", query: "" });
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!view.suggestions.length) return;
      event.preventDefault();
      dispatch({ type: "PLAYER/SUGGESTION_CHANGED", index: state.input.selectedSuggestion + (event.key === "ArrowDown" ? 1 : -1) });
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!state.session.current || !state.input.query.trim()) {
      playbackShortcut();
      return;
    }
    const suggestion = view.suggestions[state.input.selectedSuggestion];
    if (suggestion) dispatch({ type: "PLAYER/GUESS", title: suggestion, atMs: performance.now() });
  });

  ui.suggest.addEventListener("pointerover", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const option = target?.closest("[role=option]");
    if (!option) return;
    const index = [...ui.suggest.children].indexOf(option);
    if (index >= 0) dispatch({ type: "PLAYER/SUGGESTION_CHANGED", index });
  });
  ui.suggest.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const option = target?.closest("[role=option]");
    if (!option) return;
    const index = [...ui.suggest.children].indexOf(option);
    const title = view.suggestions[index];
    if (title) dispatch({ type: "PLAYER/GUESS", title, atMs: performance.now() });
  });

  ui.play.addEventListener("click", () => dispatch({ type: "PLAYER/PLAY", atMs: performance.now() }));
  ui.skip.addEventListener("click", () => dispatch({ type: "PLAYER/SKIP", atMs: performance.now() }));
  ui.next.addEventListener("click", () => closeOverlay("result"));
  ui.spotify.addEventListener("click", () => {
    const trackId = state.session.result?.spotify;
    if (trackId) window.open(`https://open.spotify.com/track/${trackId}`, "_blank", "noopener,noreferrer");
  });

  for (const [name, button] of Object.entries(modeButtons)) {
    bindPreview(button, { type: "PREVIEW/SET", kind: "mode", mode: name });
    button.addEventListener("click", () => dispatch({ type: "PLAYER/SELECT_MODE", mode: name }));
  }
  bindPreview(ui.discoveryButton, { type: "PREVIEW/SET", kind: "discovery" });
  ui.discoveryButton.addEventListener("click", () => {
    if (state.overlay.phase === "closed") dispatch({ type: "OVERLAY/OPEN_REQUESTED", kind: "discovery", returnFocus: "discovery", atMs: performance.now() });
    else if (state.overlay.kind === "discovery") closeOverlay("discovery");
  });
  ui.discoveryClose.addEventListener("click", () => closeOverlay("discovery"));
  ui.discoveryReset.addEventListener("click", () => {
    if (!window.confirm("RESET DISCOVERY? THIS HIDES ALL DISCOVERED TRACKS.")) return;
    dispatch({ type: "DISCOVERY/RESET" });
    announce("DISCOVERY RESET.");
  });
  ui.discoveryModal.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(".discovery-panel")) closeOverlay("discovery");
  });

  root.addEventListener("keydown", (event) => {
    dispatch({ type: "INPUT/MODALITY_CHANGED", modality: "keyboard" });
    if (state.overlay.kind === "discovery" && state.overlay.phase !== "closed") {
      if (event.key === "Escape") {
        event.preventDefault();
        closeOverlay("discovery");
      } else trapFocus(event, ui.discoveryPanel);
      return;
    }
    if (state.overlay.kind === "result" && state.overlay.phase !== "closed") {
      trapFocus(event, ui.result);
      if (event.key === "Escape") {
        event.preventDefault();
        closeOverlay("result");
      } else if (event.key === "Enter" && document.activeElement !== ui.spotify) {
        event.preventDefault();
        closeOverlay("result");
      }
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (event.key === "Enter" && !view.awaitingMode && !target?.closest(interactiveSelector)) {
      event.preventDefault();
      playbackShortcut();
    }
  }, true);

  root.addEventListener("pointerdown", (event) => {
    const modality = event.pointerType === "mouse" && finePointer.matches ? "pointer-fine" : "pointer-coarse";
    dispatch({ type: "INPUT/MODALITY_CHANGED", modality });
    const target = event.target instanceof Element ? event.target : null;
    if (view.playEnabled && !state.session.current && !target?.closest(interactiveSelector)) {
      event.preventDefault();
      focusTarget("play");
      return;
    }
    if (!view.guessEnabled || state.overlay.phase !== "closed" || target?.closest(interactiveSelector)) return;
    focusTarget("guess");
  });

  new ResizeObserver(() => {
    if (state.overlay.kind === "discovery" && state.overlay.phase !== "closed" && state.overlay.phase !== "closing") {
      ui.discoveryShell.style.height = `${ui.discoveryPanel.offsetHeight}px`;
    }
  }).observe(ui.discoveryPanel);

  document.addEventListener("visibilitychange", () => {
    dateAdapter.reconcile();
    if (document.hidden && state.session.playbackRequested && (state.session.current || state.session.pending)) {
      dispatch({ type: "ENV/VISIBILITY_HIDDEN", atMs: performance.now() });
    }
  });
  window.addEventListener("pageshow", () => dateAdapter.reconcile());

  render();
  const initialDate = dateAdapter.start();
  dispatch({ type: "APP/BOOTSTRAP", date: initialDate });

  if (runtimeGlobal.__CORZAGUESSR_TEST__) {
    runtimeGlobal.CorzaguessrEngine = Object.freeze({
      createInitialState: Engine.createInitialState,
      reduce: Engine.reduce,
      selectView: Engine.selectView,
      selectSuggestions: Engine.selectSuggestions,
      checkInvariants: Engine.checkInvariants,
      assertInvariants: Engine.assertInvariants,
    });
    try { delete runtimeGlobal.CorzaguessrAdapters; } catch { runtimeGlobal.CorzaguessrAdapters = undefined; }
  } else {
    try { delete runtimeGlobal.CorzaguessrEngine; } catch { runtimeGlobal.CorzaguessrEngine = undefined; }
    try { delete runtimeGlobal.CorzaguessrAdapters; } catch { runtimeGlobal.CorzaguessrAdapters = undefined; }
  }
})();
