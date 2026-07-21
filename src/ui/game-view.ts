import { COPY, isTimedMode, MODE_RULES, SNIPPET_SECONDS } from "../domain/mode-rules";
import type { ClockSnapshot, GameMode, GameViewModel } from "../domain/types";
import { Autocomplete } from "./autocomplete";
import { ModalController } from "./modal-controller";
import { createResultModule, formatClock, resultAnnouncement, resultRows } from "./result-presenter";

const ICONS = {
  play: "M8 5v14l11-7z",
  pause: "M6 5h4v14H6zM14 5h4v14h-4z",
  stop: "M7 7h10v10H7z",
} as const;

export interface ViewHandlers {
  selectMode(mode: GameMode): void;
  play(): void;
  playbackShortcut(): void;
  skip(): void;
  guess(dailyNumber: number): void;
  newGame(): void;
  openDiscovery(): void;
  closeDiscovery(): void;
  resetDiscovery(): void;
  openSpotify(): void;
}

interface Elements {
  headerAction: HTMLElement; modes: HTMLElement; board: HTMLElement; currentSlot: HTMLElement;
  slots: HTMLElement; card: HTMLElement; play: HTMLButtonElement; skip: HTMLButtonElement;
  guess: HTMLInputElement; suggest: HTMLElement; icon: SVGPathElement; snippet: HTMLElement;
  now: HTMLElement; endtime: HTMLElement; fill: HTMLElement; feedback: HTMLElement;
  timeline: HTMLElement; timeChange: HTMLElement; timeChangeText: HTMLElement; ruleset: HTMLElement;
  rulesetText: HTMLElement; rulesetCopy: HTMLElement; modePrompt: HTMLElement; status: HTMLElement;
  next: HTMLButtonElement; spotify: HTMLButtonElement; result: HTMLElement; resultTitle: HTMLElement;
  resultMeta: HTMLElement; discoveryButton: HTMLButtonElement; discoveryModal: HTMLElement;
  discoveryShell: HTMLElement; discoveryPanel: HTMLElement; discoveryClose: HTMLButtonElement;
  discoveryReset: HTMLButtonElement; discoveryCount: HTMLElement; discoveryItems: HTMLElement;
  audioPlayers: HTMLAudioElement[];
}

export class GameView {
  readonly audioElements: readonly HTMLAudioElement[];
  readonly modal: ModalController;
  private readonly elements: Elements;
  private readonly modeButtons: Record<GameMode, HTMLButtonElement>;
  private readonly reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  private readonly finePointer = matchMedia("(pointer: fine)");
  private readonly autocomplete: Autocomplete;
  private readonly durations: { slot: number; result: number; discovery: number; progress: number; rewind: number };
  private handlers: ViewHandlers | null = null;
  private state: GameViewModel | null = null;
  private inputModality: "keyboard" | "pointer-fine" | "pointer-coarse";
  private preview: GameMode | "discovery" | null = null;
  private historySessionKey = "";
  private renderedDiscoveries = "";
  private resultSignature = "";
  private rulesSignature = "";
  private historySignature = "";
  private currentSlotSignature = "";
  private announcementFrame = 0;
  private slotTimer = 0;
  private progressTransitionTimer = 0;

