import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRules } from '../src/core/config.js';

const here = dirname(fileURLToPath(import.meta.url));

export const SAMPLES_DIR = join(here, '..', 'data', 'samples');

/** 载入 452 条样例数据，返回可被 core 直接使用的周次结构 */
export function loadSampleWeeks() {
  const raw = JSON.parse(readFileSync(join(SAMPLES_DIR, 'weeks.json'), 'utf8'));
  return raw.weeks.map((w) => ({
    label: w.label,
    date: w.date,
    limits: { ...w.limits },
    rows: w.rows.map((r) => ({ ...r })),
  }));
}

export function latestLimits() {
  return { ...loadRules().presets.latest.limits };
}

export function strictLimits() {
  return { ...loadRules().presets.strict.limits };
}

/** 转成保留 1 位小数的百分数，便于与测试用例中的期望值直接比对 */
export function pct(value) {
  return Number((value * 100).toFixed(1));
}

export function round(value, digits = 1) {
  return Number(value.toFixed(digits));
}

/** 深拷贝周次结构，便于构造异常数据集 */
export function cloneWeeks(weeks) {
  return weeks.map((w) => ({
    label: w.label,
    date: w.date,
    limits: { ...w.limits },
    rows: w.rows.map((r) => ({ ...r })),
  }));
}
