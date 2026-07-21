import {
  accuracy,
  skipLabel,
  snippetSeconds,
  survivalAdjustment,
} from "../../src/domain/mode-rules";

describe("mode rules", () => {
  it("keeps the six-try reveal schedule", () => {
    expect([0, 1, 2, 3, 4, 5].map(snippetSeconds)).toEqual([1, 2, 4, 8, 16, 32]);
    expect(skipLabel("classic", 0)).toBe("ADD 1S");
    expect(skipLabel("daily", 5)).toBe("GIVE UP");
  });

  it("uses the established timed adjustments and accuracy", () => {
    expect(survivalAdjustment("correct")).toBe(3_000);
    expect(survivalAdjustment("wrong")).toBe(-1_000);
    expect(survivalAdjustment("skip")).toBe(-2_000);
    expect(accuracy(2, 3)).toBe(67);
    expect(accuracy(0, 0)).toBe(0);
  });
});
