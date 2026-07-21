export type ModalKind = "result" | "discovery";

export interface ModalElements {
  card: HTMLElement;
  result: HTMLElement;
  next: HTMLButtonElement;
  discoveryModal: HTMLElement;
  discoveryShell: HTMLElement;
  discoveryPanel: HTMLElement;
  discoveryButton: HTMLButtonElement;
  discoveryClose: HTMLButtonElement;
  resultMeta: HTMLElement;
}

export class ModalController {
  private kind: ModalKind | null = null;
  private closing = false;
  private returnFocus: HTMLElement | null = null;
  private closeTimer = 0;
  private openFrame = 0;
  private transitionGeneration = 0;
  private lockedScroll: { htmlOverflow: string; htmlScrollbarGutter: string; bodyOverflow: string } | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly elements: ModalElements,
    private readonly durations: { result: number; discovery: number },
    private readonly reducedMotion: MediaQueryList,
    private readonly announce: (message: string) => void,
  ) {}

  get openKind(): ModalKind | null {
    return this.kind;
  }

  get discoveryLayoutActive(): boolean {
    return this.kind === "discovery" && !this.closing;
  }

  openResult(): void {
    if (this.kind) return;
    const generation = this.beginOpen();
    this.kind = "result";
    this.closing = false;
    this.captureReturnFocus();
    this.lockScroll();
    this.elements.card.classList.add("modal-open");
    this.elements.result.setAttribute("aria-hidden", "false");
    this.openFrame = requestAnimationFrame(() => {
      this.openFrame = 0;
      if (!this.transitionMatches("result", generation)) return;
      this.elements.card.classList.add("modal-visible");
      this.elements.next.focus({ preventScroll: true });
      this.announce(this.elements.resultMeta.dataset.announcement || "RESULT");
    });
  }

  openDiscovery(): void {
    if (this.kind) return;
    const generation = this.beginOpen();
    this.kind = "discovery";
    this.closing = false;
    this.captureReturnFocus();
    this.lockScroll();
    this.root.classList.add("discovery-open");
    this.elements.discoveryModal.setAttribute("aria-hidden", "false");
    this.elements.discoveryButton.setAttribute("aria-expanded", "true");
    this.elements.discoveryShell.style.height = "0px";
    void this.elements.discoveryShell.offsetHeight;
    this.openFrame = requestAnimationFrame(() => {
      this.openFrame = 0;
      if (!this.transitionMatches("discovery", generation)) return;
      this.root.classList.add("discovery-visible");
      this.elements.discoveryShell.style.height = `${this.elements.discoveryPanel.offsetHeight}px`;
      this.elements.discoveryClose.focus({ preventScroll: true });
    });
  }

  close(
    kind: ModalKind,
    fallbackFocus: HTMLElement,
    onStart: () => void,
    onClosed: () => void,
  ): void {
    if (this.closing || this.kind !== kind) return;
    this.closing = true;
    const generation = ++this.transitionGeneration;
    cancelAnimationFrame(this.openFrame);
    this.openFrame = 0;
    clearTimeout(this.closeTimer);
    if (kind === "result") {
      this.elements.card.classList.add("modal-closing");
      this.elements.card.classList.remove("modal-visible");
    } else {
      this.root.classList.remove("discovery-visible");
      this.elements.discoveryShell.style.height = `${this.elements.discoveryShell.offsetHeight}px`;
      void this.elements.discoveryShell.offsetHeight;
      this.elements.discoveryShell.style.height = "0px";
      this.elements.discoveryButton.setAttribute("aria-expanded", "false");
    }
    onStart();
    const duration = this.reducedMotion.matches
      ? 0
      : kind === "result"
        ? this.durations.result
        : this.durations.discovery;
    this.closeTimer = window.setTimeout(() => {
      this.closeTimer = 0;
      if (this.kind !== kind || this.transitionGeneration !== generation) return;
      if (kind === "result") {
        this.elements.card.classList.remove("modal-open", "modal-visible", "modal-closing");
        this.elements.result.setAttribute("aria-hidden", "true");
      } else {
        this.root.classList.remove("discovery-open", "discovery-visible");
        this.elements.discoveryModal.setAttribute("aria-hidden", "true");
        this.elements.discoveryShell.style.height = "";
      }
      this.kind = null;
      this.closing = false;
      this.unlockScroll();
      onClosed();
      const preferred = this.returnFocus;
      this.returnFocus = null;
      const target = preferred && this.canFocus(preferred) ? preferred : fallbackFocus;
      if (this.canFocus(target)) target.focus({ preventScroll: true });
    }, duration);
  }

  trapFocus(event: KeyboardEvent): void {
    if (event.key !== "Tab" || !this.kind) return;
    const container = this.kind === "result" ? this.elements.result : this.elements.discoveryPanel;
    const focusable = [...container.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])")]
      .filter((element) => !element.hidden && element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (!container.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private captureReturnFocus(): void {
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  private lockScroll(): void {
    if (this.lockedScroll) return;
    this.lockedScroll = {
      htmlOverflow: document.documentElement.style.overflow,
      htmlScrollbarGutter: document.documentElement.style.scrollbarGutter,
      bodyOverflow: document.body.style.overflow,
    };
    document.documentElement.style.scrollbarGutter = "stable";
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
  }

  private unlockScroll(): void {
    if (!this.lockedScroll) return;
    document.documentElement.style.overflow = this.lockedScroll.htmlOverflow;
    document.documentElement.style.scrollbarGutter = this.lockedScroll.htmlScrollbarGutter;
    document.body.style.overflow = this.lockedScroll.bodyOverflow;
    this.lockedScroll = null;
  }

  private canFocus(element: HTMLElement): boolean {
    return element.isConnected && !(element instanceof HTMLButtonElement && element.disabled) && !element.hidden && !element.closest("[inert]");
  }

  private beginOpen(): number {
    clearTimeout(this.closeTimer);
    this.closeTimer = 0;
    cancelAnimationFrame(this.openFrame);
    this.openFrame = 0;
    return ++this.transitionGeneration;
  }

  private transitionMatches(kind: ModalKind, generation: number): boolean {
    return this.kind === kind && !this.closing && this.transitionGeneration === generation;
  }
}
