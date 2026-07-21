export type GameMode = "daily" | "blitz" | "classic" | "survival";
export type SessionPhase =
  | "idle"
  | "preparing"
  | "playing"
  | "paused"
  | "retry"
  | "result";
export type AttemptOutcome = "correct" | "wrong" | "skip";

export interface Track {
  readonly title: string;
  readonly duration: number;
  readonly spotify: string;
  readonly dailyNumber: number;
  readonly dailyFrom: string;
  readonly isNew: boolean;
}

export interface Round {
  readonly id: number;
  readonly track: Track;
  readonly clipStart: number;
  hasPlayed: boolean;
}

export interface AttemptSlot {
  readonly id: number;
  readonly text: string;
  readonly tone: string;
}

export interface ClockSnapshot {
  readonly kind: "classic" | "blitz" | "survival";
  readonly running: boolean;
  readonly elapsedMs: number;
  readonly remainingMs: number;
  readonly limitMs: number;
  readonly maxRemainingMs: number;
  readonly expired: boolean;
}

export interface DailyProgress {
  date: string;
  dailyNumber: number | null;
  started: boolean;
  completed: boolean;
  won: boolean;
  step: number;
}

export interface ScoreBest {
  score: number;
  accuracy: number | null;
}

export interface PersonalBests {
  classic: {
    current: number;
    best: number;
    snippetTotal: number;
    bestSnippetTotal: number;
  };
  daily: number;
  blitz: ScoreBest;
  survival: ScoreBest;
}

export interface ClassicResult {
  mode: "classic";
  won: boolean;
  trackTitle: string;
  spotify: string;
  newPersonalBest: boolean;
  streak: number;
  average: number;
  bestStreak: number;
  bestAverage: number;
}

export interface DailyResult {
  mode: "daily";
  won: boolean;
  trackTitle: string;
  spotify: string;
  newPersonalBest: boolean;
  attempts: number;
  bestAttempts: number;
}

export interface BlitzResult {
  mode: "blitz";
  newPersonalBest: boolean;
  correct: number;
  accuracy: number;
  bestCorrect: number;
  bestAccuracy: number | null;
}

export interface SurvivalResult {
  mode: "survival";
  newPersonalBest: boolean;
  elapsedMs: number;
  accuracy: number;
  bestElapsedMs: number;
  bestAccuracy: number | null;
}

export type GameResult = ClassicResult | DailyResult | BlitzResult | SurvivalResult;

export interface SessionSnapshot {
  readonly mode: GameMode | null;
  readonly phase: SessionPhase;
  readonly round: Round | null;
  readonly attempt: number;
  readonly roundNumber: number;
  readonly guesses: number;
  readonly correct: number;
  readonly currentSlot: AttemptSlot | null;
  readonly history: readonly AttemptSlot[];
  readonly previousTrackId: number | null;
  readonly failedTrackIds: ReadonlySet<number>;
  readonly guessedTrackIds: ReadonlySet<number>;
  readonly result: GameResult | null;
  readonly playbackRequested: boolean;
}

export interface GameViewModel {
  readonly appStatus: "loading" | "error" | "awaiting-mode" | "ready";
  readonly mode: GameMode | null;
  readonly phase: SessionPhase;
  readonly rulesText: string;
  readonly inputVisible: boolean;
  readonly playEnabled: boolean;
  readonly attemptControlsEnabled: boolean;
  readonly playbackIcon: "play" | "pause" | "stop";
  readonly snippetSeconds: number;
  readonly skipText: string;
  readonly currentSlot: AttemptSlot | null;
  readonly history: readonly AttemptSlot[];
  readonly clock: ClockSnapshot;
  readonly result: GameResult | null;
  readonly dailyProgress: DailyProgress;
  readonly dailyDate: string;
  readonly discoveries: ReadonlySet<number>;
  readonly tracks: readonly Track[];
  readonly overlay: "result" | "discovery" | null;
}
