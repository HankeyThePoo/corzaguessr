import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const fixtureDirectory = resolve("tests/fixtures/legacy");
const legacyBundle = Buffer.from(
  Array.from({ length: 9 }, (_, index) =>
    readFileSync(resolve(fixtureDirectory, `app.base64.${String(index + 1).padStart(2, "0")}`), "utf8").trim(),
  ).join(""),
  "base64",
).toString("utf8");
const styles = readFileSync(resolve("src/styles.css"), "utf8");
const tracks = readFileSync(resolve("public/tracks.json"), "utf8");

async function contractSnapshot(page: Page) {
  return page.locator("#corzaguessr").evaluate((root) => ({
    ready: (root as HTMLElement).dataset.corzaguessrReady,
    appStatus: (root as HTMLElement).dataset.appStatus,
    sessionStatus: (root as HTMLElement).dataset.sessionStatus,
    heading: root.querySelector("h1")?.textContent,
    modes: [...root.querySelectorAll<HTMLButtonElement>(".mode")].map((button) => ({
      text: button.textContent,
      pressed: button.getAttribute("aria-pressed"),
      disabled: button.disabled,
    })),
    discovery: root.querySelector<HTMLButtonElement>(".discovery-button")?.textContent,
    prompt: root.querySelector(".mode-prompt")?.textContent,
    play: {
      label: root.querySelector(".play")?.getAttribute("aria-label"),
      disabled: root.querySelector<HTMLButtonElement>(".play")?.disabled,
    },
    skip: {
      text: root.querySelector(".skip")?.textContent,
      disabled: root.querySelector<HTMLButtonElement>(".skip")?.disabled,
    },
    input: {
      placeholder: root.querySelector<HTMLInputElement>(".guess")?.placeholder,
      disabled: root.querySelector<HTMLInputElement>(".guess")?.disabled,
      expanded: root.querySelector(".guess")?.getAttribute("aria-expanded"),
    },
    clock: [root.querySelector(".now")?.textContent, root.querySelector(".endtime")?.textContent],
    discoveryCount: root.querySelector(".discovery-title small")?.textContent,
    audioCount: root.querySelectorAll("audio").length,
  }));
}

test("rewritten shell matches the latest-safe bundle contract", async ({ browser, page }) => {
  await page.goto("/");
  await expect(page.locator("#corzaguessr")).toHaveAttribute("data-app-status", "awaiting-mode");
  const rewritten = await contractSnapshot(page);

  const legacyPage = await browser.newPage();
  await legacyPage.route("**/legacy.html", (route) => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html><head><style>${styles}</style></head><body><div id="corzaguessr"></div><script src="/legacy-app.js"></script></body></html>`,
  }));
  await legacyPage.route("**/legacy-app.js", (route) => route.fulfill({ contentType: "text/javascript", body: legacyBundle }));
  await legacyPage.route("**/tracks.json**", (route) => route.fulfill({ contentType: "application/json", body: tracks }));
  await legacyPage.goto("http://127.0.0.1:4173/legacy.html");
  await expect(legacyPage.locator("#corzaguessr")).toHaveAttribute("data-app-status", "awaiting-mode");
  const legacy = await contractSnapshot(legacyPage);
  expect(rewritten).toEqual(legacy);
  await legacyPage.close();
});
