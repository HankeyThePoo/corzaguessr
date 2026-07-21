import catalog from "../../public/tracks.json";
import {
  dailyClipStart,
  isIsoDate,
  selectDailyTrack,
  selectRandomTrack,
  validateTrackCatalog,
} from "../../src/domain/track-catalog";

describe("track catalog", () => {
  it("validates the production catalog", () => {
    const tracks = validateTrackCatalog(catalog);
    expect(tracks).toHaveLength(51);
    expect(tracks[49]?.title).toContain("Loán");
  });

  it("rejects duplicate identifiers and malformed values", () => {
    expect(() => validateTrackCatalog([])).toThrow("empty");
    expect(() => validateTrackCatalog([
      { dailyNumber: 1, dailyFrom: "2026-01-01", title: "A", spotify: "", duration: 20 },
      { dailyNumber: 1, dailyFrom: "2026-01-01", title: "B", spotify: "", duration: 20 },
    ])).toThrow("duplicates dailyNumber");
  });

  it("validates real calendar dates", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2023-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
  });

  it("selects daily tracks and clips deterministically", () => {
    const tracks = validateTrackCatalog(catalog);
    expect(selectDailyTrack(tracks, "2026-07-14", null)).toEqual(
      selectDailyTrack(tracks, "2026-07-14", null),
    );
    const track = tracks[0]!;
    expect(dailyClipStart(track, "2026-07-14")).toBe(dailyClipStart(track, "2026-07-14"));
  });

  it("excludes failed and immediately previous random tracks", () => {
    const tracks = validateTrackCatalog(catalog).slice(0, 3);
    const selected = selectRandomTrack(tracks, new Set([1]), 2, () => 0);
    expect(selected?.dailyNumber).toBe(3);
  });
});
