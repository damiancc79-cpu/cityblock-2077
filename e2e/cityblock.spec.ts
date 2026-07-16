import { expect, test } from "@playwright/test";

test("renders, regenerates, inspects a building, and switches camera", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

  await page.goto("/");
  await expect(page.getByTestId("city-canvas")).toBeVisible();
  await expect(page.getByTestId("generation-status")).toContainText("CITY ONLINE", { timeout: 30_000 });
  await page.getByRole("button", { name: "CONFIG" }).click();
  await page.getByRole("button", { name: "RANDOMIZE" }).last().click();
  await expect(page.getByTestId("generation-status")).toContainText("CITY ONLINE", { timeout: 15_000 });
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.getByTestId("scan-nearest").click();
  await expect(page.getByTestId("building-inspector")).toBeVisible();
  await page.getByRole("button", { name: "cinematic camera mode" }).click();
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});
