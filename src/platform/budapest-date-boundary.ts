export function budapestDate(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export class BudapestDateBoundary {
  private timer = 0;
  private currentDate = "";
  private active = false;

  constructor(private readonly onDateChanged: (date: string) => void) {}

  current(): string {
    const date = budapestDate();
    if (!this.currentDate) this.currentDate = date;
    return date;
  }

  start(): string {
    this.active = true;
    this.currentDate = budapestDate();
    this.scheduleNextBoundary();
    return this.currentDate;
  }

  reconcile(): string {
    const date = budapestDate();
    if (date !== this.currentDate) {
      this.currentDate = date;
      this.onDateChanged(date);
    }
    if (this.active) this.scheduleNextBoundary();
    return date;
  }

  stop(): void {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = 0;
  }

  private scheduleNextBoundary(): void {
    if (!this.active) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = 0;
    const now = Date.now();
    const today = budapestDate(new Date(now));
    let lower = now;
    let upper = now + 1_800 * 60 * 1_000;
    while (budapestDate(new Date(upper)) === today) upper += 360 * 60 * 1_000;
    while (upper - lower > 1) {
      const middle = Math.floor((lower + upper) / 2);
      if (budapestDate(new Date(middle)) === today) lower = middle;
      else upper = middle;
    }
    this.timer = window.setTimeout(() => this.reconcile(), Math.max(1, upper - now));
  }
}
