import { GameClock, type AnimationScheduler } from "../../src/platform/game-clock";

class FakeScheduler implements AnimationScheduler {
  frame: FrameRequestCallback | null = null;
  timer: (() => void) | null = null;
  requestFrame(callback: FrameRequestCallback): number { this.frame = callback; return 1; }
  cancelFrame(): void { this.frame = null; }
  setTimer(callback: () => void): number { this.timer = callback; return 2; }
  clearTimer(): void { this.timer = null; }
}

describe("GameClock", () => {
  it("pauses and extends classic snippets without losing elapsed time", () => {
    let now = 0;
    const scheduler = new FakeScheduler();
    const clock = new GameClock({ onTick: vi.fn(), onExpired: vi.fn() }, () => now, scheduler);
    clock.configure({ kind: "classic", initialMs: 1_000, limitMs: 1_000 });
    clock.start();
    now = 400;
    clock.extendClassic(2_000);
    expect(clock.snapshot()).toMatchObject({ elapsedMs: 400, remainingMs: 1_600, running: true });
    now = 700;
    expect(clock.pause()).toMatchObject({ elapsedMs: 700, remainingMs: 1_300, running: false });
  });

  it("applies survival rewards and penalties", () => {
    let now = 0;
    const scheduler = new FakeScheduler();
    const clock = new GameClock({ onTick: vi.fn(), onExpired: vi.fn() }, () => now, scheduler);
    clock.configure({ kind: "survival", initialMs: 30_000 });
    clock.start();
    now = 2_000;
    expect(clock.adjust(3_000).remainingMs).toBe(31_000);
    expect(clock.adjust(-1_000).remainingMs).toBe(30_000);
  });
});