  constructor(private readonly root: HTMLElement) {
    this.inputModality = this.finePointer.matches ? "pointer-fine" : "pointer-coarse";
    root.dataset.corzaguessrReady = "true";
    root.innerHTML = markup();
    this.elements = this.queryElements();
    this.audioElements = this.elements.audioPlayers;
    this.modeButtons = {
      daily: this.required('[data-mode="daily"]'),
      blitz: this.required('[data-mode="blitz"]'),
      classic: this.required('[data-mode="classic"]'),
      survival: this.required('[data-mode="survival"]'),
    };
    const styles = getComputedStyle(root);
    this.durations = {
      slot: duration(styles, "--duration-slot"), result: duration(styles, "--duration-result"),
      discovery: duration(styles, "--duration-discovery"), progress: duration(styles, "--duration-progress"),
      rewind: duration(styles, "--duration-rewind"),
    };
    this.modal = new ModalController(root, this.elements, this.durations, this.reducedMotion, (message) => this.announce(message));
    this.autocomplete = new Autocomplete(this.elements.guess, this.elements.suggest, (id) => this.handlers?.guess(id), () => this.handlers?.playbackShortcut());
    this.elements.timeChangeText.addEventListener("animationend", (event) => {
      if (event.animationName === "corzaguessr-survival-hit") this.clearSurvivalFeedback();
    });
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => {
        if (this.modal.discoveryLayoutActive) this.elements.discoveryShell.style.height = `${this.elements.discoveryPanel.offsetHeight}px`;
      }).observe(this.elements.discoveryPanel);
    }
  }

  bind(handlers: ViewHandlers): void {
    this.handlers = handlers;
    this.elements.play.addEventListener("click", handlers.play);
    this.elements.skip.addEventListener("click", handlers.skip);
    this.elements.next.addEventListener("click", handlers.newGame);
    this.elements.spotify.addEventListener("click", handlers.openSpotify);
    this.elements.discoveryButton.addEventListener("click", handlers.openDiscovery);
    this.elements.discoveryClose.addEventListener("click", handlers.closeDiscovery);
    this.elements.discoveryReset.addEventListener("click", () => {
      if (window.confirm("RESET DISCOVERY? THIS HIDES ALL DISCOVERED TRACKS.")) handlers.resetDiscovery();
    });
    this.elements.discoveryModal.addEventListener("click", (event) => {
      if (!(event.target instanceof Element && event.target.closest(".discovery-panel"))) handlers.closeDiscovery();
    });
    for (const [mode, button] of Object.entries(this.modeButtons) as [GameMode, HTMLButtonElement][]) {
      button.addEventListener("click", () => handlers.selectMode(mode));
      this.bindPreview(button, mode);
    }
    this.bindPreview(this.elements.discoveryButton, "discovery");
    this.root.addEventListener("keydown", (event) => this.handleRootKeydown(event), true);
    this.root.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
  }

  render(state: GameViewModel, sessionKey: string, guessed: ReadonlySet<number>): void {
    this.state = state;
    this.root.dataset.appStatus = state.appStatus;
    this.root.dataset.sessionStatus = state.phase;
    this.root.classList.toggle("rules-visible", !state.inputVisible);
    this.root.classList.toggle("timed", isTimedMode(state.mode));
    const awaiting = state.appStatus === "awaiting-mode";
    this.elements.modePrompt.setAttribute("aria-hidden", String(!awaiting));
    this.elements.play.disabled = !state.playEnabled;
    this.elements.skip.disabled = !state.attemptControlsEnabled;
    this.elements.guess.disabled = !state.attemptControlsEnabled;
    const blockedBoard = awaiting || state.appStatus === "loading";
    const overlay = state.overlay !== null;
    this.elements.headerAction.inert = overlay;
    this.elements.modes.inert = overlay;
    this.elements.board.inert = overlay || blockedBoard;
    this.elements.currentSlot.inert = overlay || blockedBoard;
    this.elements.slots.inert = overlay || blockedBoard;
    for (const [mode, button] of Object.entries(this.modeButtons) as [GameMode, HTMLButtonElement][]) {
      const selected = mode === state.mode;
      button.disabled = state.appStatus === "error" || selected || state.overlay === "discovery";
      button.setAttribute("aria-pressed", String(selected));
    }
    this.elements.icon.setAttribute("d", ICONS[state.playbackIcon]);
    this.elements.play.setAttribute("aria-label", state.playbackIcon === "play" ? "PLAY" : state.playbackIcon === "pause" ? "PAUSE" : "STOP");
    this.elements.skip.textContent = state.skipText;
    this.elements.snippet.style.width = `${(state.snippetSeconds / SNIPPET_SECONDS.at(-1)!) * 100}%`;
    this.renderRules();
    this.renderCurrentSlot(state.currentSlot);
    this.renderHistory(state.history, sessionKey);
    this.autocomplete.setDependencies(state.tracks, guessed);
    this.renderDiscovery(state);
    this.renderResult(state.result);
    this.renderClock(state.clock);
  }

  renderClock(clock: ClockSnapshot): void {
    const state = this.state;
    if (!state) return;
    const mode = state.mode;
    let display = "0:00";
    let progress = 0;
    if (!mode) this.elements.endtime.textContent = "0:01";
    else if (isTimedMode(mode)) {
      const survival = mode === "survival";
      const initial = MODE_RULES[mode].initialTimeMs;
      this.elements.endtime.textContent = formatClock((survival ? Math.ceil(clock.remainingMs / 1_000) : initial / 1_000));
      const seconds = (survival ? clock.elapsedMs : clock.remainingMs) / 1_000;
      display = formatClock(seconds);
      const denominator = survival ? clock.maxRemainingMs : initial;
      progress = denominator ? clock.remainingMs / denominator : 0;
    } else {
      const seconds = mode === "daily" && !state.inputVisible && state.dailyProgress.date === state.dailyDate && state.dailyProgress.started
        ? state.snippetSeconds
        : clock.elapsedMs / 1_000;
      this.elements.endtime.textContent = `0:${String(state.snippetSeconds).padStart(2, "0")}`;
      display = formatClock(seconds);
      progress = seconds ? seconds / SNIPPET_SECONDS.at(-1)! + 0.0025 : 0;
    }
    this.setProgress(display, progress);
  }

  announce(message: string): void {
    cancelAnimationFrame(this.announcementFrame);
    this.announcementFrame = 0;
    this.elements.status.textContent = "";
    if (message) this.announcementFrame = requestAnimationFrame(() => {
      this.announcementFrame = 0;
      this.elements.status.textContent = message;
    });
  }

  flashSurvivalChange(seconds: number): void {
    if (!seconds) return;
    const tone = seconds > 0 ? "survival-reward" : "survival-penalty";
    this.clearSurvivalFeedback();
    this.elements.timeChangeText.textContent = seconds > 0 ? `+${seconds}S` : `${seconds}S`;
    void this.elements.feedback.offsetWidth;
    this.elements.feedback.classList.add(tone);
    this.elements.timeChange.classList.add("survival-change");
    if (this.reducedMotion.matches) this.clearSurvivalFeedback();
  }

  beginProgressReset(animate = false): void {
    clearTimeout(this.progressTransitionTimer);
    this.progressTransitionTimer = 0;
    this.elements.timeline.classList.remove("progress-rewinding");
    this.elements.now.textContent = "0:00";
    this.elements.fill.style.transform = "scaleX(0)";
    this.elements.feedback.style.transform = "scaleX(0)";
    if (animate && !this.reducedMotion.matches) {
      this.elements.timeline.classList.add("progress-rewinding");
      this.progressTransitionTimer = window.setTimeout(() => this.elements.timeline.classList.remove("progress-rewinding"), this.durations.rewind);
    }
  }

  resetTransientUi(): void {
    cancelAnimationFrame(this.announcementFrame);
    this.elements.status.textContent = "";
    this.clearSurvivalFeedback();
    this.preview = null;
    this.autocomplete.reset();
    this.renderRules();
  }

  focusPlay(): void { if (!this.elements.play.disabled && !this.elements.play.closest("[inert]")) this.elements.play.focus({ preventScroll: true }); }
  focusMode(mode: GameMode): void { const button = this.modeButtons[mode]; if (!button.disabled && !button.closest("[inert]")) button.focus({ preventScroll: true }); }
  focusGuess(): void { if (this.inputModality !== "pointer-coarse" && !this.elements.guess.disabled && !this.elements.guess.closest("[inert]")) queueMicrotask(() => this.elements.guess.focus({ preventScroll: true })); }
  get discoveryButton(): HTMLButtonElement { return this.elements.discoveryButton; }
  get playButton(): HTMLButtonElement { return this.elements.play; }

  private renderRules(): void {
    if (!this.state) return;
    const text = !this.preview || this.preview === this.state.mode
      ? this.state.rulesText
      : this.preview === "discovery" ? COPY.discovery : MODE_RULES[this.preview].description;
    const scroll = !this.reducedMotion.matches && !this.state.inputVisible;
    const signature = JSON.stringify([text, scroll]);
    if (signature === this.rulesSignature) return;
    this.rulesSignature = signature;
    this.elements.modePrompt.textContent = text;
    this.elements.rulesetText.textContent = text;
    this.elements.rulesetCopy.textContent = text;
    this.elements.ruleset.classList.remove("scroll");
    if (scroll) { void this.elements.ruleset.offsetWidth; this.elements.ruleset.classList.add("scroll"); }
  }

  private renderHistory(history: readonly { id: number; text: string; tone: string }[], sessionKey: string): void {
    const signature = JSON.stringify([sessionKey, history.map((slot) => [slot.id, slot.text, slot.tone])]);
    if (signature === this.historySignature) return;
    this.historySignature = signature;
    this.historySessionKey = sessionKey;
    clearTimeout(this.slotTimer);
    this.elements.slots.replaceChildren(...history.map((slot) => {
      const element = document.createElement("div");
      element.className = `slot ${slot.tone}`.trim();
      element.dataset.historyId = String(slot.id);
      element.dataset.tone = slot.tone;
      element.textContent = slot.text;
      return element;
    }));
  }

  private renderCurrentSlot(slot: { text: string; tone: string } | null): void {
    const signature = slot ? `${slot.text}|${slot.tone}` : "";
    if (signature === this.currentSlotSignature) return;
    this.currentSlotSignature = signature;
    const element = this.elements.currentSlot;
    const previousTone = element.dataset.tone ?? "";
    if (previousTone) element.classList.remove(...previousTone.split(/\s+/));
    if (!slot) { element.dataset.tone = ""; element.textContent = ""; element.hidden = true; return; }
    if (slot.tone) element.classList.add(...slot.tone.split(/\s+/));
    element.dataset.tone = slot.tone;
    element.textContent = slot.text;
    element.hidden = false;
  }

  private renderDiscovery(state: GameViewModel): void {
    const signature = `${state.tracks.map((track) => `${track.dailyNumber}:${track.isNew}`).join(",")}|${[...state.discoveries].sort((a, b) => a - b).join(",")}`;
    if (signature === this.renderedDiscoveries) return;
    this.renderedDiscoveries = signature;
    const tracks = [...state.tracks].sort((a, b) => b.dailyNumber - a.dailyNumber);
    const discovered = tracks.reduce((count, track) => count + Number(state.discoveries.has(track.dailyNumber)), 0);
    this.elements.discoveryCount.textContent = `${discovered} / ${tracks.length} (${tracks.length ? Math.round(discovered * 100 / tracks.length) : 0}%)`;
    this.elements.discoveryItems.replaceChildren(...tracks.map((track) => {
      const known = state.discoveries.has(track.dailyNumber);
      const item = document.createElement("div"); item.className = "discovery-item"; item.setAttribute("role", "listitem");
      if (track.isNew && !known) {
        item.classList.add("discovery-item-new");
        const badge = document.createElement("span"); badge.className = "discovery-new"; badge.textContent = "NEW"; badge.setAttribute("aria-hidden", "true");
        const hidden = document.createElement("span"); hidden.className = "discovery-track"; hidden.textContent = "?".repeat(20);
        item.append(badge, hidden, badge.cloneNode(true)); item.setAttribute("aria-label", "NEW UNDISCOVERED TRACK");
      } else { item.textContent = known ? track.title : "?".repeat(20); if (!known) item.setAttribute("aria-hidden", "true"); }
      return item;
    }));
  }

  private renderResult(result: GameViewModel["result"]): void {
    const signature = result ? JSON.stringify(result) : "";
    if (signature === this.resultSignature) return;
    this.resultSignature = signature;
    if (!result) { this.elements.resultTitle.textContent = ""; this.elements.resultMeta.replaceChildren(); return; }
    const timed = result.mode === "blitz" || result.mode === "survival";
    this.elements.resultTitle.innerHTML = timed
      ? '&#9201;&#65039; <span class="end">TIME IS UP</span> &#9201;&#65039;'
      : `${result.won ? "&#127881;" : "&#10060;"} <span class="end">${result.won ? "YOU GOT IT" : "YOU GOT IT ALL WRONG"}</span> ${result.won ? "&#127881;" : "&#10060;"}`;
    const rows = resultRows(result);
    this.elements.resultMeta.replaceChildren(...rows.map((row) => createResultModule(row, result.newPersonalBest)));
    this.elements.resultMeta.dataset.announcement = resultAnnouncement(result, rows);
    this.elements.spotify.hidden = !(result.mode === "classic" || result.mode === "daily") || !result.spotify;
  }

  private setProgress(text: string, value: number): void {
    const scale = Math.max(0, Math.min(1, Number(value) || 0));
    this.elements.now.textContent = text;
    this.elements.fill.style.transform = `scaleX(${scale})`;
    this.elements.feedback.style.transform = `scaleX(${scale})`;
  }

  private bindPreview(element: HTMLElement, preview: GameMode | "discovery"): void {
    element.addEventListener("pointerenter", () => { if (this.previewAllowed()) { this.preview = preview; this.renderRules(); } });
    element.addEventListener("pointerleave", () => { if (this.preview === preview) { this.preview = null; this.renderRules(); } });
    element.addEventListener("focus", () => { if (this.inputModality === "keyboard" && this.previewAllowed()) { this.preview = preview; this.renderRules(); } });
    element.addEventListener("blur", () => { if (this.preview === preview) { this.preview = null; this.renderRules(); } });
  }

  private previewAllowed(): boolean { return !!this.state && ["awaiting-mode", "ready"].includes(this.state.appStatus) && this.state.overlay === null && !this.state.inputVisible; }
  private handleRootKeydown(event: KeyboardEvent): void {
    if (!this.handlers || !this.state) return; this.inputModality = "keyboard";
    if (this.state.overlay) {
      if (event.key === "Escape") { event.preventDefault(); this.state.overlay === "discovery" ? this.handlers.closeDiscovery() : this.handlers.newGame(); return; }
      if (this.state.overlay === "result" && event.key === "Enter" && document.activeElement !== this.elements.spotify) { event.preventDefault(); this.handlers.newGame(); return; }
      this.modal.trapFocus(event); return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (event.key === "Enter" && this.state.appStatus !== "awaiting-mode" && !target?.closest("button, input, a, .suggest")) { event.preventDefault(); this.handlers.playbackShortcut(); }
  }
  private handlePointerDown(event: PointerEvent): void {
    if (!this.handlers || !this.state) return;
    this.inputModality = event.pointerType === "mouse" && this.finePointer.matches ? "pointer-fine" : "pointer-coarse";
    const target = event.target instanceof Element ? event.target : null;
    if (this.state.attemptControlsEnabled && !this.state.overlay && !target?.closest("button, input, a, .suggest")) this.elements.guess.focus({ preventScroll: true });
  }
  private clearSurvivalFeedback(): void { this.elements.feedback.classList.remove("survival-reward", "survival-penalty"); this.elements.timeChange.classList.remove("survival-change"); this.elements.timeChangeText.textContent = ""; }
  private required<T extends Element>(selector: string): T { const element = this.root.querySelector<T>(selector); if (!element) throw new Error(`Missing Corzaguessr element: ${selector}`); return element; }
  private queryElements(): Elements {
    const audioPlayers = [...this.root.querySelectorAll<HTMLAudioElement>(".audio")]; if (audioPlayers.length !== 2) throw new Error("Corzaguessr requires two audio elements.");
    return {
      headerAction: this.required(".header-action"), modes: this.required(".modes"), board: this.required(".board"), currentSlot: this.required(".current-slot"), slots: this.required(".slots"), card: this.required(".card"),
      play: this.required(".play"), skip: this.required(".skip"), guess: this.required(".guess"), suggest: this.required(".suggest"), icon: this.required(".icon path"), snippet: this.required(".snippet"), now: this.required(".now"), endtime: this.required(".endtime"), fill: this.required(".fill"), feedback: this.required(".feedback"), timeline: this.required(".timeline"), timeChange: this.required(".time-change"), timeChangeText: this.required(".time-change span"), ruleset: this.required(".ruleset"), rulesetText: this.required(".ruleset-text"), rulesetCopy: this.required(".ruleset-copy"), modePrompt: this.required(".mode-prompt"), status: this.required(".status"),
      next: this.required(".next"), spotify: this.required(".spotify"), result: this.required(".result-modal"), resultTitle: this.required("#corzaguessr-result-title"), resultMeta: this.required("#corzaguessr-result-meta"), discoveryButton: this.required(".discovery-button"), discoveryModal: this.required(".discovery-modal"), discoveryShell: this.required(".discovery-shell"), discoveryPanel: this.required(".discovery-panel"), discoveryClose: this.required(".discovery-close"), discoveryReset: this.required(".discovery-reset"), discoveryCount: this.required(".discovery-title small"), discoveryItems: this.required(".discovery-items"), audioPlayers,
    };
  }
}

