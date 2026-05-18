#!/usr/bin/env node

// Crucix Master Orchestrator — runs all intelligence sources in parallel
// Outputs structured JSON for Claude to synthesize into actionable briefing

import './utils/env.mjs'; // Load API keys from .env
import { pathToFileURL } from 'node:url';

// === Tier 1: Core OSINT & Geopolitical ===
import { briefing as gdelt } from './sources/gdelt.mjs';
import { briefing as opensky } from './sources/opensky.mjs';
import { briefing as firms } from './sources/firms.mjs';
import { briefing as ships } from './sources/ships.mjs';
import { briefing as safecast } from './sources/safecast.mjs';
import { briefing as acled } from './sources/acled.mjs';
import { briefing as reliefweb } from './sources/reliefweb.mjs';
import { briefing as who } from './sources/who.mjs';
import { briefing as ofac } from './sources/ofac.mjs';
import { briefing as opensanctions } from './sources/opensanctions.mjs';
import { briefing as adsb } from './sources/adsb.mjs';

// === Tier 2: Economic & Financial ===
import { briefing as fred } from './sources/fred.mjs';
import { briefing as treasury } from './sources/treasury.mjs';
import { briefing as bls } from './sources/bls.mjs';
import { briefing as eia } from './sources/eia.mjs';
import { briefing as gscpi } from './sources/gscpi.mjs';
import { briefing as usaspending } from './sources/usaspending.mjs';
import { briefing as comtrade } from './sources/comtrade.mjs';

// === Tier 3: Weather, Environment, Technology, Social ===
import { briefing as noaa } from './sources/noaa.mjs';
import { briefing as epa } from './sources/epa.mjs';
import { briefing as patents } from './sources/patents.mjs';
import { briefing as bluesky } from './sources/bluesky.mjs';
import { briefing as reddit } from './sources/reddit.mjs';
import { briefing as telegram } from './sources/telegram.mjs';
import { briefing as kiwisdr } from './sources/kiwisdr.mjs';

// === Tier 4: Space & Satellites ===
import { briefing as space } from './sources/space.mjs';

// === Tier 5: Live Market Data ===
import { briefing as yfinance } from './sources/yfinance.mjs';

// === Tier 6: Cyber & Infrastructure ===
import { briefing as cisaKev } from './sources/cisa-kev.mjs';
import { briefing as cloudflareRadar } from './sources/cloudflare-radar.mjs';

// GEELT 需要50秒
// OFAC 需要37秒
const SOURCE_TIMEOUT_MS = 60_000; // 30s max per individual source

