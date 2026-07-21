import { expect, test } from "@playwright/test";

test("mounts the parity shell and loads the catalog", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#corzaguessr h1")).toHaveText("CORZAGUESSR✦");
  await expect(page.getByRole("button", { name: "DAILY" })).toBeEnabled();
  await expect(page.locator("#corzaguessr")).toHaveAttribute("data-app-status", "awaiting-mode");
});

test("desktop and mobile shell remain inside the viewport", async ({ page }) => {
  await page.goto("/");
  const box = await page.locator("#corzaguessr .wrap").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual((await page.evaluate(() => innerWidth)) + 1);
});