function duration(styles: CSSStyleDeclaration, name: string): number { const value = styles.getPropertyValue(name).trim(); return value.endsWith("ms") ? Number.parseFloat(value) || 0 : value.endsWith("s") ? (Number.parseFloat(value) || 0) * 1_000 : 0; }

function markup(): string {
  return `<div class="wrap"><h1>CORZAGUESSR&#10022;</h1><div class="row header-action"><button type="button" class="button discovery-button" aria-controls="corzaguessr-discovery" aria-expanded="false">DISCOVERY</button></div><div class="modes" aria-label="GAME MODE"><button type="button" class="mode" data-mode="daily" aria-pressed="false">DAILY</button><button type="button" class="mode" data-mode="blitz" aria-pressed="false">BLITZ</button><button type="button" class="mode" data-mode="classic" aria-pressed="false">CLASSIC</button><button type="button" class="mode" data-mode="survival" aria-pressed="false">SURVIVAL</button></div><div class="card glass"><div class="stack"><div class="board"><div class="controls"><div class="time"><span class="now">0:00</span></div><button type="button" class="play" aria-label="PLAY" disabled><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS.play}"></path></svg></button><div class="time"><span class="endtime">0:01</span></div></div><div class="timeline" aria-hidden="true"><div class="snippet"></div><div class="fill"></div><div class="feedback"></div><div class="time-change"><span></span></div><i class="tick" style="left:3.125%"></i><i class="tick" style="left:6.25%"></i><i class="tick" style="left:12.5%"></i><i class="tick" style="left:25%"></i><i class="tick" style="left:50%"></i><i class="tick" style="left:100%"></i></div><div class="auto"><label class="sr-only" for="corzaguessr-guess">SEARCH FOR A TRACK</label><input id="corzaguessr-guess" class="guess" placeholder="HAVE A GUESS? SEARCH FOR IT HERE!" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="corzaguessr-suggestions" aria-expanded="false" disabled><div class="ruleset" aria-hidden="true"><div class="ruleset-track"><span class="ruleset-text">${COPY.modePrompt}</span><span class="ruleset-copy">${COPY.modePrompt}</span></div></div><div id="corzaguessr-suggestions" class="suggest" role="listbox"></div></div><div class="row"><button type="button" class="button skip" disabled>ADD 1S</button></div></div><div class="history" aria-live="polite" aria-relevant="additions text"><div class="slot current-slot" hidden></div><div class="slots"></div></div></div><div class="result-modal" aria-hidden="true"><div class="result-shell"><div class="corzaguessr-modal glass" role="dialog" aria-modal="true" aria-labelledby="corzaguessr-result-title" aria-describedby="corzaguessr-result-meta" tabindex="-1"><h3 id="corzaguessr-result-title" class="modal-title"></h3><div id="corzaguessr-result-meta" class="result-meta"></div><div class="actions"><button type="button" class="button next">NEW GAME</button><button type="button" class="button spotify">SPOTIFY</button></div></div></div></div><p class="mode-prompt" role="status" aria-hidden="false">${COPY.modePrompt}</p><div id="corzaguessr-discovery" class="discovery-modal" role="dialog" aria-modal="true" aria-labelledby="corzaguessr-discovery-title" aria-hidden="true" tabindex="-1"><div class="discovery-shell"><div class="discovery-panel glass"><h3 id="corzaguessr-discovery-title" class="discovery-title"><span>DISCOVERY</span><small>0 / 0 (0%)</small></h3><div class="discovery-items" role="list"></div><div class="actions"><button type="button" class="button discovery-close">CLOSE</button><button type="button" class="button discovery-reset">RESET</button></div></div></div></div></div></div><p class="sr-only status" aria-live="polite"></p><audio class="audio" preload="metadata" playsinline aria-hidden="true" hidden></audio><audio class="audio" preload="metadata" playsinline aria-hidden="true" hidden></audio>`;
}
