import {
  LocalStorageProgressRepository,
  sanitizeDailyProgress,
  sanitizePersonalBests,
} from "../../src/platform/progress-repository";

describe("progress persistence", () => {
  beforeEach(() => localStorage.clear());

  it("sanitizes invalid legacy values", () => {
    expect(sanitizeDailyProgress({ date: "bad", dailyNumber: -1, started: true })).toMatchObject({ started: false, completed: false });
    expect(sanitizePersonalBests({ classic: { current: 2, snippetTotal: 1000 } }).classic.current).toBe(0);
  });

  it("retains the existing storage keys", () => {
    const repository = new LocalStorageProgressRepository(localStorage);
    repository.saveDiscoveries(new Set([3, 1]));
    expect(localStorage.getItem("corzaguessrDiscovered")).toBe("[1,3]");
  });
});
