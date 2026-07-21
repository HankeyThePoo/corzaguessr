import { GameSession } from "../../src/domain/game-session";
import type { Round, Track } from "../../src/domain/types";

const track: Track = {
  title: "Test Track", duration: 120, spotify: "", dailyNumber: 1,
  dailyFrom: "1970-01-01", isNew: false,
};
const round: Round = { id: 1, track, clipStart: 10, hasPlayed: false };

describe("GameSession", () => {
  it("owns six-try state and archives attempts newest-first", () => {
    const session = new GameSession();
    session.reset("classic");
    session.beginPreparing(round);
    session.beginPlaying(round);
    expect(session.resolveSixTry("wrong", "Wrong Track").finished).toBe(false);
    expect(session.snapshot.attempt).toBe(1);
    expect(session.snapshot.history[0]).toMatchObject({ text: "Wrong Track", tone: "wrong" });
  });

  it("owns timed score counters and history limits", () => {
    const session = new GameSession();
    session.reset("blitz");
    for (let index = 0; index < 21; index += 1) {
      const next = { ...round, id: index + 1, hasPlayed: false };
      session.beginPreparing(next);
      session.beginPlaying(next);
      session.resolveTimed(index % 2 ? "wrong" : "correct", `Guess ${index}`);
    }
    expect(session.snapshot.history).toHaveLength(19);
    expect(session.snapshot.guesses).toBe(21);
    expect(session.snapshot.correct).toBe(11);
  });
});
