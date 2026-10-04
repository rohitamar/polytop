import { expect, test, type Page } from "@playwright/test";
import { getUnitDefinition, type UnitType } from "../packages/game-core/src/index";
import "../apps/web/src/debug";
import { travel, develop, research as researchTechnology } from "./development-helpers";

const snapshot = (page: Page) => page.evaluate(() => window.__GAME_DEBUG__!.getState());
async function settle(page: Page) {
  await expect.poll(() => page.evaluate(() => window.__GAME_DEBUG__!.isAnimating())).toBe(false);
}
async function tile(page: Page, x: number, y: number) {
  const point = await page.evaluate(position => window.__GAME_DEBUG__!.getTileScreenPosition(position.x, position.y), { x, y });
  await page.mouse.click(point.x, point.y);
}
async function select(page: Page, id: string) {
  const point = await page.evaluate(id => window.__GAME_DEBUG__!.getUnitScreenPosition(id), id);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => page.evaluate(() => window.__GAME_DEBUG__!.getSelectedUnitId())).toBe(id);
}
async function move(page: Page, id: string, x: number, y: number) {
  await select(page, id);
  await tile(page, x, y);
  await expect.poll(async () => {
    const unit = (await snapshot(page)).units.find(unit => unit.id === id);
    return unit && [unit.x, unit.y];
  }).toEqual([x, y]);
  await settle(page);
}
async function end(page: Page) {
  const revision = (await snapshot(page)).revision;
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).revision).toBe(revision + 1);
}
async function research(page: Page, names: string[]) {
  if (!names.length) return;
  await page.getByRole("button", { name: "Technologies", exact: true }).click();
  for (const name of names) {
    await page.getByRole("button", { name: new RegExp(`^${name}: `) }).click();
    await page.getByRole("button", { name: `Research ${name}`, exact: true }).click();
    await expect(page.getByRole("button", { name: new RegExp(`^${name}: `) })).toHaveAccessibleName(`${name}: Researched`);
  }
  await page.getByRole("button", { name: "Close technologies" }).click();
}
const recruits: [UnitType, string[]][] = [
  ["warrior", []], ["rider", ["Riding"]], ["archer", ["Hunting", "Archery"]],
  ["defender", ["Organization", "Strategy"]], ["swordsman", ["Climbing", "Mining", "Smithery"]],
  ["catapult", ["Hunting", "Forestry", "Mathematics"]],
];
for (const [type, technologies] of recruits) {
  test(`recruits and renders ${type} with authoritative technology and action rules`, async ({ page }, info) => {
    test.setTimeout(120000);
    await page.goto("/");
    await page.waitForFunction(() => !!window.__GAME_DEBUG__);
    await page.evaluate(() => window.__GAME_DEBUG__!.setSeed("fern-104"));
    await move(page, "warrior-1", 5, 5);
    while ((await snapshot(page)).players[0].resources.gold < 40) { await end(page); await end(page); }
    await tile(page, 4, 5);
    await page.getByRole("button", { name: "Recruit units", exact: true }).click();
    const definition = getUnitDefinition(type)!;
    const recruit = page.getByRole("button", { name: `Recruit ${definition.name}`, exact: true });
    await expect(page.getByRole("button", { name: "Recruit Giant", exact: true })).toHaveCount(0);
    if (technologies.length) {
      await expect(recruit).toBeDisabled();
      await expect(page.getByRole("article", { name: definition.name, exact: true })).toContainText(`Requires ${technologies.at(-1)}`);
      await research(page, technologies);
    }
    const before = await snapshot(page);
    await recruit.click();
    await expect.poll(async () => (await snapshot(page)).units.length).toBe(before.units.length + 1);
    const trained = (await snapshot(page)).units.at(-1)!;
    expect((await snapshot(page)).players[0].resources.gold).toBe(before.players[0].resources.gold - definition.goldCost!);
    expect(trained).toMatchObject({ unitType: type, hp: definition.maxHp, actionPhase: "complete" });
    await select(page, trained.id);
    await expect(page.getByRole("region", { name: "Unit information" })).toContainText(definition.name);
    await page.screenshot({ path: info.outputPath(`${type}.png`) });
    await end(page);
    await move(page, "warrior-2", 7, 4);
    await end(page);
    await move(page, "warrior-1", 5, 4);
    if (type !== "catapult") await move(page, trained.id, 4, 4);
    await end(page);
    await move(page, "warrior-2", 6, 4);
    await end(page);
    if (type !== "catapult" && type !== "archer") {
      await move(page, "warrior-1", 5, 3);
      await move(page, trained.id, 5, 4);
    }
    await select(page, trained.id);
    await tile(page, 6, 4);
    if (type === "defender") {
      await expect(page.getByRole("button", { name: "Attack", exact: true })).toHaveCount(0);
    } else {
      await page.getByRole("button", { name: "Attack", exact: true }).click();
      await settle(page);
      expect((await snapshot(page)).units.find(unit => unit.id === "warrior-2")?.hp ?? 0).toBeLessThan(10);
      if (definition.range > 1) expect((await snapshot(page)).units.find(unit => unit.id === trained.id)!.hp).toBe(definition.maxHp);
      else expect((await snapshot(page)).units.find(unit => unit.id === trained.id)!.hp).toBeLessThanOrEqual(definition.maxHp);
    }
  });
}

