import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const stats = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return { mean: values.reduce((a, b) => a + b, 0) / values.length, p95: sorted[Math.floor(sorted.length * 0.95)] };
};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5190');
  await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  const worlds = [];
  for (const players of [2, 8]) {
    const buildMs = await page.evaluate(players => {
      const start = performance.now();
      window.__GAME_DEBUG__.setWorld('fern-104', players);
      return performance.now() - start;
    }, players);
    await page.waitForTimeout(5000);
    const samples = {};
    for (const mode of ['idle', 'hover', 'selected', 'developed']) {
      if (mode === 'selected') {
        const city = await page.evaluate(() => window.__GAME_DEBUG__.getState().cities[0]);
        const point = await page.evaluate(city => window.__GAME_DEBUG__.getTileScreenPosition(city.x, city.y), city);
        await page.mouse.click(point.x, point.y);
        await page.waitForTimeout(1000);
      }
      if (mode === 'developed') {
        await page.getByRole('button', { name: 'Manage resources' }).click();
        const tile = await page.evaluate(() => {
          const state = window.__GAME_DEBUG__.getState();
          const city = state.cities[0];
          const claims = window.__GAME_DEBUG__.getTerritory();
          return state.tiles.find(tile => tile.resource && claims.some(claim => claim.x === tile.x && claim.y === tile.y && claim.cityId === city.id));
        });
        const point = await page.evaluate(tile => window.__GAME_DEBUG__.getTileScreenPosition(tile.x, tile.y), tile);
        await page.mouse.click(point.x, point.y);
        await page.getByRole('button', { name: 'Assign Civilian', exact: true }).click();
        await page.waitForTimeout(1000);
      }
      const initial = await page.evaluate(() => {
        window.__GAME_DEBUG__.resetProfile();
        return { profile: window.__GAME_DEBUG__.getProfile(), borders: window.__GAME_DEBUG__.getTerritoryRenderStats(), resources: window.__GAME_DEBUG__.getResourceRenderStats() };
      });
      if (mode === 'hover') {
        for (let i = 0; i < 100; i++) await page.mouse.move(450 + i * 5, 450 + Math.sin(i / 10) * 100);
      } else await page.waitForTimeout(5000);
      const final = await page.evaluate(() => ({ profile: window.__GAME_DEBUG__.getProfile(), borders: window.__GAME_DEBUG__.getTerritoryRenderStats(), resources: window.__GAME_DEBUG__.getResourceRenderStats() }));
      const data = final.profile;
      samples[mode] = {
        meshes: data.meshes, materials: data.materials, draws: stats(data.frames.map(frame => frame.draws)),
        cpuMs: stats(data.frames.map(frame => frame.cpu)), intervalMs: stats(data.frames.map(frame => frame.interval)),
        pickMs: stats(data.picks), frames: data.frames.length, loops: data.loops,
        reactRenders: data.reactRenders - initial.profile.reactRenders,
        builds: data.builds - initial.profile.builds, updates: data.updates - initial.profile.updates,
        territoryBuilds: final.borders.builds - initial.borders.builds, territoryMeshes: final.borders.meshes,
        resourceBuilds: final.resources.builds - initial.resources.builds, resources: final.resources,
      };
      await page.screenshot({ path: `test-results/resources-${players}-${mode}.png` });
    }
    const state = await page.evaluate(() => window.__GAME_DEBUG__.getState());
    worlds.push({ players, width: state.width, height: state.height, buildMs, samples });
  }
  const gpu = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2');
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable';
  });
  const result = { gpu, viewport: { width: 1440, height: 1000 }, seed: 'fern-104', worlds };
  await writeFile('docs/scene-profile-resources.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
