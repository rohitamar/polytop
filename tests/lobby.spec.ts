import { expect, test } from "@playwright/test";

test("two browsers share a lobby and transfer host when one disconnects", async ({
  browser,
  page,
}) => {
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Multiplayer lobby" }).click();
    await page.getByLabel("Player name", { exact: true }).fill("Fern");
    await page
      .getByRole("button", { name: "Create room", exact: true })
      .click();
    const codeInput = page.getByLabel("Room code", { exact: true });
    await expect(codeInput).toHaveValue(/^[A-HJ-NP-Z2-9]{6}$/);
    const code = await codeInput.inputValue();
    await guest.goto("/");
    await guest.getByRole("button", { name: "Multiplayer lobby" }).click();
    await guest.getByLabel("Player name", { exact: true }).fill("Moss");
    await guest.getByLabel("Join with room code").fill(code);
    await guest.getByRole("button", { name: "Join room", exact: true }).click();
    for (const client of [page, guest]) {
      const players = client.getByRole("list", { name: "Connected players" });
      await expect(players.getByRole("listitem")).toHaveCount(2);
      await expect(players).toContainText("Fern");
      await expect(players).toContainText("Moss");
      await expect(
        players.getByRole("listitem").filter({ hasText: "Fern" }),
      ).toContainText("Host");
      await expect(client.getByLabel("Room code", { exact: true })).toHaveValue(
        code,
      );
    }
    await page.screenshot({ path: "test-results/lobby-host.png" });
    await guest.screenshot({ path: "test-results/lobby-guest.png" });
    await page.close();
    await expect(
      guest
        .getByRole("list", { name: "Connected players" })
        .getByRole("listitem"),
    ).toHaveCount(1);
    await expect(
      guest.getByRole("listitem").filter({ hasText: "Moss" }),
    ).toContainText("Host");
    await guest
      .getByRole("button", { name: "Leave room", exact: true })
      .click();
    await expect(
      guest.getByLabel("Player name", { exact: true }),
    ).toBeVisible();
  } finally {
    await guestContext.close();
  }
});
