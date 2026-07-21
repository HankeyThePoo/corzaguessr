import type { Track } from "../domain/types";

export class Autocomplete {
  private tracks: readonly Track[] = [];
  private unavailable = new Set<number>();
  private suggestions: Track[] = [];
  private selectedIndex = -1;
  private dependencySignature = "";

  constructor(
    private readonly input: HTMLInputElement,
    private readonly list: HTMLElement,
    private readonly onGuess: (dailyNumber: number) => void,
    private readonly onPlaybackShortcut: () => void,
  ) {
    input.addEventListener("input", () => this.update());
    input.addEventListener("keydown", (event) => this.handleKeydown(event));
    list.addEventListener("pointerover", (event) => {
      const option = event.target instanceof Element
        ? event.target.closest<HTMLElement>("[role=option]")
        : null;
      if (!option) return;
      const index = [...this.list.children].indexOf(option);
      if (index >= 0) this.select(index);
    });
    list.addEventListener("click", (event) => {
      const option = event.target instanceof Element
        ? event.target.closest<HTMLElement>("[role=option]")
        : null;
      if (!option) return;
      const track = this.suggestions[[...this.list.children].indexOf(option)];
      if (track) this.onGuess(track.dailyNumber);
    });
  }

  setDependencies(tracks: readonly Track[], unavailable: ReadonlySet<number>): void {
    const signature = JSON.stringify([
      tracks.map((track) => [track.dailyNumber, track.title]),
      [...unavailable].sort((left, right) => left - right),
    ]);
    if (signature === this.dependencySignature) return;
    const selectedId = this.suggestions[this.selectedIndex]?.dailyNumber ?? null;
    this.dependencySignature = signature;
    this.tracks = tracks;
    this.unavailable = new Set(unavailable);
    if (this.input.value.trim()) this.update(selectedId);
  }

  reset(): void {
    this.input.value = "";
    this.suggestions = [];
    this.selectedIndex = -1;
    this.render();
  }

  private update(selectedId: number | null = null): void {
    const query = this.input.value.trim().toLocaleLowerCase();
    this.suggestions = query
      ? this.tracks
          .filter(
            (track) =>
              !this.unavailable.has(track.dailyNumber) &&
              track.title.toLocaleLowerCase().includes(query),
          )
          .slice(0, 8)
      : [];
    const preserved = selectedId === null
      ? -1
      : this.suggestions.findIndex((track) => track.dailyNumber === selectedId);
    this.selectedIndex = preserved >= 0 ? preserved : this.suggestions.length ? 0 : -1;
    this.render();
  }

  private select(index: number): void {
    if (!this.suggestions.length) return;
    this.selectedIndex =
      (index % this.suggestions.length + this.suggestions.length) % this.suggestions.length;
    this.renderSelection();
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      this.reset();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!this.suggestions.length) return;
      event.preventDefault();
      this.select(this.selectedIndex + (event.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!this.input.value.trim()) {
      this.onPlaybackShortcut();
      return;
    }
    const track = this.suggestions[this.selectedIndex];
    if (track) this.onGuess(track.dailyNumber);
  }

  private render(): void {
    const options = this.suggestions.map((track, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.tabIndex = -1;
      option.id = `corzaguessr-option-${index}`;
      option.textContent = track.title;
      option.setAttribute("role", "option");
      const active = index === this.selectedIndex;
      option.setAttribute("aria-selected", String(active));
      if (active) option.className = "active";
      return option;
    });
    this.list.replaceChildren(...options);
    const visible = options.length > 0;
    this.list.style.display = visible ? "block" : "none";
    this.input.setAttribute("aria-expanded", String(visible));
    this.renderSelection();
  }

  private renderSelection(): void {
    [...this.list.children].forEach((element, index) => {
      const option = element as HTMLElement;
      const active = index === this.selectedIndex;
      option.classList.toggle("active", active);
      option.setAttribute("aria-selected", String(active));
    });
    if (this.suggestions.length && this.selectedIndex >= 0) {
      this.input.setAttribute("aria-activedescendant", `corzaguessr-option-${this.selectedIndex}`);
    } else this.input.removeAttribute("aria-activedescendant");
  }
}
