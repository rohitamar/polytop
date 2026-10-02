import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5183');
  await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  await page.evaluate(() => window.__GAME_DEBUG__.setSeed('fern-104'));
  await page.waitForTimeout(5000);
  const results = {};
  const stats = values => {
    const sorted = values.slice().sort((a,b) => a-b);
    return { mean: values.reduce((a,b) => a+b,0) / values.length, p95: sorted[Math.floor(sorted.length * .95)] };
  };
  for (const mode of ['idle', 'hover', 'selected']) {
    if (mode === 'selected') {
      const point = await page.evaluate(() => window.__GAME_DEBUG__.getUnitScreenPosition());
      await page.mouse.click(point.x, point.y);
    }
    const initial = await page.evaluate(() => { window.__GAME_DEBUG__.resetProfile(); return window.__GAME_DEBUG__.getProfile(); });
    if (mode === 'hover') {
      for (let i = 0; i < 100; i++) await page.mouse.move(450 + i * 5, 450 + Math.sin(i / 10) * 100);
    } else await page.waitForTimeout(5000);
    const data = await page.evaluate(() => window.__GAME_DEBUG__.getProfile());
    results[mode] = { meshes: data.meshes, materials: data.materials, active: stats(data.frames.map(f=>f.active)), draws: stats(data.frames.map(f=>f.draws)), cpuMs: stats(data.frames.map(f=>f.cpu)), intervalMs: stats(data.frames.map(f=>f.interval)), picks: data.picks.length, pickMs: stats(data.picks), reactRenders: data.reactRenders-initial.reactRenders, builds: data.builds-initial.builds, updates: data.updates-initial.updates, loops: data.loops, frames: data.frames.length };
    await page.screenshot({ path: `profile-${process.argv[2] ?? 'run'}-${mode}.png` });
  }
  if (process.argv[2] === 'economy') {
    await page.getByRole('button', { name: 'Assign worker 4,3', exact: true }).click();
    await page.getByRole('button', { name: 'Assign worker 4,4', exact: true }).click();
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'End Turn', exact: true }).click();
    const point = await page.evaluate(() => window.__GAME_DEBUG__.getUnitScreenPosition('warrior-1'));
    await page.mouse.click(point.x, point.y);
    await page.getByRole('button', { name: 'Grow Population' }).click();
    await page.getByRole('button', { name: 'Upgrade Town Hall' }).click();
    await page.waitForTimeout(1000);
    const initial = await page.evaluate(() => { window.__GAME_DEBUG__.resetProfile(); return window.__GAME_DEBUG__.getProfile(); });
    await page.waitForTimeout(5000);
    const data = await page.evaluate(() => window.__GAME_DEBUG__.getProfile());
    results.upgradedCity = { meshes: data.meshes, materials: data.materials, active: stats(data.frames.map(f=>f.active)), draws: stats(data.frames.map(f=>f.draws)), cpuMs: stats(data.frames.map(f=>f.cpu)), intervalMs: stats(data.frames.map(f=>f.interval)), picks: data.picks.length, pickMs: stats(data.picks), reactRenders: data.reactRenders-initial.reactRenders, builds: data.builds-initial.builds, updates: data.updates-initial.updates, loops: data.loops, frames: data.frames.length };
    await page.screenshot({ path: 'profile-economy-upgradedCity.png' });
  }
  const gpu = await page.evaluate(() => { const gl = document.querySelector('canvas').getContext('webgl2'); const ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable'; });
  const output = { gpu, results };
  await writeFile(`profile-${process.argv[2] ?? 'run'}.json`, JSON.stringify(output,null,2));
  console.log(JSON.stringify(output,null,2));
} finally {
  await browser.close();
}
