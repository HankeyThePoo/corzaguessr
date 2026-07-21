import "./styles.css";
import { GameController } from "./application/game-controller";
import { ProgressService } from "./application/progress-service";
import { BudapestDateBoundary } from "./platform/budapest-date-boundary";
import { FetchTrackCatalogRepository } from "./platform/catalog-repository";
import { GameClock } from "./platform/game-clock";
import { LocalStorageProgressRepository } from "./platform/progress-repository";
import { DualSlotAudioPlayer } from "./playback/dual-slot-audio-player";
import { PlaybackCoordinator } from "./playback/playback-coordinator";
import { GameView } from "./ui/game-view";

const root = document.querySelector<HTMLElement>("#corzaguessr");

if (root && !root.dataset.corzaguessrReady) {
  const view = new GameView(root);
  const moduleUrl = new URL(import.meta.url);
  const catalogUrl = new URL("tracks.json", moduleUrl);
  catalogUrl.search = moduleUrl.search;

  const catalog = new FetchTrackCatalogRepository(catalogUrl);
  const progress = new ProgressService(new LocalStorageProgressRepository());

  let controller: GameController;
  let playback: PlaybackCoordinator;

  const clock = new GameClock({
    onTick: (snapshot) => controller?.onClockTick(snapshot),
    onExpired: () => controller?.onClockExpired(),
  });

  const audio = new DualSlotAudioPlayer(
    view.audioElements,
    (round) => {
      const url = new URL(
        `${String(round.track.dailyNumber).padStart(2, "0")}.mp3`,
        "https://cdn.jsdelivr.net/gh/HankeyThePoo/corzaguessr@main/tracks/",
      );
      url.hash = `t=${round.clipStart}`;
      return url.href;
    },
    {
      onPlaying: (round) => playback?.handlePlaying(round),
      onWaiting: (round) => playback?.handleWaiting(round),
      onEnded: (round) => playback?.handleEnded(round),
      onBlocked: (round) => playback?.handleBlocked(round),
      onFailure: (failure) => playback?.handleFailure(failure),
    },
  );

  playback = new PlaybackCoordinator(audio, {
    onPending: (round) => controller?.onPending(round),
    onPlaying: (round) => controller?.onAudioPlaying(round),
    onWaiting: (round) => controller?.onAudioWaiting(round),
    onBlocked: (round) => controller?.onAudioBlocked(round),
    onEnded: (round) => controller?.onAudioEnded(round),
    onRetry: (message) => controller?.onAudioRetry(message),
    onLoading: (visible) => controller?.onLoading(visible),
  });

  const dailyBoundary = new BudapestDateBoundary((date) => controller?.handleDateChanged(date));
  controller = new GameController(
    catalog,
    progress,
    clock,
    playback,
    view,
    dailyBoundary,
  );

  view.bind({
    selectMode: (mode) => controller.selectMode(mode),
    play: () => controller.play(),
    playbackShortcut: () => controller.playbackShortcut(),
    skip: () => controller.skip(),
    guess: (dailyNumber) => controller.guess(dailyNumber),
    newGame: () => controller.newGame(),
    openDiscovery: () => controller.openDiscovery(),
    closeDiscovery: () => controller.closeDiscovery(),
    resetDiscovery: () => controller.resetDiscovery(),
    openSpotify: () => controller.openSpotify(),
  });

  controller.bootstrap(dailyBoundary.current());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) controller.handleVisibilityHidden();
    else controller.handleVisibilityVisible();
  });
  window.addEventListener("pageshow", () => controller.handleVisibilityVisible());
}
