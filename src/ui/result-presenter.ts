import type { GameResult } from "../domain/types";

export function formatClock(seconds: number): string {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${String(Math.floor(safe) % 60).padStart(2, "0")}`;
}

function formatAccuracy(value: number | null): string {
  return Number.isSafeInteger(value) ? `${value}%` : "--";
}

function formatAttempts(value: number): string {
  return value ? `ATTEMPTS: ${value}` : "ATTEMPTS: --";
}

function formatAverage(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "--";
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}S`;
}

export function resultRows(result: GameResult): string[][] {
  if (result.mode === "daily") {
    return [
      ["TRACK:", result.trackTitle],
      ["RUN:", formatAttempts(result.attempts)],
      [result.newPersonalBest ? "NEW PERSONAL BEST:" : "PERSONAL BEST:", formatAttempts(result.bestAttempts)],
    ];
  }
  if (result.mode === "classic") {
    return [
      ["TRACK:", result.trackTitle],
      ["RUN:", `${result.won ? "STREAK" : "STREAK ENDED"}: ${result.streak} · AVERAGE SNIPPET: ${formatAverage(result.average)}`],
      [result.newPersonalBest ? "NEW PERSONAL BEST:" : "PERSONAL BEST:", `STREAK: ${result.bestStreak} · AVERAGE SNIPPET: ${formatAverage(result.bestAverage)}`],
    ];
  }
  if (result.mode === "blitz") {
    return [
      ["RUN:", `CORRECT GUESSES: ${result.correct} · ACCURACY: ${formatAccuracy(result.accuracy)}`],
      [result.newPersonalBest ? "NEW PERSONAL BEST:" : "PERSONAL BEST:", `CORRECT GUESSES: ${result.bestCorrect} · ACCURACY: ${formatAccuracy(result.bestAccuracy)}`],
    ];
  }
  return [
    ["RUN:", `TIME SURVIVED: ${formatClock(result.elapsedMs / 1_000)} · ACCURACY: ${formatAccuracy(result.accuracy)}`],
    [result.newPersonalBest ? "NEW PERSONAL BEST:" : "PERSONAL BEST:", `TIME SURVIVED: ${formatClock(result.bestElapsedMs / 1_000)} · ACCURACY: ${formatAccuracy(result.bestAccuracy)}`],
  ];
}

export function resultAnnouncement(result: GameResult, rows = resultRows(result)): string {
  const title = result.mode === "blitz" || result.mode === "survival"
    ? "TIME IS UP."
    : result.won
      ? "YOU GOT IT."
      : "YOU GOT IT ALL WRONG.";
  const details = rows
    .map((row) => `${row[0]?.replace(/:$/, "") ?? "RESULT"}. ${row.slice(1).join(". ")}`.trim())
    .join(". ");
  return `${title} ${details}`.trim();
}

export function createResultModule(row: readonly string[], newPersonalBest: boolean): HTMLElement {
  const module = document.createElement("div");
  module.className = "result-module";
  module.replaceChildren(...row.map((value, index) => {
    const span = document.createElement("span");
    span.className = index ? "result-value" : "result-label";
    if (!index && newPersonalBest && value === "NEW PERSONAL BEST:") span.classList.add("blink");
    span.textContent = value;
    return span;
  }));
  return module;
}
