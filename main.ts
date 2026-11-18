// gta6-twitch-ccu-forecast-01: forecast GTA VI's launch-day Twitch viewers hour by hour.
// Model: comparable-launch shape, level-conditioned.
//   For each comparable past launch, take its launch-day hourly curve (hours 1..24 of its
//   UTC release day) and form log ratios r_h = ln(viewers_h / viewers_1). The shape of a
//   launch day depends on how big hour 1 already is: a game whose first hour is already
//   huge (big regions already unlocked) ramps much less than one whose first hour is tiny.
//   So per hour h we fit a straight line of log-ratio on log(hour-1 viewers) across the
//   comparables, with the slope clamped to [-1, 0] (a bigger first hour never means a
//   steeper ramp), and predict the target case's log-ratio from its own hour-1 print.
//   The spread comes from the residual interquartile range (x1.6 for honest ~90%
//   coverage), clamped to [0.10, 0.90] log units. Quantiles are lognormal around the
//   predicted median: q_tau = p1 * exp(m_h + z_tau * sigma_h).
// Everything is computed from the case file at run time (no fitted constants are baked
// in); the program is deterministic (sorted file order, no randomness, no network).

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
/** Spread multiplier on the residual IQR sigma (tuned by leave-one-out on the comparables). */
const SIGMA_MULT = 1.6;
/** Minimum comparables contributing to an hour before we trust the regression. */
const MIN_POINTS = 10;

interface KnownRow {
  hour: number;
  viewers: number;
}
interface HourlyPoint {
  from: string;
  viewers: number;
  channels?: number | null;
}
interface Comparable {
  day_start: string;
  hourly: HourlyPoint[];
}
interface Case {
  levels: number[];
  known: KnownRow[];
  forecast: Array<{ hour: number }>;
  comparables: Comparable[];
}

/** x rounded to 2 decimals (half up). */
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Median of numbers. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** Linear-interpolated quantile of numbers. */
function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Launch-day hours 1..24 (UTC day_start) of one comparable, as hour -> viewers. */
function launchHours(c: Comparable): Map<number, number> {
  const start = Date.parse(c.day_start);
  const out = new Map<number, number>();
  for (const p of c.hourly ?? []) {
    const h = (Date.parse(p.from) - start) / 3600000 + 1;
    if (Number.isInteger(h) && h >= 1 && h <= 24 && Number.isFinite(p.viewers) && p.viewers >= 1) {
      out.set(h, p.viewers);
    }
  }
  return out;
}

/**
 * Fit the hour-h shape from the comparables and predict this case's quantiles.
 * Returns [q05, q25, q50, q75, q95] for hour h, or null when there is no usable data.
 */
function hourQuantiles(comps: Comparable[], p1: number, h: number): number[] | null {
  const logRatios: number[] = [];
  const logP1: number[] = [];
  for (const c of comps) {
    const lh = launchHours(c);
    const v1 = lh.get(1);
    const vh = lh.get(h);
    if (v1 !== undefined && vh !== undefined) {
      logRatios.push(Math.log(vh / v1));
      logP1.push(Math.log(v1));
    }
  }
  let m: number;
  let sigma: number;
  if (logRatios.length >= MIN_POINTS) {
    // Least-squares line of log-ratio on log(hour-1 viewers); slope clamped to [-1, 0].
    const mx = logP1.reduce((a, b) => a + b, 0) / logP1.length;
    const my = logRatios.reduce((a, b) => a + b, 0) / logRatios.length;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < logRatios.length; i++) {
      sxx += (logP1[i] - mx) ** 2;
      sxy += (logP1[i] - mx) * (logRatios[i] - my);
    }
    const b = sxx > 0 ? Math.max(-1, Math.min(0, sxy / sxx)) : 0;
    const a = my - b * mx;
    m = a + b * Math.log(p1);
    // Never predict outside the range of shapes the comparables actually showed.
    m = Math.max(Math.min(...logRatios), Math.min(Math.max(...logRatios), m));
    const resid = logRatios.map((y, i) => y - (a + b * logP1[i]));
    sigma = Math.max(
      0.1,
      Math.min(0.9, ((quantile(resid, 0.75) - quantile(resid, 0.25)) / 1.349) * SIGMA_MULT),
    );
  } else if (logRatios.length > 0) {
    // Too few comparables: plain median shape, with a wider spread than the
    // baseline's because a thin sample means a less certain shape.
    m = median(logRatios);
    sigma = 0.25 * Math.sqrt(h - 1);
  } else {
    return null;
  }
  const qs = Z.map((z) => round2(p1 * Math.exp(m + z * sigma)));
  // Enforce the output contract: finite, > 0, <= 1e9, non-decreasing.
  for (let i = 0; i < qs.length; i++) {
    qs[i] = Math.max(0.01, Math.min(1e9, qs[i]));
    if (i > 0) qs[i] = Math.max(qs[i], qs[i - 1]);
  }
  return qs;
}

/** The house-baseline fallback for an hour with no comparable data: flat at p1. */
function baselineQuantiles(p1: number, h: number): number[] {
  const qs = Z.map((z) => round2(p1 * Math.exp(z * 0.15 * Math.sqrt(h - 1))));
  for (let i = 0; i < qs.length; i++) {
    qs[i] = Math.max(0.01, Math.min(1e9, qs[i]));
    if (i > 0) qs[i] = Math.max(qs[i], qs[i - 1]);
  }
  return qs;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR)
  .filter((f) => f.endsWith('.in'))
  .sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(`${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  const first = c.known.find((k) => k.hour === 1);
  if (first === undefined) throw new Error(`${file} has no hour-1 print`);
  const p1 = Math.max(1, first.viewers);
  const hours = c.forecast.map(({ hour }) => ({
    hour,
    q: hourQuantiles(c.comparables ?? [], p1, hour) ?? baselineQuantiles(p1, hour),
  }));
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
