(() => {
  "use strict";

  type ModeId = "daily" | "blitz" | "classic" | "survival";
  type DateKey = string;
  type TransportState = "starting" | "playing" | "buffering" | "paused";
  type AttemptKind = "correct" | "wrong" | "skip";
  type AttemptTone = "correct" | "wrong" | "skip";
  type AudioRole = "active" | "standby";
  type RetryKind = "new" | "same" | "replacement";
  type ClockKind = "classic" | "blitz" | "survival";

  interface Track {
    readonly id: number;
    readonly title: string;
    readonly searchText: string;
    readonly spotifyId: string | null;
    readonly durationSeconds: number;
    readonly availableFrom: DateKey;
    readonly markedNew: boolean;
  }

  interface Round {
    readonly id: number;
    readonly mode: ModeId;
    readonly date: DateKey | null;
    readonly track: Track;
    readonly startSeconds: number;
    readonly countOnCommit: boolean;
  }

  interface AttemptEntry {
    readonly id: number;
    readonly text: string;
    readonly tone: AttemptTone;
  }

  interface ClassicRecord {
    current: number;
    best: number;
    snippetTotal: number;
    bestSnippetTotal: number;
  }

  interface TimedRecord {
    score: number;
    accuracy: number | null;
  }

  interface PersonalRecords {
    classic: ClassicRecord;
    daily: number;
    blitz: TimedRecord;
    survival: TimedRecord;
  }

  interface DailyProgress {
    date: DateKey;
    trackId: number;
    started: boolean;
    completed: boolean;
    won: boolean;
    step: number;
  }

  interface PlayerProfile {
    discoveries: ReadonlySet<number>;
    records: PersonalRecords;
    daily: DailyProgress | null;
  }

  interface RunState {
    readonly step: number;
    readonly rounds: number;
    readonly guesses: number;
    readonly correct: number;
    readonly usedTrackIds: ReadonlySet<number>;
    readonly attempts: readonly AttemptEntry[];
    readonly nextAttemptId: number;
    readonly newPersonalBest: boolean;
    readonly classicResult: ClassicRunResult | null;
  }

  interface ClassicRunResult {
    readonly won: boolean;
    readonly streak: number;
    readonly averageSeconds: number;
  }

  interface ResultModule {
    readonly label: string;
    readonly value: string;
    readonly highlight: boolean;
  }

  interface GameResult {
    readonly heading: string;
    readonly success: boolean | null;
    readonly modules: readonly ResultModule[];
    readonly spotifyId: string | null;
    readonly announcement: string;
  }

  type SessionState =
    | { readonly phase: "idle" }
    | {
        readonly phase: "preparing";
        readonly requestId: number;
        readonly round: Round | null;
        readonly retry: RetryKind;
        readonly countOnCommit: boolean;
        readonly automaticRetriesRemaining: number;
      }
    | {
        readonly phase: "active";
        readonly round: Round;
        readonly transport: TransportState;
        readonly hasPlayed: boolean;
        readonly automaticRetriesRemaining: number;
      }
    | {
        readonly phase: "audio-error";
        readonly round: Round | null;
        readonly retry: "same" | "new";
        readonly countOnCommit: boolean;
        readonly message: string;
      }
    | {
        readonly phase: "result";
        readonly round: Round;
        readonly result: GameResult;
      };

  interface GameState {
    readonly appStatus: "loading" | "lobby" | "ready" | "error";
    readonly catalog: readonly Track[];
    readonly today: DateKey;
    readonly mode: ModeId | null;
    readonly session: SessionState;
    readonly run: RunState;
    readonly profile: PlayerProfile;
    readonly unavailableTrackIds: ReadonlySet<number>;
    readonly previousTrackId: number | null;
    readonly requestSerial: number;
    readonly catalogError: string | null;
  }

  interface ClockSnapshot {
    readonly kind: ClockKind;
    readonly running: boolean;
    readonly expired: boolean;
    readonly elapsedMs: number;
    readonly remainingMs: number;
    readonly limitMs: number;
    readonly maxRemainingMs: number;
  }

  interface ModeDefinition {
    readonly id: ModeId;
    readonly description: string;
    readonly clock: ClockKind;
    readonly daily: boolean;
    readonly initialMs: number;
    readonly survivalAdjustments: Readonly<Record<AttemptKind, number>> | null;
  }

  type GameEvent =
    | { readonly type: "CATALOG_READY"; readonly tracks: readonly Track[]; readonly profile: PlayerProfile; readonly today: DateKey }
    | { readonly type: "CATALOG_FAILED"; readonly message: string }
    | { readonly type: "MODE_SELECTED"; readonly mode: ModeId }
    | { readonly type: "PLAY_PRESSED" }
    | { readonly type: "ROUND_ASSIGNED"; readonly requestId: number; readonly round: Round }
    | { readonly type: "ROUND_UNAVAILABLE"; readonly requestId: number; readonly message: string }
    | { readonly type: "AUDIO_PLAYING"; readonly roundId: number }
    | { readonly type: "AUDIO_WAITING"; readonly roundId: number }
    | { readonly type: "AUDIO_PLAY_BLOCKED"; readonly roundId: number }
    | { readonly type: "AUDIO_ENDED"; readonly roundId: number }
    | { readonly type: "AUDIO_FAILED"; readonly round: Round; readonly role: AudioRole }
    | { readonly type: "ATTEMPT_REQUESTED"; readonly trackId: number | null }
    | {
        readonly type: "ATTEMPT_APPLY";
        readonly roundId: number;
        readonly trackId: number | null;
        readonly clock: ClockSnapshot;
        readonly wasPlaying: boolean;
      }
    | { readonly type: "CLOCK_EXPIRED"; readonly clock: ClockSnapshot }
    | { readonly type: "RESULT_DISMISSED" }
    | { readonly type: "DISCOVERY_RESET" }
    | { readonly type: "DATE_CHANGED"; readonly date: DateKey };

  type Command =
    | { readonly type: "RESET_SERVICES"; readonly mode: ModeId }
    | {
        readonly type: "REQUEST_ROUND";
        readonly requestId: number;
        readonly retry: RetryKind;
        readonly round: Round | null;
        readonly countOnCommit: boolean;
      }
    | { readonly type: "PREFETCH_ROUND" }
    | { readonly type: "PLAY_ACTIVE"; readonly rewind: boolean }
    | { readonly type: "PAUSE_MEDIA" }
    | { readonly type: "PAUSE_CLOCK" }
    | { readonly type: "RESUME_CLOCK" }
    | { readonly type: "RELEASE_ACTIVE_AUDIO" }
    | { readonly type: "RESET_CLASSIC_CLOCK"; readonly limitMs: number }
    | { readonly type: "SET_CLASSIC_LIMIT"; readonly limitMs: number }
    | { readonly type: "ADJUST_CLOCK"; readonly deltaMs: number }
    | { readonly type: "STOP_MEDIA" }
    | { readonly type: "CAPTURE_ATTEMPT"; readonly trackId: number | null }
    | { readonly type: "PERSIST_PROFILE" }
    | { readonly type: "ANNOUNCE"; readonly message: string }
    | { readonly type: "FOCUS_GUESS" }
    | { readonly type: "FOCUS_PLAY" }
    | { readonly type: "CLEAR_GUESS" }
    | { readonly type: "OPEN_RESULT" }
    | { readonly type: "FLASH_TIME_CHANGE"; readonly seconds: number };

  interface Transition {
    readonly state: GameState;
    readonly commands: readonly Command[];
  }

  const root = document.querySelector<HTMLElement>("#corzaguessr");
  if (!root || root.dataset.corzaguessrReady === "true") return;
  const appRoot: HTMLElement = root;
  appRoot.dataset.corzaguessrReady = "true";

  const scriptSource = document.currentScript?.getAttribute("src");
  const scriptUrl = scriptSource
    ? new URL(scriptSource, document.baseURI)
    : new URL(document.baseURI);
  const tracksUrl = new URL("tracks.json", scriptUrl);
  tracksUrl.search = scriptUrl.search;

  const AUDIO_BASE_URL = "https://cdn.jsdelivr.net/gh/HankeyThePoo/corzaguessr@main/tracks/";
  const PROFILE_STORAGE_KEY = "corzaguessrProfile";
  const DAILY_TIME_ZONE = "Europe/Budapest";
  const SNIPPET_DURATIONS = [1, 2, 4, 8, 16, 32] as const;
  const MAX_SNIPPET_SECONDS = 32;
  const MINIMUM_TIMED_REMAINING_SECONDS = 60;
  const MAX_TIMED_ATTEMPTS = 50;
  const HIDDEN_TITLE = "????????????????????";

  const MODES: Readonly<Record<ModeId, ModeDefinition>> = {
    daily: {
      id: "daily",
      description: "ONE SHARED TRACK EACH DAY. GUESS IT IN SIX TRIES.",
      clock: "classic",
      daily: true,
      initialMs: 0,
      survivalAdjustments: null,
    },
    blitz: {
      id: "blitz",
      description: "GUESS AS MANY TRACKS AS POSSIBLE BEFORE THE TIMER RUNS OUT.",
      clock: "blitz",
      daily: false,
      initialMs: 60_000,
      survivalAdjustments: null,
    },
    classic: {
      id: "classic",
      description: "GUESS THE TRACK IN SIX TRIES AS MORE AUDIO IS REVEALED.",
      clock: "classic",
      daily: false,
      initialMs: 0,
      survivalAdjustments: null,
    },
    survival: {
      id: "survival",
      description: "CORRECT GUESSES ADD TIME. MISTAKES AND SKIPS DRAIN IT.",
      clock: "survival",
      daily: false,
      initialMs: 30_000,
      survivalAdjustments: {
        correct: 3_000,
        wrong: -1_000,
        skip: -2_000,
      },
    },
  };

  const ICON_PATHS = {
    play: "M8 5v14l11-7z",
    pause: "M6 5h4v14H6zM14 5h4v14h-4z",
  } as const;

  const dateFormatter = new Intl.DateTimeFormat("en", {
    timeZone: DAILY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  function getDailyDate(date = new Date()): DateKey {
    const parts = dateFormatter.formatToParts(date);
    const values = new Map(parts.map((part) => [part.type, part.value]));
    return `${values.get("year") ?? "0000"}-${values.get("month") ?? "00"}-${values.get("day") ?? "00"}`;
  }

  function formatTime(milliseconds: number): string {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function formatAccuracy(value: number | null): string {
    return value === null ? "--" : `${value}%`;
  }

  function getAccuracy(run: RunState): number {
    return run.guesses ? Math.round((run.correct * 100) / run.guesses) : 0;
  }

  function formatSnippetAverage(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return "--";
    const rounded = Math.round(seconds * 10) / 10;
    return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)}S`;
  }

  function hashString(value: string): number {
    let hash = 2_166_136_261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
    return hash >>> 0;
  }

  function normalizeSearch(value: string): string {
    return value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function isDateKey(value: unknown): value is DateKey {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function emptyRecords(): PersonalRecords {
    return {
      classic: { current: 0, best: 0, snippetTotal: 0, bestSnippetTotal: 0 },
      daily: 0,
      blitz: { score: 0, accuracy: null },
      survival: { score: 0, accuracy: null },
    };
  }

  function emptyProfile(): PlayerProfile {
    return {
      discoveries: new Set<number>(),
      records: emptyRecords(),
      daily: null,
    };
  }

  function initialRun(step = 0): RunState {
    return {
      step,
      rounds: 0,
      guesses: 0,
      correct: 0,
      usedTrackIds: new Set<number>(),
      attempts: [],
      nextAttemptId: 0,
      newPersonalBest: false,
      classicResult: null,
    };
  }

  const initialState: GameState = {
    appStatus: "loading",
    catalog: [],
    today: getDailyDate(),
    mode: null,
    session: { phase: "idle" },
    run: initialRun(),
    profile: emptyProfile(),
    unavailableTrackIds: new Set<number>(),
    previousTrackId: null,
    requestSerial: 0,
    catalogError: null,
  };

  function cloneRecords(records: PersonalRecords): PersonalRecords {
    return {
      classic: { ...records.classic },
      daily: records.daily,
      blitz: { ...records.blitz },
      survival: { ...records.survival },
    };
  }

  function cloneProfile(profile: PlayerProfile): PlayerProfile {
    return {
      discoveries: new Set(profile.discoveries),
      records: cloneRecords(profile.records),
      daily: profile.daily ? { ...profile.daily } : null,
    };
  }

  function currentMode(state: GameState): ModeDefinition | null {
    return state.mode ? MODES[state.mode] : null;
  }

  function isDailyDone(state: GameState, date = state.today): boolean {
    return Boolean(state.profile.daily?.date === date && state.profile.daily.completed);
  }

  function isDailyInProgress(state: GameState, date = state.today): boolean {
    return Boolean(
      state.profile.daily?.date === date &&
      state.profile.daily.started &&
      !state.profile.daily.completed,
    );
  }

  function dailyStepForState(state: GameState, mode: ModeId): number {
    if (mode !== "daily" || !isDailyInProgress(state)) return 0;
    return state.profile.daily?.step ?? 0;
  }

  function canUseRoundControls(state: GameState): state is GameState & {
    session: Extract<SessionState, { phase: "active" }>;
  } {
    return state.session.phase === "active";
  }

  function addAttempt(run: RunState, text: string, tone: AttemptTone, timed: boolean): RunState {
    const entry: AttemptEntry = {
      id: run.nextAttemptId + 1,
      text,
      tone,
    };
    const attempts = [entry, ...run.attempts];
    if (timed && attempts.length > MAX_TIMED_ATTEMPTS) attempts.length = MAX_TIMED_ATTEMPTS;
    return {
      ...run,
      attempts,
      nextAttemptId: entry.id,
    };
  }

  function attemptText(state: GameState, kind: AttemptKind, title: string | null): string {
    const mode = currentMode(state);
    if (!mode) return "";
    if (kind !== "skip") return title ?? "UNKNOWN TRACK";
    if (mode.clock !== "classic") return "SKIPPED";
    if (state.run.step >= SNIPPET_DURATIONS.length - 1) return "FINAL GUESS SKIPPED";
    const current = SNIPPET_DURATIONS[state.run.step] ?? 1;
    const next = SNIPPET_DURATIONS[state.run.step + 1] ?? current;
    const added = next - current;
    return `GUESS ${state.run.step + 1} SKIPPED, ${added} SECOND${added === 1 ? "" : "S"} ADDED`;
  }

  function calculateClassicAverage(record: ClassicRecord): number {
    return record.current ? record.snippetTotal / record.current : 0;
  }

  function calculateClassicBestAverage(record: ClassicRecord): number {
    return record.best ? record.bestSnippetTotal / record.best : 0;
  }

  function isClassicPersonalBest(record: ClassicRecord): boolean {
    return record.current > record.best || (
      record.current === record.best &&
      record.current > 0 &&
      (!record.bestSnippetTotal || record.snippetTotal < record.bestSnippetTotal)
    );
  }

  function finishGame(
    state: GameState,
    round: Round,
    won: boolean | null,
    clock: ClockSnapshot,
  ): Transition {
    const mode = MODES[round.mode];
    const profile = cloneProfile(state.profile);
    let run: RunState = { ...state.run, newPersonalBest: false };

    if (round.mode === "daily") {
      const resolvedWon = won === true;
      profile.daily = {
        date: round.date ?? state.today,
        trackId: round.track.id,
        started: true,
        completed: true,
        won: resolvedWon,
        step: run.step,
      };
      if (resolvedWon) {
        const attempts = run.step + 1;
        if (!profile.records.daily || attempts < profile.records.daily) {
          profile.records.daily = attempts;
          run = { ...run, newPersonalBest: true };
        }
      }
    } else if (round.mode === "classic") {
      const record = profile.records.classic;
      if (won === true) {
        record.current += 1;
        record.snippetTotal += SNIPPET_DURATIONS[run.step] ?? SNIPPET_DURATIONS[0];
        const classicResult: ClassicRunResult = {
          won: true,
          streak: record.current,
          averageSeconds: calculateClassicAverage(record),
        };
        if (isClassicPersonalBest(record)) {
          record.best = record.current;
          record.bestSnippetTotal = record.snippetTotal;
          run = { ...run, newPersonalBest: true, classicResult };
        } else {
          run = { ...run, classicResult };
        }
      } else {
        const classicResult: ClassicRunResult = {
          won: false,
          streak: record.current,
          averageSeconds: calculateClassicAverage(record),
        };
        if (record.current || record.snippetTotal) {
          record.current = 0;
          record.snippetTotal = 0;
        }
        run = { ...run, classicResult };
      }
    } else {
      const accuracy = getAccuracy(run);
      const score = round.mode === "survival" ? Math.floor(clock.elapsedMs) : run.correct;
      const record = profile.records[round.mode];
      if (score > record.score) {
        profile.records[round.mode] = { score, accuracy };
        run = { ...run, newPersonalBest: true };
      }
    }

    const personalBestLabel = run.newPersonalBest ? "NEW PERSONAL BEST" : "PERSONAL BEST";
    const modules: ResultModule[] = [];
    if (mode.clock === "classic") {
      modules.push({ label: "TRACK", value: round.track.title, highlight: false });
    }

    if (round.mode === "daily") {
      modules.push(
        { label: "RUN", value: `ATTEMPTS: ${run.step + 1}`, highlight: false },
        {
          label: personalBestLabel,
          value: profile.records.daily ? `ATTEMPTS: ${profile.records.daily}` : "ATTEMPTS: --",
          highlight: run.newPersonalBest,
        },
      );
    } else if (round.mode === "classic") {
      const classicResult = run.classicResult ?? {
        won: false,
        streak: 0,
        averageSeconds: 0,
      };
      const streakLabel = classicResult.won ? "STREAK" : "STREAK ENDED";
      modules.push(
        {
          label: "RUN",
          value: `${streakLabel}: ${classicResult.streak} · AVERAGE SNIPPET: ${formatSnippetAverage(classicResult.averageSeconds)}`,
          highlight: false,
        },
        {
          label: personalBestLabel,
          value: `STREAK: ${profile.records.classic.best} · AVERAGE SNIPPET: ${formatSnippetAverage(calculateClassicBestAverage(profile.records.classic))}`,
          highlight: run.newPersonalBest,
        },
      );
    } else if (round.mode === "blitz") {
      modules.push(
        {
          label: "RUN",
          value: `CORRECT GUESSES: ${run.correct} · ACCURACY: ${formatAccuracy(getAccuracy(run))}`,
          highlight: false,
        },
        {
          label: personalBestLabel,
          value: `CORRECT GUESSES: ${profile.records.blitz.score} · ACCURACY: ${formatAccuracy(profile.records.blitz.accuracy)}`,
          highlight: run.newPersonalBest,
        },
      );
    } else {
      modules.push(
        {
          label: "RUN",
          value: `TIME SURVIVED: ${formatTime(clock.elapsedMs)} · ACCURACY: ${formatAccuracy(getAccuracy(run))}`,
          highlight: false,
        },
        {
          label: personalBestLabel,
          value: `TIME SURVIVED: ${formatTime(profile.records.survival.score)} · ACCURACY: ${formatAccuracy(profile.records.survival.accuracy)}`,
          highlight: run.newPersonalBest,
        },
      );
    }

    const heading = mode.clock !== "classic"
      ? "TIME IS UP"
      : won === true
        ? "YOU GOT IT"
        : "YOU GOT IT ALL WRONG";
    const announcement = modules.map((module) => `${module.label}. ${module.value}`).join(". ");
    const result: GameResult = {
      heading,
      success: mode.clock === "classic" ? won === true : null,
      modules,
      spotifyId: mode.clock === "classic" ? round.track.spotifyId : null,
      announcement,
    };

    return {
      state: {
        ...state,
        profile,
        run,
        session: { phase: "result", round, result },
      },
      commands: [
        { type: "STOP_MEDIA" },
        { type: "PERSIST_PROFILE" },
        { type: "OPEN_RESULT" },
        { type: "ANNOUNCE", message: announcement },
      ],
    };
  }

  function requestRoundTransition(
    state: GameState,
    retry: RetryKind,
    round: Round | null,
    countOnCommit: boolean,
    automaticRetriesRemaining: number,
  ): Transition {
    const requestId = state.requestSerial + 1;
    return {
      state: {
        ...state,
        requestSerial: requestId,
        session: {
          phase: "preparing",
          requestId,
          round: null,
          retry,
          countOnCommit,
          automaticRetriesRemaining,
        },
      },
      commands: [{ type: "REQUEST_ROUND", requestId, retry, round, countOnCommit }],
    };
  }

  function update(state: GameState, event: GameEvent): Transition {
    switch (event.type) {
      case "CATALOG_READY": {
        return {
          state: {
            ...state,
            appStatus: "lobby",
            catalog: event.tracks,
            profile: event.profile,
            today: event.today,
            catalogError: null,
          },
          commands: [],
        };
      }

      case "CATALOG_FAILED": {
        return {
          state: {
            ...state,
            appStatus: "error",
            catalogError: event.message,
          },
          commands: [{ type: "ANNOUNCE", message: "COULD NOT LOAD THE TRACKLIST. RETRY AVAILABLE." }],
        };
      }

      case "MODE_SELECTED": {
        if (state.appStatus === "loading" || state.appStatus === "error") return { state, commands: [] };
        const step = dailyStepForState(state, event.mode);
        const nextState: GameState = {
          ...state,
          appStatus: "ready",
          mode: event.mode,
          session: { phase: "idle" },
          run: initialRun(step),
          unavailableTrackIds: new Set<number>(),
          previousTrackId: null,
        };
        return {
          state: nextState,
          commands: [
            { type: "RESET_SERVICES", mode: event.mode },
            { type: "ANNOUNCE", message: MODES[event.mode].description },
            { type: "PREFETCH_ROUND" },
            { type: "FOCUS_PLAY" },
          ],
        };
      }

      case "PLAY_PRESSED": {
        const mode = currentMode(state);
        if (!mode || state.appStatus !== "ready" || state.session.phase === "result") {
          return { state, commands: [] };
        }
        if (state.session.phase === "idle") {
          if (mode.daily && isDailyDone(state)) {
            return {
              state,
              commands: [{ type: "ANNOUNCE", message: "TODAY'S DAILY IS ALREADY COMPLETE." }],
            };
          }
          return requestRoundTransition(state, "new", null, true, 1);
        }
        if (state.session.phase === "audio-error") {
          return requestRoundTransition(
            state,
            state.session.retry,
            state.session.retry === "same" ? state.session.round : null,
            state.session.countOnCommit,
            0,
          );
        }
        if (state.session.phase === "preparing") return { state, commands: [] };
        const active = state.session;
        if (active.transport === "playing" || active.transport === "starting" || active.transport === "buffering") {
          const commands: Command[] = [{ type: "PAUSE_MEDIA" }];
          if (mode.clock === "classic") {
            commands.push({
              type: "RESET_CLASSIC_CLOCK",
              limitMs: (SNIPPET_DURATIONS[state.run.step] ?? SNIPPET_DURATIONS[0]) * 1000,
            });
          }
          return {
            state: {
              ...state,
              session: { ...active, transport: "paused" },
            },
            commands,
          };
        }
        const commands: Command[] = [];
        if (mode.clock === "classic") {
          commands.push({
            type: "RESET_CLASSIC_CLOCK",
            limitMs: (SNIPPET_DURATIONS[state.run.step] ?? SNIPPET_DURATIONS[0]) * 1000,
          });
        }
        commands.push({ type: "PLAY_ACTIVE", rewind: mode.clock === "classic" });
        return {
          state: {
            ...state,
            session: { ...active, transport: "starting", hasPlayed: false },
          },
          commands,
        };
      }

      case "ROUND_ASSIGNED": {
        if (state.session.phase !== "preparing" || state.session.requestId !== event.requestId) {
          return { state, commands: [] };
        }
        return {
          state: {
            ...state,
            session: { ...state.session, round: event.round },
          },
          commands: [],
        };
      }

      case "ROUND_UNAVAILABLE": {
        if (state.session.phase !== "preparing" || state.session.requestId !== event.requestId) {
          return { state, commands: [] };
        }
        return {
          state: {
            ...state,
            session: {
              phase: "audio-error",
              round: state.session.round,
              retry: state.session.retry === "same" ? "same" : "new",
              countOnCommit: state.session.countOnCommit,
              message: event.message,
            },
          },
          commands: [
            { type: "ANNOUNCE", message: event.message },
            { type: "FOCUS_PLAY" },
          ],
        };
      }

      case "AUDIO_PLAYING": {
        if (state.session.phase === "preparing" && state.session.round?.id === event.roundId) {
          const round = state.session.round;
          const mode = MODES[round.mode];
          const profile = cloneProfile(state.profile);
          let shouldPersist = false;
          if (mode.daily && round.date) {
            const currentDaily = profile.daily;
            if (!currentDaily || currentDaily.date !== round.date || !currentDaily.started) {
              profile.daily = {
                date: round.date,
                trackId: round.track.id,
                started: true,
                completed: false,
                won: false,
                step: state.run.step,
              };
              shouldPersist = true;
            }
          }
          const commands: Command[] = [];
          if (mode.clock === "classic") {
            commands.push({
              type: "RESET_CLASSIC_CLOCK",
              limitMs: (SNIPPET_DURATIONS[state.run.step] ?? SNIPPET_DURATIONS[0]) * 1000,
            });
          }
          commands.push({ type: "RESUME_CLOCK" }, { type: "PREFETCH_ROUND" }, { type: "FOCUS_GUESS" });
          if (shouldPersist) commands.push({ type: "PERSIST_PROFILE" });
          return {
            state: {
              ...state,
              profile,
              previousTrackId: round.track.id,
              run: {
                ...state.run,
                rounds: state.run.rounds + (round.countOnCommit ? 1 : 0),
                usedTrackIds: new Set<number>(),
              },
              session: {
                phase: "active",
                round,
                transport: "playing",
                hasPlayed: true,
                automaticRetriesRemaining: 1,
              },
            },
            commands,
          };
        }
        if (state.session.phase === "active" && state.session.round.id === event.roundId) {
          return {
            state: {
              ...state,
              session: { ...state.session, transport: "playing", hasPlayed: true },
            },
            commands: [{ type: "RESUME_CLOCK" }],
          };
        }
        return { state, commands: [] };
      }

      case "AUDIO_WAITING": {
        if (state.session.phase !== "active" || state.session.round.id !== event.roundId) {
          return { state, commands: [] };
        }
        return {
          state: {
            ...state,
            session: { ...state.session, transport: "buffering" },
          },
          commands: [{ type: "PAUSE_CLOCK" }],
        };
      }

      case "AUDIO_PLAY_BLOCKED": {
        if (state.session.phase === "preparing" && state.session.round?.id === event.roundId) {
          return {
            state: {
              ...state,
              session: {
                phase: "audio-error",
                round: state.session.round,
                retry: "same",
                countOnCommit: state.session.countOnCommit,
                message: "PRESS PLAY TO START THE AUDIO.",
              },
            },
            commands: [
              { type: "PAUSE_CLOCK" },
              { type: "ANNOUNCE", message: "PRESS PLAY TO START THE AUDIO." },
              { type: "FOCUS_PLAY" },
            ],
          };
        }
        if (state.session.phase === "active" && state.session.round.id === event.roundId) {
          return {
            state: {
              ...state,
              session: { ...state.session, transport: "paused" },
            },
            commands: [
              { type: "PAUSE_CLOCK" },
              { type: "ANNOUNCE", message: "PRESS PLAY TO START THE AUDIO." },
            ],
          };
        }
        return { state, commands: [] };
      }

      case "AUDIO_FAILED": {
        const unavailable = new Set(state.unavailableTrackIds);
        if (event.round.mode !== "daily") unavailable.add(event.round.track.id);

        if (event.role === "standby") {
          if (event.round.mode === "daily" && state.session.phase === "idle" && state.mode === "daily") {
            return {
              state: {
                ...state,
                unavailableTrackIds: unavailable,
                session: {
                  phase: "audio-error",
                  round: event.round,
                  retry: "same",
                  countOnCommit: true,
                  message: "COULD NOT LOAD TODAY'S TRACK. PRESS PLAY TO RETRY.",
                },
              },
              commands: [{ type: "ANNOUNCE", message: "COULD NOT LOAD TODAY'S TRACK. PRESS PLAY TO RETRY." }],
            };
          }
          return {
            state: { ...state, unavailableTrackIds: unavailable },
            commands: state.session.phase === "active" ? [{ type: "PREFETCH_ROUND" }] : [],
          };
        }

        const preparing = state.session.phase === "preparing" && state.session.round?.id === event.round.id
          ? state.session
          : null;
        const active = state.session.phase === "active" && state.session.round.id === event.round.id
          ? state.session
          : null;
        if (!preparing && !active) return { state, commands: [] };

        const mode = MODES[event.round.mode];
        const countOnCommit = active ? false : preparing?.countOnCommit ?? event.round.countOnCommit;
        const automaticRetriesRemaining = active
          ? active.automaticRetriesRemaining
          : preparing?.automaticRetriesRemaining ?? 0;
        const baseCommands: Command[] = [
          { type: "PAUSE_CLOCK" },
          { type: "RELEASE_ACTIVE_AUDIO" },
        ];

        if (mode.daily || mode.clock === "classic") {
          const message = mode.daily
            ? "COULD NOT LOAD TODAY'S TRACK. PRESS PLAY TO RETRY."
            : "COULD NOT PLAY THIS TRACK. PRESS PLAY TO RETRY.";
          return {
            state: {
              ...state,
              unavailableTrackIds: unavailable,
              session: {
                phase: "audio-error",
                round: event.round,
                retry: "same",
                countOnCommit,
                message,
              },
            },
            commands: [...baseCommands, { type: "ANNOUNCE", message }, { type: "FOCUS_PLAY" }],
          };
        }

        if (automaticRetriesRemaining > 0) {
          const requestId = state.requestSerial + 1;
          return {
            state: {
              ...state,
              requestSerial: requestId,
              unavailableTrackIds: unavailable,
              session: {
                phase: "preparing",
                requestId,
                round: null,
                retry: "replacement",
                countOnCommit,
                automaticRetriesRemaining: automaticRetriesRemaining - 1,
              },
            },
            commands: [
              ...baseCommands,
              { type: "ANNOUNCE", message: "THE TRACK FAILED TO LOAD. TRYING ANOTHER." },
              { type: "REQUEST_ROUND", requestId, retry: "replacement", round: null, countOnCommit },
            ],
          };
        }

        return {
          state: {
            ...state,
            unavailableTrackIds: unavailable,
            session: {
              phase: "audio-error",
              round: null,
              retry: "new",
              countOnCommit,
              message: "COULD NOT PLAY A TRACK. PRESS PLAY TO RETRY.",
            },
          },
          commands: [
            ...baseCommands,
            { type: "ANNOUNCE", message: "COULD NOT PLAY A TRACK. PRESS PLAY TO RETRY." },
            { type: "FOCUS_PLAY" },
          ],
        };
      }

      case "AUDIO_ENDED": {
        if (state.session.phase !== "active" || state.session.round.id !== event.roundId || !state.session.hasPlayed) {
          return { state, commands: [] };
        }
        const mode = MODES[state.session.round.mode];
        if (mode.clock !== "classic") {
          return {
            state,
            commands: [{ type: "CAPTURE_ATTEMPT", trackId: null }],
          };
        }
        return {
          state: {
            ...state,
            session: { ...state.session, transport: "paused", hasPlayed: false },
          },
          commands: [{ type: "PAUSE_MEDIA" }],
        };
      }

      case "ATTEMPT_REQUESTED": {
        if (!canUseRoundControls(state)) return { state, commands: [] };
        const mode = MODES[state.session.round.mode];
        if (mode.clock !== "classic" && !state.session.hasPlayed) return { state, commands: [] };
        if (event.trackId !== null && state.run.usedTrackIds.has(event.trackId)) return { state, commands: [] };
        return {
          state,
          commands: [{ type: "CAPTURE_ATTEMPT", trackId: event.trackId }],
        };
      }

      case "ATTEMPT_APPLY": {
        if (state.session.phase !== "active" || state.session.round.id !== event.roundId) {
          return { state, commands: [] };
        }
        const round = state.session.round;
        const mode = MODES[round.mode];
        const guessedTrack = event.trackId === null
          ? null
          : state.catalog.find((track) => track.id === event.trackId) ?? null;
        const kind: AttemptKind = event.trackId === null
          ? "skip"
          : event.trackId === round.track.id
            ? "correct"
            : "wrong";
        let run = state.run;
        if (event.trackId !== null) {
          const usedTrackIds = new Set(run.usedTrackIds);
          usedTrackIds.add(event.trackId);
          run = { ...run, usedTrackIds };
        }
        run = addAttempt(run, attemptText(state, kind, guessedTrack?.title ?? null), kind === "correct" ? "correct" : kind === "wrong" ? "wrong" : "skip", mode.clock !== "classic");

        let profile = state.profile;
        let shouldPersist = false;
        if (kind === "correct" && !profile.discoveries.has(round.track.id)) {
          profile = cloneProfile(profile);
          const discoveries = new Set(profile.discoveries);
          discoveries.add(round.track.id);
          profile = { ...profile, discoveries };
          shouldPersist = true;
        }

        const feedback = kind === "correct" ? "CORRECT." : kind === "wrong" ? "INCORRECT." : "SKIPPED.";
        const commonCommands: Command[] = [
          { type: "CLEAR_GUESS" },
          { type: "ANNOUNCE", message: feedback },
        ];
        if (shouldPersist) commonCommands.push({ type: "PERSIST_PROFILE" });

        if (mode.clock === "classic") {
          const stateWithAttempt: GameState = { ...state, profile, run };
          if (kind === "correct") {
            return finishGame(stateWithAttempt, round, true, event.clock);
          }
          if (run.step >= SNIPPET_DURATIONS.length - 1) {
            return finishGame(stateWithAttempt, round, false, event.clock);
          }

          const nextStep = run.step + 1;
          run = { ...run, step: nextStep };
          if (mode.daily && round.date) {
            if (profile === state.profile) profile = cloneProfile(profile);
            profile.daily = {
              date: round.date,
              trackId: round.track.id,
              started: true,
              completed: false,
              won: false,
              step: nextStep,
            };
            shouldPersist = true;
          }
          const limitMs = (SNIPPET_DURATIONS[nextStep] ?? MAX_SNIPPET_SECONDS) * 1000;
          const commands = [...commonCommands];
          if (shouldPersist && !commands.some((command) => command.type === "PERSIST_PROFILE")) {
            commands.push({ type: "PERSIST_PROFILE" });
          }
          if (event.wasPlaying) {
            commands.push({ type: "SET_CLASSIC_LIMIT", limitMs });
          } else {
            commands.push(
              { type: "RESET_CLASSIC_CLOCK", limitMs },
              { type: "PLAY_ACTIVE", rewind: true },
            );
          }
          return {
            state: {
              ...state,
              profile,
              run,
              session: {
                ...state.session,
                transport: event.wasPlaying ? "playing" : "starting",
                hasPlayed: event.wasPlaying,
              },
            },
            commands,
          };
        }

        if (kind !== "skip") run = { ...run, guesses: run.guesses + 1 };
        if (kind === "correct") run = { ...run, correct: run.correct + 1 };

        let adjustedClock = event.clock;
        const commands = [...commonCommands];
        if (mode.clock === "survival" && mode.survivalAdjustments) {
          const deltaMs = mode.survivalAdjustments[kind];
          const remainingMs = Math.max(0, event.clock.remainingMs + deltaMs);
          adjustedClock = {
            ...event.clock,
            remainingMs,
            maxRemainingMs: Math.max(event.clock.maxRemainingMs, remainingMs),
            expired: remainingMs <= 0,
          };
          commands.push(
            { type: "ADJUST_CLOCK", deltaMs },
            { type: "FLASH_TIME_CHANGE", seconds: deltaMs / 1000 },
          );
        }

        const stateWithAttempt: GameState = { ...state, profile, run };
        if (adjustedClock.expired || adjustedClock.remainingMs <= 0) {
          return finishGame(stateWithAttempt, round, null, adjustedClock);
        }

        const requestId = state.requestSerial + 1;
        commands.push(
          { type: "RELEASE_ACTIVE_AUDIO" },
          { type: "REQUEST_ROUND", requestId, retry: "new", round: null, countOnCommit: true },
        );
        return {
          state: {
            ...state,
            profile,
            run,
            requestSerial: requestId,
            session: {
              phase: "preparing",
              requestId,
              round: null,
              retry: "new",
              countOnCommit: true,
              automaticRetriesRemaining: 1,
            },
          },
          commands,
        };
      }

      case "CLOCK_EXPIRED": {
        if (state.session.phase !== "active") return { state, commands: [] };
        const mode = MODES[state.session.round.mode];
        if (mode.clock === "classic") {
          return {
            state: {
              ...state,
              session: { ...state.session, transport: "paused" },
            },
            commands: [{ type: "PAUSE_MEDIA" }],
          };
        }
        return finishGame(state, state.session.round, null, event.clock);
      }

      case "RESULT_DISMISSED": {
        if (state.session.phase !== "result" || !state.mode) return { state, commands: [] };
        const step = dailyStepForState(state, state.mode);
        return {
          state: {
            ...state,
            session: { phase: "idle" },
            run: initialRun(step),
            unavailableTrackIds: new Set<number>(),
            previousTrackId: null,
          },
          commands: [
            { type: "RESET_SERVICES", mode: state.mode },
            { type: "PREFETCH_ROUND" },
            { type: "FOCUS_PLAY" },
          ],
        };
      }

      case "DISCOVERY_RESET": {
        const profile = cloneProfile(state.profile);
        profile.discoveries = new Set<number>();
        return {
          state: { ...state, profile },
          commands: [
            { type: "PERSIST_PROFILE" },
            { type: "ANNOUNCE", message: "DISCOVERY RESET." },
          ],
        };
      }

      case "DATE_CHANGED": {
        if (event.date === state.today) return { state, commands: [] };
        const nextState: GameState = { ...state, today: event.date };
        if (state.mode !== "daily" || state.session.phase !== "idle") {
          return { state: nextState, commands: [] };
        }
        return {
          state: {
            ...nextState,
            run: initialRun(dailyStepForState(nextState, "daily")),
            unavailableTrackIds: new Set<number>(),
            previousTrackId: null,
          },
          commands: [
            { type: "RESET_SERVICES", mode: "daily" },
            { type: "PREFETCH_ROUND" },
            { type: "ANNOUNCE", message: "A NEW DAILY TRACK IS AVAILABLE." },
          ],
        };
      }
    }
  }

  appRoot.innerHTML = `
    <div class="app-shell">
      <header class="brand-bar">
        <div class="brand-lockup">
          <p class="eyebrow">AUDIO GUESSING GAME</p>
          <h1>CORZAGUESSR<span aria-hidden="true">✦</span></h1>
        </div>
        <button type="button" class="secondary-button discovery-button" aria-haspopup="dialog">
          DISCOVERY
        </button>
      </header>

      <section class="mode-grid" aria-label="GAME MODE">
        <button type="button" class="mode-card" data-mode="daily" aria-pressed="false">
          <span class="mode-card__top"><strong>DAILY</strong><span class="mode-record" data-record="daily">PB --</span></span>
          <span>ONE SHARED TRACK. SIX ATTEMPTS.</span>
        </button>
        <button type="button" class="mode-card" data-mode="blitz" aria-pressed="false">
          <span class="mode-card__top"><strong>BLITZ</strong><span class="mode-record" data-record="blitz">PB 0</span></span>
          <span>SCORE AS MANY AS POSSIBLE IN 60 SECONDS.</span>
        </button>
        <button type="button" class="mode-card" data-mode="classic" aria-pressed="false">
          <span class="mode-card__top"><strong>CLASSIC</strong><span class="mode-record" data-record="classic">PB 0</span></span>
          <span>BUILD A STREAK WITH PROGRESSIVE CLIPS.</span>
        </button>
        <button type="button" class="mode-card" data-mode="survival" aria-pressed="false">
          <span class="mode-card__top"><strong>SURVIVAL</strong><span class="mode-record" data-record="survival">PB 0:00</span></span>
          <span>GAIN TIME FOR CORRECT ANSWERS. LOSE IT FOR MISSES.</span>
        </button>
      </section>

      <main class="game-card" aria-busy="true">
        <div class="game-head">
          <div>
            <p class="game-mode-label">SELECT A MODE</p>
            <p class="game-stat">READY WHEN YOU ARE</p>
          </div>
          <button type="button" class="catalog-retry secondary-button" hidden>RETRY TRACKLIST</button>
        </div>

        <p class="instruction" aria-live="off">LOADING TRACKLIST...</p>

        <section class="transport" aria-label="AUDIO PLAYER">
          <div class="time-block">
            <span class="time-label">CURRENT</span>
            <strong class="time-current">0:00</strong>
          </div>
          <button type="button" class="play-button" aria-label="PLAY" disabled>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON_PATHS.play}"></path></svg>
          </button>
          <div class="time-block time-block--end">
            <span class="time-label">LIMIT</span>
            <strong class="time-end">0:01</strong>
          </div>
        </section>

        <div class="timeline" aria-hidden="true">
          <div class="timeline__snippet"></div>
          <div class="timeline__fill"></div>
          <div class="timeline__ticks">
            <i style="left:3.125%"></i><i style="left:6.25%"></i><i style="left:12.5%"></i><i style="left:25%"></i><i style="left:50%"></i>
          </div>
          <div class="time-change" aria-hidden="true"></div>
        </div>

        <div class="guess-panel">
          <label class="sr-only" for="corzaguessr-guess">SEARCH FOR A TRACK</label>
          <input
            id="corzaguessr-guess"
            class="guess-input"
            type="text"
            placeholder="SEARCH FOR A TRACK"
            autocomplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="corzaguessr-suggestions"
            aria-expanded="false"
            disabled
          >
          <div id="corzaguessr-suggestions" class="suggestions" role="listbox" hidden></div>
        </div>

        <div class="game-actions">
          <button type="button" class="skip-button primary-button" disabled>ADD 1S</button>
        </div>

        <ol class="attempt-list" aria-label="ATTEMPT HISTORY" aria-live="polite"></ol>
      </main>
    </div>

    <dialog class="result-dialog">
      <div class="dialog-panel result-panel">
        <p class="eyebrow">RESULT</p>
        <h2 class="result-title">ROUND COMPLETE</h2>
        <div class="result-modules"></div>
        <div class="dialog-actions">
          <button type="button" class="primary-button result-next">NEW GAME</button>
          <button type="button" class="secondary-button result-spotify">SPOTIFY</button>
        </div>
      </div>
    </dialog>

    <dialog class="discovery-dialog">
      <div class="dialog-panel discovery-panel">
        <div class="dialog-heading">
          <div>
            <p class="eyebrow">COLLECTION</p>
            <h2>DISCOVERY</h2>
          </div>
          <strong class="discovery-count">0 / 0</strong>
        </div>
        <div class="discovery-items" role="list"></div>
        <div class="dialog-actions">
          <button type="button" class="primary-button discovery-close">CLOSE</button>
          <button type="button" class="secondary-button discovery-reset">RESET</button>
        </div>
      </div>
    </dialog>

    <p class="sr-only live-status" aria-live="polite"></p>
    <audio class="audio-player" preload="metadata" playsinline hidden></audio>
    <audio class="audio-player" preload="metadata" playsinline hidden></audio>
  `;

  function queryRequired<T extends Element>(selector: string): T {
    const element = appRoot.querySelector<T>(selector);
    if (!element) throw new Error(`Corzaguessr could not find ${selector}.`);
    return element;
  }

  interface DomReferences {
    readonly gameCard: HTMLElement;
    readonly modeButtons: ReadonlyMap<ModeId, HTMLButtonElement>;
    readonly recordLabels: ReadonlyMap<ModeId, HTMLElement>;
    readonly gameModeLabel: HTMLElement;
    readonly gameStat: HTMLElement;
    readonly instruction: HTMLElement;
    readonly play: HTMLButtonElement;
    readonly playIcon: SVGPathElement;
    readonly currentTime: HTMLElement;
    readonly endTime: HTMLElement;
    readonly timeline: HTMLElement;
    readonly timeChange: HTMLElement;
    readonly guess: HTMLInputElement;
    readonly suggestions: HTMLElement;
    readonly skip: HTMLButtonElement;
    readonly attempts: HTMLOListElement;
    readonly discoveryButton: HTMLButtonElement;
    readonly discoveryDialog: HTMLDialogElement;
    readonly discoveryCount: HTMLElement;
    readonly discoveryItems: HTMLElement;
    readonly discoveryClose: HTMLButtonElement;
    readonly discoveryReset: HTMLButtonElement;
    readonly resultDialog: HTMLDialogElement;
    readonly resultTitle: HTMLElement;
    readonly resultModules: HTMLElement;
    readonly resultNext: HTMLButtonElement;
    readonly resultSpotify: HTMLButtonElement;
    readonly retryCatalog: HTMLButtonElement;
    readonly liveStatus: HTMLElement;
    readonly audioPlayers: readonly [HTMLAudioElement, HTMLAudioElement];
  }

  const modeButtons = new Map<ModeId, HTMLButtonElement>();
  appRoot.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
    const mode = button.dataset.mode as ModeId | undefined;
    if (mode && mode in MODES) modeButtons.set(mode, button);
  });
  const recordLabels = new Map<ModeId, HTMLElement>();
  appRoot.querySelectorAll<HTMLElement>("[data-record]").forEach((label) => {
    const mode = label.dataset.record as ModeId | undefined;
    if (mode && mode in MODES) recordLabels.set(mode, label);
  });
  const audioElements = [...appRoot.querySelectorAll<HTMLAudioElement>(".audio-player")];
  if (audioElements.length !== 2 || !audioElements[0] || !audioElements[1]) {
    throw new Error("Corzaguessr requires exactly two audio players.");
  }

  const dom: DomReferences = {
    gameCard: queryRequired<HTMLElement>(".game-card"),
    modeButtons,
    recordLabels,
    gameModeLabel: queryRequired<HTMLElement>(".game-mode-label"),
    gameStat: queryRequired<HTMLElement>(".game-stat"),
    instruction: queryRequired<HTMLElement>(".instruction"),
    play: queryRequired<HTMLButtonElement>(".play-button"),
    playIcon: queryRequired<SVGPathElement>(".play-button path"),
    currentTime: queryRequired<HTMLElement>(".time-current"),
    endTime: queryRequired<HTMLElement>(".time-end"),
    timeline: queryRequired<HTMLElement>(".timeline"),
    timeChange: queryRequired<HTMLElement>(".time-change"),
    guess: queryRequired<HTMLInputElement>(".guess-input"),
    suggestions: queryRequired<HTMLElement>(".suggestions"),
    skip: queryRequired<HTMLButtonElement>(".skip-button"),
    attempts: queryRequired<HTMLOListElement>(".attempt-list"),
    discoveryButton: queryRequired<HTMLButtonElement>(".discovery-button"),
    discoveryDialog: queryRequired<HTMLDialogElement>(".discovery-dialog"),
    discoveryCount: queryRequired<HTMLElement>(".discovery-count"),
    discoveryItems: queryRequired<HTMLElement>(".discovery-items"),
    discoveryClose: queryRequired<HTMLButtonElement>(".discovery-close"),
    discoveryReset: queryRequired<HTMLButtonElement>(".discovery-reset"),
    resultDialog: queryRequired<HTMLDialogElement>(".result-dialog"),
    resultTitle: queryRequired<HTMLElement>(".result-title"),
    resultModules: queryRequired<HTMLElement>(".result-modules"),
    resultNext: queryRequired<HTMLButtonElement>(".result-next"),
    resultSpotify: queryRequired<HTMLButtonElement>(".result-spotify"),
    retryCatalog: queryRequired<HTMLButtonElement>(".catalog-retry"),
    liveStatus: queryRequired<HTMLElement>(".live-status"),
    audioPlayers: [audioElements[0], audioElements[1]],
  };

  let dispatchEvent: (event: GameEvent) => void = () => undefined;
  let getState: () => GameState = () => initialState;

  interface GameClock {
    resetClassic(limitMs: number): ClockSnapshot;
    setClassicLimit(limitMs: number): ClockSnapshot;
    resetTimed(kind: "blitz" | "survival", initialMs: number): ClockSnapshot;
    resume(): boolean;
    pause(): ClockSnapshot;
    adjustRemaining(deltaMs: number): ClockSnapshot;
    stop(): ClockSnapshot;
    snapshot(): ClockSnapshot;
    destroy(): void;
  }

  function createGameClock(onVisual: (snapshot: ClockSnapshot) => void): GameClock {
    const clock = {
      kind: "classic" as ClockKind,
      running: false,
      expired: false,
      anchorMs: 0,
      elapsedMs: 0,
      remainingMs: 0,
      limitMs: SNIPPET_DURATIONS[0] * 1000,
      maxRemainingMs: 0,
      frame: 0,
    };
    let lastDisplayedSecond = Number.NaN;

    function snapshot(): ClockSnapshot {
      return {
        kind: clock.kind,
        running: clock.running,
        expired: clock.expired,
        elapsedMs: clock.elapsedMs,
        remainingMs: clock.remainingMs,
        limitMs: clock.limitMs,
        maxRemainingMs: clock.maxRemainingMs,
      };
    }

    function cancelFrame(): void {
      if (clock.frame) cancelAnimationFrame(clock.frame);
      clock.frame = 0;
    }

    function render(forceText = false): void {
      const value = clock.kind === "blitz" ? clock.remainingMs : clock.elapsedMs;
      const displayedSecond = Math.floor(value / 1000);
      if (forceText || displayedSecond !== lastDisplayedSecond || clock.kind === "survival") {
        lastDisplayedSecond = displayedSecond;
        onVisual(snapshot());
        return;
      }
      const state = getState();
      const mode = currentMode(state);
      if (!mode) return;
      let progress = 0;
      if (mode.clock === "classic") progress = clock.elapsedMs / (MAX_SNIPPET_SECONDS * 1000);
      else if (mode.clock === "survival") progress = clock.maxRemainingMs ? clock.remainingMs / clock.maxRemainingMs : 0;
      else progress = mode.initialMs ? clock.remainingMs / mode.initialMs : 0;
      dom.timeline.style.setProperty("--progress", String(Math.max(0, Math.min(1, progress))));
    }

    function reachedLimit(): boolean {
      return clock.kind === "classic"
        ? clock.elapsedMs >= clock.limitMs
        : clock.remainingMs <= 0;
    }

    function expireIfNeeded(): void {
      if (clock.expired || !reachedLimit()) return;
      clock.expired = true;
      clock.running = false;
      cancelFrame();
      render(true);
      dispatchEvent({ type: "CLOCK_EXPIRED", clock: snapshot() });
    }

    function commit(now = performance.now(), allowExpire = true): ClockSnapshot {
      if (!clock.running) return snapshot();
      const delta = Math.max(0, now - clock.anchorMs);
      clock.anchorMs = now;
      if (clock.kind === "classic") {
        clock.elapsedMs += delta;
      } else {
        clock.remainingMs = Math.max(0, clock.remainingMs - delta);
        if (clock.kind === "survival") clock.elapsedMs += delta;
      }
      render();
      if (allowExpire) expireIfNeeded();
      return snapshot();
    }

    function tick(now: number): void {
      if (!clock.running) return;
      commit(now);
      if (clock.running) clock.frame = requestAnimationFrame(tick);
    }

    function resetClassic(limitMs: number): ClockSnapshot {
      cancelFrame();
      Object.assign(clock, {
        kind: "classic" as ClockKind,
        running: false,
        expired: false,
        anchorMs: 0,
        elapsedMs: 0,
        remainingMs: 0,
        limitMs,
        maxRemainingMs: 0,
      });
      lastDisplayedSecond = Number.NaN;
      render(true);
      return snapshot();
    }

    function setClassicLimit(limitMs: number): ClockSnapshot {
      commit(performance.now(), false);
      clock.limitMs = limitMs;
      expireIfNeeded();
      render(true);
      return snapshot();
    }

    function resetTimed(kind: "blitz" | "survival", initialMs: number): ClockSnapshot {
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
      lastDisplayedSecond = Number.NaN;
      render(true);
      return snapshot();
    }

    function resume(): boolean {
      if (clock.running || clock.expired) return false;
      clock.running = true;
      clock.anchorMs = performance.now();
      clock.frame = requestAnimationFrame(tick);
      render(true);
      return true;
    }

    function pause(): ClockSnapshot {
      if (clock.running) commit();
      clock.running = false;
      cancelFrame();
      render(true);
      return snapshot();
    }

    function adjustRemaining(deltaMs: number): ClockSnapshot {
      if (clock.kind === "classic" || clock.expired) return snapshot();
      if (clock.running) commit();
      if (clock.expired) return snapshot();
      clock.remainingMs = Math.max(0, clock.remainingMs + deltaMs);
      clock.maxRemainingMs = Math.max(clock.maxRemainingMs, clock.remainingMs);
      expireIfNeeded();
      render(true);
      return snapshot();
    }

    function stop(): ClockSnapshot {
      if (clock.running) commit(performance.now(), false);
      clock.running = false;
      cancelFrame();
      render(true);
      return snapshot();
    }

    function destroy(): void {
      cancelFrame();
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
      destroy,
    };
  }

  function renderClockVisual(clock: ClockSnapshot): void {
    const state = getState();
    const mode = currentMode(state);
    if (!mode) {
      dom.currentTime.textContent = "0:00";
      dom.endTime.textContent = "0:01";
      dom.timeline.style.setProperty("--progress", "0");
      dom.timeline.style.setProperty("--snippet", String(1 / MAX_SNIPPET_SECONDS));
      return;
    }

    let current = "0:00";
    let end = "0:01";
    let progress = 0;
    let snippet = 0;
    if (mode.clock === "classic") {
      current = formatTime(clock.elapsedMs);
      end = formatTime(clock.limitMs);
      progress = clock.elapsedMs / (MAX_SNIPPET_SECONDS * 1000);
      snippet = clock.limitMs / (MAX_SNIPPET_SECONDS * 1000);
    } else if (mode.clock === "blitz") {
      current = formatTime(Math.ceil(clock.remainingMs / 1000) * 1000);
      end = formatTime(mode.initialMs);
      progress = mode.initialMs ? clock.remainingMs / mode.initialMs : 0;
    } else {
      current = formatTime(clock.elapsedMs);
      end = formatTime(Math.ceil(clock.remainingMs / 1000) * 1000);
      progress = clock.maxRemainingMs ? clock.remainingMs / clock.maxRemainingMs : 0;
    }
    dom.currentTime.textContent = current;
    dom.endTime.textContent = end;
    dom.timeline.style.setProperty("--progress", String(Math.max(0, Math.min(1, progress))));
    dom.timeline.style.setProperty("--snippet", String(Math.max(0, Math.min(1, snippet))));
    dom.timeline.classList.toggle("timeline--timed", mode.clock !== "classic");
  }

  const gameClock = createGameClock(renderClockVisual);

  interface AudioService {
    prefetch(round: Round): boolean;
    playRound(round: Round, rewind: boolean): boolean;
    playActive(rewind: boolean): boolean;
    pauseActive(): void;
    releaseActive(): void;
    reset(): void;
    getStandbyRound(): Round | null;
    getActiveRound(): Round | null;
    isPlayRequested(): boolean;
  }

  interface AudioSlot {
    readonly index: 0 | 1;
    element: HTMLAudioElement;
    generation: number;
    role: "empty" | AudioRole;
    round: Round | null;
    controller: AbortController | null;
    failed: boolean;
  }

  function getAudioUrl(round: Round): string {
    const url = new URL(`${String(round.track.id).padStart(2, "0")}.mp3`, AUDIO_BASE_URL);
    url.hash = `t=${round.startSeconds}`;
    return url.href;
  }

  function createAudioService(elements: readonly [HTMLAudioElement, HTMLAudioElement]): AudioService {
    const slots: [AudioSlot, AudioSlot] = [
      {
        index: 0,
        element: elements[0],
        generation: 0,
        role: "empty",
        round: null,
        controller: null,
        failed: false,
      },
      {
        index: 1,
        element: elements[1],
        generation: 0,
        role: "empty",
        round: null,
        controller: null,
        failed: false,
      },
    ];
    let activeIndex: 0 | 1 | null = null;
    let standbyIndex: 0 | 1 | null = null;
    let transport: "empty" | "starting" | "playing" | "buffering" | "paused" | "error" = "empty";

    function isCurrent(slot: AudioSlot, generation: number): boolean {
      return slot.generation === generation && slot.role !== "empty" && slot.round !== null;
    }

    function seekToStart(slot: AudioSlot): void {
      const round = slot.round;
      if (!round || slot.element.readyState < HTMLMediaElement.HAVE_METADATA) return;
      const duration = Number.isFinite(slot.element.duration) ? slot.element.duration : round.track.durationSeconds;
      const maximum = Math.max(0, duration - 0.05);
      try {
        slot.element.currentTime = Math.min(round.startSeconds, maximum);
      } catch {
        // The media fragment remains the fallback until seeking is accepted.
      }
    }

    function releaseSlot(slot: AudioSlot): void {
      slot.controller?.abort();
      slot.controller = null;
      slot.generation += 1;
      slot.role = "empty";
      slot.round = null;
      slot.failed = false;
      slot.element.pause();
      slot.element.removeAttribute("src");
      slot.element.load();
    }

    function reportFailure(slot: AudioSlot): void {
      if (slot.failed || !slot.round || slot.role === "empty") return;
      slot.failed = true;
      const round = slot.round;
      const role = slot.role;
      if (role === "standby") {
        standbyIndex = null;
        releaseSlot(slot);
      } else {
        transport = "error";
      }
      dispatchEvent({ type: "AUDIO_FAILED", round, role });
    }

    function bind(slot: AudioSlot): void {
      const generation = slot.generation;
      const controller = new AbortController();
      slot.controller = controller;
      const signal = controller.signal;

      slot.element.addEventListener("loadedmetadata", () => {
        if (isCurrent(slot, generation)) seekToStart(slot);
      }, { signal });
      slot.element.addEventListener("playing", () => {
        if (!isCurrent(slot, generation) || activeIndex !== slot.index || !slot.round) return;
        transport = "playing";
        dispatchEvent({ type: "AUDIO_PLAYING", roundId: slot.round.id });
      }, { signal });
      slot.element.addEventListener("waiting", () => {
        if (!isCurrent(slot, generation) || activeIndex !== slot.index || !slot.round || transport === "paused") return;
        transport = "buffering";
        dispatchEvent({ type: "AUDIO_WAITING", roundId: slot.round.id });
      }, { signal });
      slot.element.addEventListener("ended", () => {
        if (!isCurrent(slot, generation) || activeIndex !== slot.index || !slot.round) return;
        transport = "paused";
        dispatchEvent({ type: "AUDIO_ENDED", roundId: slot.round.id });
      }, { signal });
      slot.element.addEventListener("error", () => {
        if (isCurrent(slot, generation) && slot.element.error) reportFailure(slot);
      }, { signal });
    }

    function assign(slot: AudioSlot, round: Round, role: AudioRole): void {
      releaseSlot(slot);
      slot.generation += 1;
      slot.role = role;
      slot.round = round;
      slot.failed = false;
      slot.element.preload = role === "standby" ? "auto" : "metadata";
      bind(slot);
      slot.element.src = getAudioUrl(round);
      slot.element.load();
    }

    function otherIndex(index: 0 | 1 | null): 0 | 1 {
      return index === 0 ? 1 : 0;
    }

    function prefetch(round: Round): boolean {
      if (activeIndex !== null && slots[activeIndex].round?.id === round.id) return true;
      if (standbyIndex !== null && slots[standbyIndex].round?.id === round.id) return true;
      const index = otherIndex(activeIndex);
      if (standbyIndex !== null && standbyIndex !== index) releaseSlot(slots[standbyIndex]);
      standbyIndex = index;
      assign(slots[index], round, "standby");
      return true;
    }

    function promote(round: Round): AudioSlot {
      if (standbyIndex !== null && slots[standbyIndex].round?.id === round.id) {
        const nextIndex = standbyIndex;
        standbyIndex = null;
        if (activeIndex !== null && activeIndex !== nextIndex) releaseSlot(slots[activeIndex]);
        activeIndex = nextIndex;
        const slot = slots[nextIndex];
        slot.role = "active";
        transport = "paused";
        return slot;
      }

      const index = otherIndex(activeIndex);
      if (standbyIndex !== null && standbyIndex !== index) releaseSlot(slots[standbyIndex]);
      standbyIndex = null;
      if (activeIndex !== null && activeIndex !== index) releaseSlot(slots[activeIndex]);
      activeIndex = index;
      const slot = slots[index];
      assign(slot, round, "active");
      transport = "paused";
      return slot;
    }

    function requestPlay(slot: AudioSlot, rewind: boolean): boolean {
      if (!slot.round || slot.failed) return false;
      const generation = slot.generation;
      if (rewind) seekToStart(slot);
      transport = "starting";
      const playPromise = slot.element.play();
      playPromise?.catch((error: unknown) => {
        if (!isCurrent(slot, generation) || activeIndex !== slot.index) return;
        const name = error instanceof DOMException ? error.name : "";
        if (name === "AbortError") return;
        if (name === "NotAllowedError" && slot.round) {
          transport = "paused";
          dispatchEvent({ type: "AUDIO_PLAY_BLOCKED", roundId: slot.round.id });
          return;
        }
        reportFailure(slot);
      });
      return true;
    }

    function playRound(round: Round, rewind: boolean): boolean {
      const slot = activeIndex !== null && slots[activeIndex].round?.id === round.id
        ? slots[activeIndex]
        : promote(round);
      return requestPlay(slot, rewind);
    }

    function playActive(rewind: boolean): boolean {
      if (activeIndex === null) return false;
      return requestPlay(slots[activeIndex], rewind);
    }

    function pauseActive(): void {
      if (activeIndex === null) return;
      transport = "paused";
      slots[activeIndex].element.pause();
    }

    function releaseActive(): void {
      if (activeIndex === null) return;
      const index = activeIndex;
      activeIndex = null;
      releaseSlot(slots[index]);
      transport = standbyIndex === null ? "empty" : "paused";
    }

    function reset(): void {
      if (activeIndex !== null) releaseSlot(slots[activeIndex]);
      if (standbyIndex !== null && standbyIndex !== activeIndex) releaseSlot(slots[standbyIndex]);
      activeIndex = null;
      standbyIndex = null;
      transport = "empty";
    }

    function getStandbyRound(): Round | null {
      return standbyIndex === null ? null : slots[standbyIndex].round;
    }

    function getActiveRound(): Round | null {
      return activeIndex === null ? null : slots[activeIndex].round;
    }

    function isPlayRequested(): boolean {
      return transport === "starting" || transport === "playing" || transport === "buffering";
    }

    return {
      prefetch,
      playRound,
      playActive,
      pauseActive,
      releaseActive,
      reset,
      getStandbyRound,
      getActiveRound,
      isPlayRequested,
    };
  }

  const audioService = createAudioService(dom.audioPlayers);

  function readStorage(key: string): unknown {
    try {
      const value = localStorage.getItem(key);
      return value === null ? null : JSON.parse(value);
    } catch {
      return null;
    }
  }

  function writeProfile(profile: PlayerProfile): boolean {
    const serializable = {
      discoveries: [...profile.discoveries].sort((a, b) => a - b),
      records: profile.records,
      daily: profile.daily,
    };
    try {
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(serializable));
      return true;
    } catch {
      announce("PROGRESS COULD NOT BE SAVED IN THIS BROWSER.");
      return false;
    }
  }

  function validNonNegativeInteger(value: unknown): number {
    return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
  }

  function validAccuracy(value: unknown): number | null {
    return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100
      ? Number(value)
      : null;
  }

  function normalizeClassicRecord(value: unknown): ClassicRecord {
    const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const current = validNonNegativeInteger(source.current);
    const best = Math.max(current, validNonNegativeInteger(source.best));
    const snippetTotal = validNonNegativeInteger(source.snippetTotal);
    const bestSnippetTotal = validNonNegativeInteger(source.bestSnippetTotal);
    return {
      current: snippetTotal >= current && snippetTotal <= current * MAX_SNIPPET_SECONDS ? current : 0,
      best,
      snippetTotal: snippetTotal >= current && snippetTotal <= current * MAX_SNIPPET_SECONDS ? snippetTotal : 0,
      bestSnippetTotal: bestSnippetTotal >= best && bestSnippetTotal <= best * MAX_SNIPPET_SECONDS
        ? bestSnippetTotal
        : 0,
    };
  }

  function normalizeTimedRecord(value: unknown): TimedRecord {
    const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return {
      score: validNonNegativeInteger(source.score),
      accuracy: validAccuracy(source.accuracy),
    };
  }

  function normalizeRecords(value: unknown): PersonalRecords {
    const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return {
      classic: normalizeClassicRecord(source.classic),
      daily: validNonNegativeInteger(source.daily),
      blitz: normalizeTimedRecord(source.blitz),
      survival: normalizeTimedRecord(source.survival),
    };
  }

  function normalizeDailyProgress(value: unknown, tracks: readonly Track[]): DailyProgress | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Record<string, unknown>;
    if (!isDateKey(source.date)) return null;
    const started = source.started === true;
    const completed = started && source.completed === true;
    const stepValue = validNonNegativeInteger(source.step);
    const step = Math.min(SNIPPET_DURATIONS.length - 1, stepValue);
    const rawTrackId = Number.isSafeInteger(source.trackId)
      ? Number(source.trackId)
      : 0;
    const track = tracks.find((candidate) => candidate.id === rawTrackId) ?? null;
    return {
      date: source.date,
      trackId: track?.id ?? 0,
      started,
      completed,
      won: completed && source.won === true,
      step,
    };
  }

  function normalizeProfile(value: unknown, tracks: readonly Track[]): PlayerProfile | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Record<string, unknown>;
    const validIds = new Set(tracks.map((track) => track.id));
    const discoveries = Array.isArray(source.discoveries)
      ? new Set(source.discoveries.filter((id): id is number => Number.isSafeInteger(id) && validIds.has(Number(id))).map(Number))
      : new Set<number>();
    const daily = normalizeDailyProgress(source.daily, tracks);
    return {
      discoveries,
      records: normalizeRecords(source.records),
      daily: daily && daily.trackId ? daily : null,
    };
  }

  function eligibleDailyTracks(tracks: readonly Track[], date: DateKey): readonly Track[] {
    return tracks.filter((track) => track.availableFrom <= date);
  }

  function deterministicDailyTrack(
    tracks: readonly Track[],
    date: DateKey,
    persistedTrackId: number | null = null,
  ): Track | null {
    const eligible = eligibleDailyTracks(tracks, date);
    if (!eligible.length) return null;
    if (persistedTrackId !== null) {
      const persisted = eligible.find((track) => track.id === persistedTrackId);
      if (persisted) return persisted;
    }
    let winner: Track | null = null;
    let winnerScore = -1;
    for (const track of eligible) {
      const score = hashString(`corzaguessr-daily:${date}:${track.id}`);
      if (score > winnerScore) {
        winner = track;
        winnerScore = score;
      }
    }
    return winner;
  }

  function loadProfile(tracks: readonly Track[]): PlayerProfile {
    return normalizeProfile(readStorage(PROFILE_STORAGE_KEY), tracks) ?? emptyProfile();
  }

  function validateTracks(value: unknown): readonly Track[] {
    if (!Array.isArray(value) || !value.length) throw new Error("Track catalog is empty or invalid.");
    const ids = new Set<number>();
    const titles = new Set<string>();
    const tracks: Track[] = [];

    for (const [index, raw] of value.entries()) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`Track ${index + 1} is not an object.`);
      }
      const item = raw as Record<string, unknown>;
      const id = Number(item.dailyNumber ?? item.id);
      const title = typeof item.title === "string" ? item.title.trim() : "";
      const durationSeconds = Number(item.duration ?? item.durationSeconds);
      const availableFromRaw = item.dailyFrom ?? item.availableFrom ?? "1970-01-01";
      const availableFrom = typeof availableFromRaw === "string" ? availableFromRaw.trim() : "";
      const spotifyRaw = item.spotify ?? item.spotifyId;
      const spotifyId = typeof spotifyRaw === "string" && spotifyRaw.trim() ? spotifyRaw.trim() : null;
      const markedNew = item.isNew === true;

      if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Track ${index + 1} has an invalid ID.`);
      if (ids.has(id)) throw new Error(`Track ID ${id} is duplicated.`);
      if (!title) throw new Error(`Track ${index + 1} has no title.`);
      if (titles.has(title)) throw new Error(`Track title "${title}" is duplicated.`);
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error(`Track ${index + 1} has an invalid duration.`);
      if (!isDateKey(availableFrom)) throw new Error(`Track ${index + 1} has an invalid availability date.`);
      if (spotifyId && !/^[A-Za-z0-9]{22}$/.test(spotifyId)) throw new Error(`Track ${index + 1} has an invalid Spotify ID.`);

      ids.add(id);
      titles.add(title);
      tracks.push({
        id,
        title,
        searchText: normalizeSearch(title),
        spotifyId,
        durationSeconds,
        availableFrom,
        markedNew,
      });
    }
    return tracks;
  }

  let announcementFrame = 0;
  function announce(message: string): void {
    cancelAnimationFrame(announcementFrame);
    dom.liveStatus.textContent = "";
    announcementFrame = requestAnimationFrame(() => {
      dom.liveStatus.textContent = message;
    });
  }

  let roundSerial = 0;

  function chooseTrackForState(
    state: GameState,
    exclusions: ReadonlySet<number> = new Set<number>(),
  ): Track | null {
    if (!state.mode) return null;
    const mode = MODES[state.mode];
    if (mode.daily) {
      const persisted = state.profile.daily?.date === state.today
        ? state.profile.daily.trackId
        : null;
      return deterministicDailyTrack(state.catalog, state.today, persisted);
    }

    const available = state.catalog.filter((track) =>
      !state.unavailableTrackIds.has(track.id) && !exclusions.has(track.id),
    );
    if (!available.length) return null;
    const withoutPrevious = available.length > 1 && state.previousTrackId !== null
      ? available.filter((track) => track.id !== state.previousTrackId)
      : available;
    const pool = withoutPrevious.length ? withoutPrevious : available;
    return pool[Math.floor(Math.random() * pool.length)] ?? null;
  }

  function createRound(state: GameState, track: Track, countOnCommit: boolean): Round {
    if (!state.mode) throw new Error("Cannot create a round without a mode.");
    const mode = MODES[state.mode];
    const minimumRemainingSeconds = Math.min(
      mode.clock === "classic" ? MAX_SNIPPET_SECONDS : MINIMUM_TIMED_REMAINING_SECONDS,
      track.durationSeconds,
    );
    const available = Math.max(0, Math.floor(track.durationSeconds - minimumRemainingSeconds));
    const date = mode.daily ? state.today : null;
    const startSeconds = mode.daily && date
      ? hashString(`corzaguessr-daily-clip:${date}:${track.id}`) % (available + 1)
      : Math.floor(Math.random() * (available + 1));
    return {
      id: ++roundSerial,
      mode: state.mode,
      date,
      track,
      startSeconds,
      countOnCommit,
    };
  }

  function standbyMatchesState(state: GameState, round: Round | null): round is Round {
    if (!round || !state.mode || round.mode !== state.mode) return false;
    return round.mode !== "daily" || round.date === state.today;
  }

  interface DateScheduler {
    start(): void;
    synchronize(): void;
    destroy(): void;
  }

  function createDateScheduler(signal: AbortSignal): DateScheduler {
    let currentDate = getDailyDate();
    let timer = 0;

    function clear(): void {
      if (timer) clearTimeout(timer);
      timer = 0;
    }

    function findBoundary(now: number): number {
      const date = getDailyDate(new Date(now));
      let high = now + 36 * 60 * 60 * 1000;
      while (getDailyDate(new Date(high)) === date) high += 12 * 60 * 60 * 1000;
      let low = now;
      while (high - low > 1000) {
        const middle = Math.floor((low + high) / 2);
        if (getDailyDate(new Date(middle)) === date) low = middle;
        else high = middle;
      }
      return high;
    }

    function schedule(): void {
      clear();
      const now = Date.now();
      const boundary = findBoundary(now);
      timer = window.setTimeout(() => {
        synchronize();
      }, Math.max(1000, boundary - now + 1000));
    }

    function synchronize(): void {
      const nextDate = getDailyDate();
      if (nextDate !== currentDate) {
        currentDate = nextDate;
        dispatchEvent({ type: "DATE_CHANGED", date: nextDate });
      }
      schedule();
    }

    function start(): void {
      currentDate = getDailyDate();
      schedule();
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) synchronize();
      }, { signal });
      window.addEventListener("pageshow", synchronize, { signal });
      window.addEventListener("focus", synchronize, { signal });
      window.addEventListener("online", synchronize, { signal });
    }

    function destroy(): void {
      clear();
    }

    return { start, synchronize, destroy };
  }

  function dailyStatusText(state: GameState): string | null {
    const daily = state.profile.daily;
    if (!daily || daily.date !== state.today) return null;
    const attempts = daily.step + 1;
    if (daily.completed) {
      return `${daily.won ? "COMPLETED" : "FAILED"} IN ${attempts} ATTEMPT${attempts === 1 ? "" : "S"}. COME BACK TOMORROW.`;
    }
    if (daily.started) return `DAILY IN PROGRESS. CONTINUE FROM ATTEMPT ${attempts}.`;
    return null;
  }

  function instructionForState(state: GameState): string {
    if (state.appStatus === "loading") return "LOADING TRACKLIST...";
    if (state.appStatus === "error") return "THE TRACKLIST COULD NOT BE LOADED.";
    if (!state.mode) return "SELECT A MODE TO BEGIN.";
    const mode = MODES[state.mode];
    if (state.session.phase === "preparing") return "LOADING TRACK...";
    if (state.session.phase === "audio-error") return state.session.message;
    if (state.session.phase === "result") return "ROUND COMPLETE.";
    if (state.session.phase === "idle") {
      if (mode.daily) return dailyStatusText(state) ?? mode.description;
      return mode.description;
    }
    if (mode.clock !== "classic") return `GUESS #${Math.max(1, state.run.rounds)}`;
    const last = state.run.step === SNIPPET_DURATIONS.length - 1;
    return last
      ? "LAST CHANCE TO GUESS."
      : `GUESS ${state.run.step + 1} OF ${SNIPPET_DURATIONS.length}.`;
  }

  function gameStatForState(state: GameState): string {
    if (!state.mode) return "READY WHEN YOU ARE";
    if (state.mode === "classic") return `STREAK ${state.profile.records.classic.current}`;
    if (state.mode === "daily") {
      const step = state.session.phase === "active" ? state.run.step : dailyStepForState(state, "daily");
      return `ATTEMPT ${step + 1} / ${SNIPPET_DURATIONS.length}`;
    }
    return `SCORE ${state.run.correct} · ACCURACY ${formatAccuracy(getAccuracy(state.run))}`;
  }

  function skipLabelForState(state: GameState): string {
    if (!state.mode || MODES[state.mode].clock !== "classic") return "SKIP";
    const current = SNIPPET_DURATIONS[state.run.step] ?? SNIPPET_DURATIONS[0];
    if (state.run.step >= SNIPPET_DURATIONS.length - 1) return "GIVE UP";
    const next = SNIPPET_DURATIONS[state.run.step + 1] ?? current;
    return `ADD ${next - current}S`;
  }

  function recordLabel(mode: ModeId, records: PersonalRecords): string {
    if (mode === "daily") return records.daily ? `PB ${records.daily} TRY${records.daily === 1 ? "" : "S"}` : "PB --";
    if (mode === "classic") return `PB ${records.classic.best}`;
    if (mode === "blitz") return `PB ${records.blitz.score}`;
    return `PB ${formatTime(records.survival.score)}`;
  }

  function renderAttempts(attempts: readonly AttemptEntry[]): void {
    dom.attempts.replaceChildren(...attempts.map((attempt) => {
      const item = document.createElement("li");
      item.className = `attempt attempt--${attempt.tone}`;
      item.textContent = attempt.text;
      return item;
    }));
  }

  function isRecentlyAvailable(track: Track, today: DateKey): boolean {
    if (track.markedNew) return true;
    const available = Date.parse(`${track.availableFrom}T00:00:00Z`);
    const current = Date.parse(`${today}T00:00:00Z`);
    const ageDays = Math.floor((current - available) / 86_400_000);
    return ageDays >= 0 && ageDays <= 14;
  }

  function renderDiscovery(state: GameState): void {
    const tracks = [...state.catalog].sort((left, right) => right.id - left.id);
    const found = tracks.reduce((count, track) => count + (state.profile.discoveries.has(track.id) ? 1 : 0), 0);
    const percent = tracks.length ? Math.round((found * 100) / tracks.length) : 0;
    dom.discoveryCount.textContent = `${found} / ${tracks.length} (${percent}%)`;
    dom.discoveryItems.replaceChildren(...tracks.map((track) => {
      const item = document.createElement("div");
      item.className = "discovery-item";
      item.setAttribute("role", "listitem");
      const discovered = state.profile.discoveries.has(track.id);
      if (isRecentlyAvailable(track, state.today) && !discovered) {
        const marker = document.createElement("span");
        marker.className = "new-marker";
        marker.textContent = "NEW";
        const title = document.createElement("span");
        title.textContent = HIDDEN_TITLE;
        item.append(marker, title);
        item.setAttribute("aria-label", "NEW UNDISCOVERED TRACK");
      } else {
        item.textContent = discovered ? track.title : HIDDEN_TITLE;
        if (!discovered) item.setAttribute("aria-label", "UNDISCOVERED TRACK");
      }
      return item;
    }));
  }

  function renderResult(result: GameResult): void {
    dom.resultTitle.textContent = result.heading;
    dom.resultTitle.dataset.success = result.success === null ? "timed" : result.success ? "true" : "false";
    dom.resultModules.replaceChildren(...result.modules.map((module) => {
      const wrapper = document.createElement("div");
      wrapper.className = "result-module";
      const label = document.createElement("span");
      label.className = "result-module__label";
      label.textContent = module.label;
      const value = document.createElement("strong");
      value.className = "result-module__value";
      if (module.highlight) value.classList.add("result-module__value--highlight");
      value.textContent = module.value;
      wrapper.append(label, value);
      return wrapper;
    }));
    dom.resultSpotify.hidden = result.spotifyId === null;
  }

  function render(previous: GameState, state: GameState): void {
    appRoot.dataset.appStatus = state.appStatus;
    appRoot.dataset.session = state.session.phase;
    appRoot.dataset.mode = state.mode ?? "none";
    dom.gameCard.setAttribute("aria-busy", String(state.appStatus === "loading" || state.session.phase === "preparing"));
    dom.retryCatalog.hidden = state.appStatus !== "error";

    for (const [mode, button] of dom.modeButtons) {
      const selected = state.mode === mode;
      button.disabled = state.appStatus === "loading" || state.appStatus === "error";
      button.setAttribute("aria-pressed", String(selected));
      button.classList.toggle("mode-card--selected", selected);
    }
    for (const [mode, label] of dom.recordLabels) {
      label.textContent = recordLabel(mode, state.profile.records);
    }

    dom.gameModeLabel.textContent = state.mode ? state.mode.toLocaleUpperCase() : "SELECT A MODE";
    dom.gameStat.textContent = gameStatForState(state);
    dom.instruction.textContent = instructionForState(state);
    dom.skip.textContent = skipLabelForState(state);

    const mode = currentMode(state);
    const active = state.session.phase === "active";
    const preparing = state.session.phase === "preparing";
    const result = state.session.phase === "result";
    const dailyBlocked = Boolean(mode?.daily && state.session.phase === "idle" && isDailyDone(state));
    const playEnabled = state.appStatus === "ready" && mode !== null && !preparing && !result && !dailyBlocked;
    const controlsEnabled = state.appStatus === "ready" && active && !result;
    dom.play.disabled = !playEnabled;
    dom.guess.disabled = !controlsEnabled;
    dom.skip.disabled = !controlsEnabled;
    dom.discoveryButton.disabled = state.appStatus === "loading" || state.appStatus === "error" || state.session.phase !== "idle";

    const playing = active && state.session.transport !== "paused";
    dom.playIcon.setAttribute("d", playing ? ICON_PATHS.pause : ICON_PATHS.play);
    dom.play.setAttribute("aria-label", playing ? "PAUSE" : "PLAY");
    dom.play.classList.toggle("play-button--loading", preparing || (active && state.session.transport === "buffering"));

    if (previous.run.attempts !== state.run.attempts) renderAttempts(state.run.attempts);
    if (previous.profile !== state.profile || previous.catalog !== state.catalog || previous.today !== state.today) {
      renderDiscovery(state);
    }
    if (state.session.phase === "result" && previous.session !== state.session) {
      renderResult(state.session.result);
    }

    renderClockVisual(gameClock.snapshot());
  }

  type InteractionModality = "keyboard" | "fine-pointer" | "coarse-pointer";
  let interactionModality: InteractionModality = matchMedia("(pointer: fine)").matches
    ? "fine-pointer"
    : "coarse-pointer";

  interface AutocompleteController {
    clear(): void;
    focus(): void;
    refresh(): void;
  }

  function createAutocomplete(signal: AbortSignal): AutocompleteController {
    let results: readonly Track[] = [];
    let activeIndex = -1;

    function close(): void {
      results = [];
      activeIndex = -1;
      dom.suggestions.replaceChildren();
      dom.suggestions.hidden = true;
      dom.guess.setAttribute("aria-expanded", "false");
      dom.guess.removeAttribute("aria-activedescendant");
    }

    function setActive(index: number): void {
      if (!results.length) return;
      const normalized = (index + results.length) % results.length;
      const previousOption = dom.suggestions.querySelector<HTMLElement>("[aria-selected='true']");
      previousOption?.setAttribute("aria-selected", "false");
      previousOption?.classList.remove("suggestion--active");
      activeIndex = normalized;
      const option = dom.suggestions.querySelector<HTMLElement>(`[data-index="${normalized}"]`);
      if (!option) return;
      option.setAttribute("aria-selected", "true");
      option.classList.add("suggestion--active");
      dom.guess.setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView({ block: "nearest" });
    }

    function refresh(): void {
      const state = getState();
      const query = normalizeSearch(dom.guess.value);
      if (!query || dom.guess.disabled) {
        close();
        return;
      }
      results = state.catalog
        .filter((track) => !state.run.usedTrackIds.has(track.id) && track.searchText.includes(query))
        .sort((left, right) => {
          const leftPrefix = left.searchText.startsWith(query) ? 0 : left.searchText.includes(` ${query}`) ? 1 : 2;
          const rightPrefix = right.searchText.startsWith(query) ? 0 : right.searchText.includes(` ${query}`) ? 1 : 2;
          return leftPrefix - rightPrefix || left.title.localeCompare(right.title);
        })
        .slice(0, 8);
      activeIndex = results.length ? 0 : -1;
      dom.suggestions.replaceChildren(...results.map((track, index) => {
        const option = document.createElement("button");
        option.type = "button";
        option.id = `corzaguessr-option-${index}`;
        option.className = index === 0 ? "suggestion suggestion--active" : "suggestion";
        option.dataset.index = String(index);
        option.dataset.trackId = String(track.id);
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(index === 0));
        option.textContent = track.title;
        return option;
      }));
      dom.suggestions.hidden = !results.length;
      dom.guess.setAttribute("aria-expanded", String(Boolean(results.length)));
      if (results.length) dom.guess.setAttribute("aria-activedescendant", "corzaguessr-option-0");
      else dom.guess.removeAttribute("aria-activedescendant");
    }

    function submit(index: number): void {
      const track = results[index];
      if (!track) return;
      dispatchEvent({ type: "ATTEMPT_REQUESTED", trackId: track.id });
    }

    dom.guess.addEventListener("input", refresh, { signal });
    dom.guess.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        clear();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!results.length) return;
        event.preventDefault();
        setActive(activeIndex + (event.key === "ArrowDown" ? 1 : -1));
        return;
      }
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (results.length && activeIndex >= 0) submit(activeIndex);
      else if (!dom.guess.value.trim()) dispatchEvent({ type: "PLAY_PRESSED" });
    }, { signal });
    dom.suggestions.addEventListener("pointerover", (event) => {
      const option = (event.target as Element | null)?.closest<HTMLElement>("[data-index]");
      if (!option) return;
      const index = Number(option.dataset.index);
      if (Number.isInteger(index)) setActive(index);
    }, { signal });
    dom.suggestions.addEventListener("click", (event) => {
      const option = (event.target as Element | null)?.closest<HTMLElement>("[data-index]");
      if (!option) return;
      const index = Number(option.dataset.index);
      if (Number.isInteger(index)) submit(index);
    }, { signal });

    function clear(): void {
      dom.guess.value = "";
      close();
    }

    function focus(): void {
      if (dom.guess.disabled || dom.discoveryDialog.open || dom.resultDialog.open) return;
      if (interactionModality === "coarse-pointer") return;
      queueMicrotask(() => {
        if (!dom.guess.disabled && !dom.discoveryDialog.open && !dom.resultDialog.open) dom.guess.focus();
      });
    }

    return { clear, focus, refresh };
  }

  const lifecycle = new AbortController();
  const autocomplete = createAutocomplete(lifecycle.signal);

  function prefetchRound(): void {
    const state = getState();
    if (!state.mode || state.appStatus !== "ready" || state.session.phase === "result" || state.session.phase === "preparing") return;
    if (state.mode === "daily" && isDailyDone(state)) return;
    const existing = audioService.getStandbyRound();
    if (standbyMatchesState(state, existing) && !state.unavailableTrackIds.has(existing.track.id)) return;
    const exclusions = new Set<number>();
    const active = audioService.getActiveRound();
    if (active) exclusions.add(active.track.id);
    const track = chooseTrackForState(state, exclusions);
    if (!track) return;
    audioService.prefetch(createRound(state, track, true));
  }

  function executeRoundRequest(command: Extract<Command, { type: "REQUEST_ROUND" }>): void {
    const state = getState();
    if (state.session.phase !== "preparing" || state.session.requestId !== command.requestId || !state.mode) return;

    let round: Round | null = null;
    if (command.retry === "same" && command.round) {
      round = { ...command.round, countOnCommit: command.countOnCommit };
    } else {
      const standby = audioService.getStandbyRound();
      if (standbyMatchesState(state, standby) && !state.unavailableTrackIds.has(standby.track.id)) {
        round = { ...standby, countOnCommit: command.countOnCommit };
      } else {
        const exclusions = new Set<number>();
        const active = audioService.getActiveRound();
        if (active) exclusions.add(active.track.id);
        let track = chooseTrackForState(state, exclusions);
        if (!track && state.catalog.length) {
          const relaxedState: GameState = {
            ...state,
            unavailableTrackIds: new Set<number>(),
          };
          track = chooseTrackForState(relaxedState, exclusions);
        }
        if (track) round = createRound(state, track, command.countOnCommit);
      }
    }

    if (!round) {
      dispatchEvent({
        type: "ROUND_UNAVAILABLE",
        requestId: command.requestId,
        message: "NO PLAYABLE TRACK IS AVAILABLE. PRESS PLAY TO RETRY.",
      });
      return;
    }

    dispatchEvent({ type: "ROUND_ASSIGNED", requestId: command.requestId, round });
    if (!audioService.playRound(round, true)) {
      dispatchEvent({ type: "AUDIO_FAILED", round, role: "active" });
    }
  }

  function flashTimeChange(seconds: number): void {
    dom.timeChange.textContent = `${seconds > 0 ? "+" : ""}${seconds}S`;
    dom.timeChange.classList.remove("time-change--active", "time-change--positive", "time-change--negative");
    void dom.timeChange.offsetWidth;
    dom.timeChange.classList.add(
      "time-change--active",
      seconds > 0 ? "time-change--positive" : "time-change--negative",
    );
    dom.timeChange.addEventListener("animationend", () => {
      dom.timeChange.classList.remove("time-change--active", "time-change--positive", "time-change--negative");
      dom.timeChange.textContent = "";
    }, { once: true });
  }

  function openResultDialog(): void {
    const state = getState();
    if (state.session.phase !== "result") return;
    renderResult(state.session.result);
    if (!dom.resultDialog.open) dom.resultDialog.showModal();
    queueMicrotask(() => dom.resultNext.focus());
  }

  function runCommand(command: Command): void {
    switch (command.type) {
      case "RESET_SERVICES": {
        audioService.reset();
        autocomplete.clear();
        const mode = MODES[command.mode];
        if (mode.clock === "classic") {
          const step = getState().run.step;
          gameClock.resetClassic((SNIPPET_DURATIONS[step] ?? SNIPPET_DURATIONS[0]) * 1000);
        } else {
          gameClock.resetTimed(mode.clock, mode.initialMs);
        }
        return;
      }
      case "REQUEST_ROUND":
        executeRoundRequest(command);
        return;
      case "PREFETCH_ROUND":
        prefetchRound();
        return;
      case "PLAY_ACTIVE": {
        const round = audioService.getActiveRound();
        if (!audioService.playActive(command.rewind) && round) {
          dispatchEvent({ type: "AUDIO_FAILED", round, role: "active" });
        }
        return;
      }
      case "PAUSE_MEDIA":
        gameClock.pause();
        audioService.pauseActive();
        return;
      case "PAUSE_CLOCK":
        gameClock.pause();
        return;
      case "RESUME_CLOCK":
        gameClock.resume();
        return;
      case "RELEASE_ACTIVE_AUDIO":
        audioService.releaseActive();
        return;
      case "RESET_CLASSIC_CLOCK":
        gameClock.resetClassic(command.limitMs);
        return;
      case "SET_CLASSIC_LIMIT":
        gameClock.setClassicLimit(command.limitMs);
        return;
      case "ADJUST_CLOCK":
        gameClock.adjustRemaining(command.deltaMs);
        return;
      case "STOP_MEDIA":
        gameClock.stop();
        audioService.pauseActive();
        return;
      case "CAPTURE_ATTEMPT": {
        const state = getState();
        if (state.session.phase !== "active") return;
        const mode = MODES[state.session.round.mode];
        const wasPlaying = state.session.transport !== "paused" && audioService.isPlayRequested();
        if (mode.clock !== "classic") {
          gameClock.pause();
          audioService.pauseActive();
        }
        dispatchEvent({
          type: "ATTEMPT_APPLY",
          roundId: state.session.round.id,
          trackId: command.trackId,
          clock: gameClock.snapshot(),
          wasPlaying,
        });
        return;
      }
      case "PERSIST_PROFILE":
        writeProfile(getState().profile);
        return;
      case "ANNOUNCE":
        announce(command.message);
        return;
      case "FOCUS_GUESS":
        autocomplete.focus();
        return;
      case "FOCUS_PLAY":
        if (interactionModality !== "coarse-pointer" && !dom.play.disabled) queueMicrotask(() => dom.play.focus());
        return;
      case "CLEAR_GUESS":
        autocomplete.clear();
        return;
      case "OPEN_RESULT":
        openResultDialog();
        return;
      case "FLASH_TIME_CHANGE":
        flashTimeChange(command.seconds);
        return;
    }
  }

  function createStore(initial: GameState): {
    readonly getState: () => GameState;
    readonly dispatch: (event: GameEvent) => void;
  } {
    let state = initial;
    const queue: GameEvent[] = [];
    let processing = false;

    function dispatch(event: GameEvent): void {
      queue.push(event);
      if (processing) return;
      processing = true;
      try {
        while (queue.length) {
          const nextEvent = queue.shift();
          if (!nextEvent) continue;
          const previous = state;
          const transition = update(state, nextEvent);
          state = transition.state;
          render(previous, state);
          for (const command of transition.commands) runCommand(command);
        }
      } finally {
        processing = false;
      }
    }

    return { getState: () => state, dispatch };
  }

  const store = createStore(initialState);
  getState = store.getState;
  dispatchEvent = store.dispatch;

  function openDiscoveryDialog(): void {
    const state = getState();
    if (state.session.phase !== "idle" || state.appStatus === "loading" || state.appStatus === "error") return;
    renderDiscovery(state);
    if (!dom.discoveryDialog.open) dom.discoveryDialog.showModal();
    queueMicrotask(() => dom.discoveryClose.focus());
  }

  function dismissResult(): void {
    if (dom.resultDialog.open) dom.resultDialog.close();
    dispatchEvent({ type: "RESULT_DISMISSED" });
  }

  for (const [mode, button] of dom.modeButtons) {
    button.addEventListener("click", () => dispatchEvent({ type: "MODE_SELECTED", mode }), { signal: lifecycle.signal });
  }
  dom.play.addEventListener("click", () => dispatchEvent({ type: "PLAY_PRESSED" }), { signal: lifecycle.signal });
  dom.skip.addEventListener("click", () => dispatchEvent({ type: "ATTEMPT_REQUESTED", trackId: null }), { signal: lifecycle.signal });
  dom.discoveryButton.addEventListener("click", openDiscoveryDialog, { signal: lifecycle.signal });
  dom.discoveryClose.addEventListener("click", () => dom.discoveryDialog.close(), { signal: lifecycle.signal });
  dom.discoveryReset.addEventListener("click", () => {
    if (!window.confirm("RESET DISCOVERY? THIS HIDES ALL DISCOVERED TRACKS.")) return;
    dispatchEvent({ type: "DISCOVERY_RESET" });
  }, { signal: lifecycle.signal });
  dom.discoveryDialog.addEventListener("click", (event) => {
    if (event.target === dom.discoveryDialog) dom.discoveryDialog.close();
  }, { signal: lifecycle.signal });
  dom.resultNext.addEventListener("click", dismissResult, { signal: lifecycle.signal });
  dom.resultSpotify.addEventListener("click", () => {
    const state = getState();
    if (state.session.phase !== "result" || !state.session.result.spotifyId) return;
    window.open(
      `https://open.spotify.com/track/${state.session.result.spotifyId}`,
      "_blank",
      "noopener,noreferrer",
    );
  }, { signal: lifecycle.signal });
  dom.resultDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dismissResult();
  }, { signal: lifecycle.signal });

  appRoot.addEventListener("keydown", () => {
    interactionModality = "keyboard";
  }, { capture: true, signal: lifecycle.signal });
  appRoot.addEventListener("pointerdown", (event) => {
    interactionModality = event.pointerType === "mouse" && matchMedia("(pointer: fine)").matches
      ? "fine-pointer"
      : "coarse-pointer";
  }, { capture: true, signal: lifecycle.signal });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) return;
    const state = getState();
    if (state.session.phase === "active" && state.session.transport !== "paused") {
      dispatchEvent({ type: "PLAY_PRESSED" });
    } else if (state.session.phase === "preparing" && state.session.round && audioService.isPlayRequested()) {
      audioService.pauseActive();
      dispatchEvent({ type: "AUDIO_PLAY_BLOCKED", roundId: state.session.round.id });
    }
  }, { signal: lifecycle.signal });

  let catalogLoading = false;
  let catalogRequestId = 0;
  let catalogRetryTimer = 0;

  async function loadCatalog(): Promise<void> {
    if (catalogLoading) return;
    catalogLoading = true;
    const requestId = ++catalogRequestId;
    if (catalogRetryTimer) clearTimeout(catalogRetryTimer);
    catalogRetryTimer = 0;
    try {
      const response = await fetch(tracksUrl, {
        headers: { Accept: "application/json" },
        cache: "no-cache",
      });
      if (!response.ok) throw new Error(`Track catalog returned HTTP ${response.status}.`);
      const tracks = validateTracks(await response.json());
      if (requestId !== catalogRequestId) return;
      const profile = loadProfile(tracks);
      dispatchEvent({ type: "CATALOG_READY", tracks, profile, today: getDailyDate() });
    } catch (error: unknown) {
      if (requestId !== catalogRequestId) return;
      const message = error instanceof Error ? error.message : "Unknown track catalog error.";
      console.error("Corzaguessr could not load its track catalog.", error);
      dispatchEvent({ type: "CATALOG_FAILED", message });
      catalogRetryTimer = window.setTimeout(() => {
        void loadCatalog();
      }, 5000);
    } finally {
      if (requestId === catalogRequestId) catalogLoading = false;
    }
  }

  dom.retryCatalog.addEventListener("click", () => {
    void loadCatalog();
  }, { signal: lifecycle.signal });
  window.addEventListener("online", () => {
    if (getState().appStatus === "error") void loadCatalog();
  }, { signal: lifecycle.signal });

  const dateScheduler = createDateScheduler(lifecycle.signal);
  dateScheduler.start();

  function destroy(): void {
    lifecycle.abort();
    dateScheduler.destroy();
    gameClock.destroy();
    audioService.reset();
    cancelAnimationFrame(announcementFrame);
    if (catalogRetryTimer) clearTimeout(catalogRetryTimer);
    appRoot.removeAttribute("data-corzaguessr-ready");
  }

  (appRoot as HTMLElement & { corzaguessrDestroy?: () => void }).corzaguessrDestroy = destroy;

  render(initialState, initialState);
  renderDiscovery(initialState);
  renderClockVisual(gameClock.snapshot());
  void loadCatalog();
})();