test("Rider Escape synchronizes between browsers and survives reconnect", async ({ page, browser }, info) => {
  test.setTimeout(120000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const guest = await context.newPage();
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Multiplayer lobby" }).click();
    await page.getByLabel("Player name", { exact: true }).fill("Fern");
    await page.getByRole("button", { name: "Create room", exact: true }).click();
    await expect(page.getByLabel("Room code", { exact: true })).toHaveValue(/^[A-HJ-NP-Z2-9]{6}$/);
    const code = await page.getByLabel("Room code", { exact: true }).inputValue();
    await guest.goto("/");
    await guest.getByRole("button", { name: "Multiplayer lobby" }).click();
    await guest.getByLabel("Player name", { exact: true }).fill("Moss");
    await guest.getByLabel("Join with room code").fill(code);
    await guest.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(page.getByRole("button", { name: "Start game", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(page.getByTestId("active-player")).toContainText("Fern");
    await move(page, "warrior-1", 5, 5);
    for (let i = 0; i < 3; i++) { await end(page); await end(guest); }
    await research(page, ["Riding"]);
    await tile(page, 4, 5);
    await page.getByRole("button", { name: "Recruit units", exact: true }).click();
    await page.getByRole("button", { name: "Recruit Rider", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).units.some(unit => unit.unitType === "rider")).toBe(true);
    const id = (await snapshot(page)).units.find(unit => unit.unitType === "rider")!.id;
    await end(page); await end(guest);
    await move(page, "warrior-1", 5, 4);
    await move(page, id, 6, 5);
    expect((await snapshot(page)).units.find(unit => unit.id === id)!.movement).toBe(0);
    await end(page);
    await move(guest, "warrior-2", 7, 4);
    await end(guest);
    await move(page, id, 6, 4);
    await select(page, id);
    await tile(page, 7, 4);
    await page.getByRole("button", { name: "Attack", exact: true }).click();
    await settle(page);
    await expect.poll(async () => (await snapshot(page)).units.find(unit => unit.id === id)?.actionPhase).toBe("escape");
    await expect.poll(async () => (await snapshot(guest)).revision).toBe((await snapshot(page)).revision);
    const saved = await snapshot(page);
    await page.reload();
    await expect.poll(async () => (await snapshot(page)).revision).toBe(saved.revision);
    expect((await snapshot(page)).units.find(unit => unit.id === id)).toEqual(saved.units.find(unit => unit.id === id));
    await select(page, id);
    await expect(page.getByRole("region", { name: "Unit information" })).toContainText("Escape movement available");
    await page.screenshot({ path: info.outputPath("rider-escape.png") });
    await move(page, id, 6, 5);
    expect((await snapshot(page)).units.find(unit => unit.id === id)).toMatchObject({ actionPhase: "complete", movement: 0, hasAttacked: true });
    expect(await page.evaluate(id => window.__GAME_DEBUG__!.getReachableTiles(id), id)).toEqual([]);
    await tile(page, 7, 4);
    await expect(page.getByRole("button", { name: "Attack", exact: true })).toHaveCount(0);
    await end(page); await end(guest);
    expect((await snapshot(page)).units.find(unit => unit.id === id)).toMatchObject({ actionPhase: "ready", hasAttacked: false, movement: 2 });
  } finally { await context.close(); }
});

test("claims and renders a Giant through population and a level-five reward", async ({ page }, info) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  await page.evaluate(() => window.__GAME_DEBUG__!.setSeed("fern-104"));
  await move(page, "warrior-1", 5, 5);
  test.setTimeout(300000);
  for (const id of ["riding", "roads", "climbing"] as const) await researchTechnology(page, id);
  await travel(page, "warrior-1", { x: 10, y: 7 }, true);
  await develop(page, "city-1", 5);
  await page.keyboard.press("Escape");
  await tile(page, 4, 5);
  await page.getByRole("button", { name: /^Giant ·/ }).click();
  const before = await snapshot(page);
  await page.getByRole("button", { name: "Claim Giant reward", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).units.some(unit => unit.unitType === "giant")).toBe(true);
  const giant = (await snapshot(page)).units.find(unit => unit.unitType === "giant")!;
  expect((await snapshot(page)).players[0].resources.gold).toBe(before.players[0].resources.gold);
  await select(page, giant.id);
  await expect(page.getByRole("region", { name: "Unit information" })).toContainText("40 / 40 HP");
  await expect(page.getByRole("region", { name: "Unit information" })).toContainText("STATIC");
  await page.screenshot({ path: info.outputPath("giant.png") });
  await expect(page.getByRole("button", { name: "Claim Giant reward", exact: true })).toHaveCount(0);
  await end(page); await end(page);
  await move(page, giant.id, 3, 5);
});
