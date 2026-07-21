import { expect, test, type Page } from "@playwright/test";

async function installDeterministicMedia(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Math.random = () => 0;
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 1 });
    Object.defineProperty(HTMLMediaElement.prototype, "duration", { configurable: true, get: () => 300 });
    Object.defineProperty(HTMLMediaElement.prototype, "error", { configurable: true, get: () => null });
    Object.defineProperty(HTMLMediaElement.prototype, "load", {
      configurable: true,
      value: function load() {},
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: function pause() {},
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: function play(this: HTMLMediaElement) {
        setTimeout(() => this.dispatchEvent(new Event("playing")), 0);
        return Promise.resolve();
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "addEventListener", {
      configurable: true,
      value: function addEventListener(
        this: HTMLMediaElement,
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) {
        if (type === "error") return;
        EventTarget.prototype.addEventListener.call(this, type, listener, options);
      },
    });
  });
}

test.beforeEach(async ({ page }) => {
  await installDeterministicMedia(page);
  await page.goto("/");
  await expect(page.locator("#corzaguessr")).toHaveAttribute("data-app-status", "awaiting-mode");
});

test("classic keeps reveal progression and reaches the correct result", async ({ page }) => {
  await page.getByRole("button", { name: "CLASSIC" }).click();
  await page.getByRole("button", { name: "PLAY" }).click();
  const guess = page.getByRole("combobox", { name: "SEARCH FOR A TRACK" });
  await expect(guess).toBeEnabled();

  await expect(page.getByRole("button", { name: "ADD 1S" })).toBeEnabled();
  await page.getByRole("button", { name: "ADD 1S" }).click();
  await expect(page.locator(".slots .slot").first()).toHaveText("GUESS 1 SKIPPED, 1 SECOND ADDED");
  await expect(page.getByRole("button", { name: "ADD 2S" })).toBeEnabled();

  await guess.fill("Boogie Bros");
  await guess.press("Enter");
  await expect(page.locator("#corzaguessr-result-title")).toContainText("YOU GOT IT");
  await expect(page.locator("#corzaguessr-result-meta")).toContainText("Boogie Bros");
});

test("blitz performs a seamless skip handoff", async ({ page }) => {
  await page.getByRole("button", { name: "BLITZ" }).click();
  await page.getByRole("button", { name: "PLAY" }).click();
  await expect(page.getByRole("button", { name: "SKIP" })).toBeEnabled();
  await page.getByRole("button", { name: "SKIP" }).click();
  await expect(page.locator(".slots .slot").first()).toHaveText("SKIPPED");
  await expect(page.locator(".current-slot")).toHaveText("GUESS #2");
  await expect(page.getByRole("combobox", { name: "SEARCH FOR A TRACK" })).toBeEnabled();
});

test("survival applies the established wrong-guess penalty", async ({ page }) => {
  await page.getByRole("button", { name: "SURVIVAL" }).click();
  await page.getByRole("button", { name: "PLAY" }).click();
  const guess = page.getByRole("combobox", { name: "SEARCH FOR A TRACK" });
  await guess.fill("DJ Lawless");
  await guess.press("Enter");
  await expect(page.locator(".slots .slot").first()).toContainText("DJ Lawless");
  await expect(page.locator(".current-slot")).toHaveText("GUESS #2");
});

test("daily attempt progress survives a reload", async ({ page }) => {
  await page.getByRole("button", { name: "DAILY" }).click();
  await page.getByRole("button", { name: "PLAY" }).click();
  await expect(page.getByRole("button", { name: "ADD 1S" })).toBeEnabled();
  await page.getByRole("button", { name: "ADD 1S" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("corzaguessrDaily") ?? "null")?.step)).toBe(1);

  await page.reload();
  await expect(page.locator("#corzaguessr")).toHaveAttribute("data-app-status", "awaiting-mode");
  await page.getByRole("button", { name: "DAILY" }).click();
  await expect(page.locator(".ruleset-text")).toContainText("DAILY IN PROGRESS, CONTINUE FROM ATTEMPT 2");
});

test("discovery reads the existing localStorage contract", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("corzaguessrDiscovered", "[1]"));
  await page.reload();
  await page.getByRole("button", { name: "DISCOVERY" }).click();
  await expect(page.locator(".discovery-title small")).toHaveText("1 / 51 (2%)");
  await expect(page.locator(".discovery-item").filter({ hasText: "Boogie Bros" })).toHaveCount(1);
});