export async function runSource(name, fn, ...args) {
  const start = Date.now();
  let timer;
  try {
    const dataPromise = fn(...args);
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Source ${name} timed out after ${SOURCE_TIMEOUT_MS / 1000}s`)), SOURCE_TIMEOUT_MS);
    });
    const data = await Promise.race([dataPromise, timeoutPromise]);
    return { name, status: 'ok', durationMs: Date.now() - start, data };
  } catch (e) {
    return { name, status: 'error', durationMs: Date.now() - start, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Source task definitions shared between parallel (fullBriefing) and
 * sequential (stepBriefing) execution modes.
 * Each entry: { name, fn, args } where fn is the briefing function
 * and args are any extra arguments (e.g. API key) passed after the fn.
 */
function getSourceTasks() {
  return [
    // Tier 1: Core OSINT & Geopolitical
    { name: 'GDELT', fn: gdelt, args: [] },
    { name: 'OpenSky', fn: opensky, args: [] },
    { name: 'FIRMS', fn: firms, args: [] },
    { name: 'Maritime', fn: ships, args: [] },
    { name: 'Safecast', fn: safecast, args: [] },
    { name: 'ACLED', fn: acled, args: [] },
    { name: 'ReliefWeb', fn: reliefweb, args: [] },
    { name: 'WHO', fn: who, args: [] },
    { name: 'OFAC', fn: ofac, args: [] },
    { name: 'OpenSanctions', fn: opensanctions, args: [] },
    { name: 'ADS-B', fn: adsb, args: [] },

    // Tier 2: Economic & Financial
    { name: 'FRED', fn: fred, args: [process.env.FRED_API_KEY] },
    { name: 'Treasury', fn: treasury, args: [] },
    { name: 'BLS', fn: bls, args: [process.env.BLS_API_KEY] },
    { name: 'EIA', fn: eia, args: [process.env.EIA_API_KEY] },
    { name: 'GSCPI', fn: gscpi, args: [] },
    { name: 'USAspending', fn: usaspending, args: [] },
    { name: 'Comtrade', fn: comtrade, args: [] },

    // Tier 3: Weather, Environment, Technology, Social
    { name: 'NOAA', fn: noaa, args: [] },
    { name: 'EPA', fn: epa, args: [] },
    { name: 'Patents', fn: patents, args: [] },
    { name: 'Bluesky', fn: bluesky, args: [] },
    { name: 'Reddit', fn: reddit, args: [] },
    { name: 'Telegram', fn: telegram, args: [] },
    { name: 'KiwiSDR', fn: kiwisdr, args: [] },

    // Tier 4: Space & Satellites
    { name: 'Space', fn: space, args: [] },

    // Tier 5: Live Market Data
    { name: 'YFinance', fn: yfinance, args: [] },

    // Tier 6: Cyber & Infrastructure
    { name: 'CISA-KEV', fn: cisaKev, args: [] },
    { name: 'Cloudflare-Radar', fn: cloudflareRadar, args: [] },
  ];
}

/**
 * Assemble raw results into the standard output shape.
 * Shared between fullBriefing() and stepBriefing().
 */
function buildOutput(results, startedAt) {
  const totalMs = Date.now() - startedAt;
  return {
    crucix: {
      version: '2.0.0',
      timestamp: new Date().toISOString(),
      totalDurationMs: totalMs,
      sourcesQueried: results.length,
      sourcesOk: results.filter(s => s.status === 'ok').length,
      sourcesFailed: results.filter(s => s.status !== 'ok').length,
    },
    sources: Object.fromEntries(
      results.filter(s => s.status === 'ok').map(s => [s.name, s.data])
    ),
    errors: results.filter(s => s.status !== 'ok').map(s => ({ name: s.name, error: s.error })),
    timing: Object.fromEntries(
      results.map(s => [s.name, { status: s.status, ms: s.durationMs }])
    ),
  };
}

export async function fullBriefing() {
  console.error('[Crucix] Starting intelligence sweep (parallel) — 29 sources...');
  const start = Date.now();

  const allPromises = getSourceTasks().map(t => runSource(t.name, t.fn, ...t.args));

  // Each runSource has its own 30s timeout, so allSettled will resolve
  // within ~30s even if APIs hang. Global timeout is a safety net.
  const settled = await Promise.allSettled(allPromises);
  const results = settled.map(r => r.status === 'fulfilled' ? r.value : { status: 'failed', error: r.reason?.message });

  const output = buildOutput(results, start);
  console.error(`[Crucix] Sweep complete in ${output.crucix.totalDurationMs}ms — ${output.crucix.sourcesOk}/${results.length} sources returned data`);
  return output;
}

/**
 * upd by lonk 2026-05-18
 * Sequential sweep — processes sources one-by-one to minimise memory pressure.
 * Suitable for low-memory environments such as Render.com (512 MB).
 * Returns the same output shape as fullBriefing().
 */
export async function stepBriefing() {
  console.error('[Crucix] Starting intelligence sweep (sequential) — 29 sources...');
  const start = Date.now();
  const results = [];

  for (const task of getSourceTasks()) {
    const result = await runSource(task.name, task.fn, ...task.args);
    results.push(result);
    const ok = result.status === 'ok' ? '✓' : '✗';
    console.error(`  [${ok}] ${task.name} — ${result.durationMs}ms${result.error ? ` — ${result.error}` : ''}`);
  }

  const output = buildOutput(results, start);
  console.error(`[Crucix] Sweep complete in ${output.crucix.totalDurationMs}ms — ${output.crucix.sourcesOk}/${results.length} sources returned data`);
  return output;
}

// Run and output when executed directly
const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;

if (entryHref && import.meta.url === entryHref) {
  const useStep = process.argv.includes('--step');
  const data = useStep ? await stepBriefing() : await fullBriefing();
  console.log(JSON.stringify(data, null, 2));
}
