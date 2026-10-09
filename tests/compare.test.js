import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRules } from '../src/core/config.js';
import { buildMetrics } from '../src/core/metrics.js';
import { buildComparisons, comparePair } from '../src/core/compare.js';
import { loadSampleWeeks, latestLimits, pct } from './helpers.js';

const rules = loadRules();
const metrics = buildMetrics(loadSampleWeeks(), latestLimits(), rules);

function findPair(from, to) {
  const pairs = buildComparisons(metrics, 'chain');
  return pairs.find((p) => p.from === from && p.to === to);
}

test('TC-M02 3周 → 5周：当期口径区间不重叠，但统一口径下判定为无有效变化', () => {
  const p = comparePair(metrics.weeks[2], metrics.weeks[4]);
  // 当期口径下两区间不重叠（63.5–85.0 与 89.8–98.7）
  const curA = metrics.weeks[2].current.ci;
  const curB = metrics.weeks[4].current.ci;
  assert.equal(curA[1] >= curB[0], false, '当期口径区间不重叠');
  // 统一口径下差距被标准变化吃掉，两区间重叠，因此不下有效变化的结论
  assert.equal(p.overlap, true);
  assert.equal(p.verdict, 'flat');
  assert.equal(pct(p.delta), 11.9);
});

test('TC-M03 2周 → 4周 判定无有效变化', () => {
  const p = comparePair(metrics.weeks[1], metrics.weeks[3]);
  assert.equal(p.verdict, 'flat');
  assert.equal(p.overlap, true);
});

test('TC-M04 5周 → 6周 判定无有效变化', () => {
  const p = comparePair(metrics.weeks[4], metrics.weeks[5]);
  assert.equal(p.verdict, 'flat');
  assert.equal(p.overlap, true);
});

test('TC-M01 差异三列同时可用：数值变化、标准变化、抽样波动', () => {
  const p = findPair('1周', '2周');
  assert.ok(Number.isFinite(p.delta));
  assert.ok(Number.isFinite(p.standardShiftFrom));
  assert.ok(Number.isFinite(p.standardShiftTo));
  assert.ok(Array.isArray(p.fromCi) && Array.isArray(p.toCi));
  assert.ok(['up', 'down', 'flat'].includes(p.verdict));
});

test('TC-M05 环比模式共 6 组对比，从 1周 → 2周 开始', () => {
  const pairs = buildComparisons(metrics, 'chain');
  assert.equal(pairs.length, 6);
  assert.equal(pairs[0].from, '1周');
  assert.equal(pairs[5].to, '7周');
});

test('TC-M06 全周次总览模式共 6 组，全部以 1周 为基准', () => {
  const pairs = buildComparisons(metrics, 'all');
  assert.equal(pairs.length, 6);
  assert.ok(pairs.every((p) => p.from === '1周'));
});

test('数值变化一律使用统一口径计算', () => {
  const p = comparePair(metrics.weeks[2], metrics.weeks[4]);
  assert.equal(pct(p.delta), pct(metrics.weeks[4].unified.rate - metrics.weeks[2].unified.rate));
});

test('显著性判定必须与被比较的序列同口径：统一口径差值配统一口径区间', () => {
  for (const p of buildComparisons(metrics, 'chain')) {
    const overlap = p.fromCi[1] >= p.toCi[0] && p.toCi[1] >= p.fromCi[0];
    assert.equal(p.overlap, overlap);
    assert.equal(p.verdict === 'flat', overlap);
  }
});

test('TC-X01 只有一周数据时无法对比', () => {
  const m = buildMetrics(loadSampleWeeks().slice(0, 1), latestLimits(), rules);
  assert.deepEqual(buildComparisons(m, 'chain'), []);
  assert.deepEqual(buildComparisons(m, 'all'), []);
});

test('标准变化列反映当期与统一口径之差', () => {
  const p = comparePair(metrics.weeks[0], metrics.weeks[1]);
  assert.equal(pct(p.standardShiftFrom), pct(metrics.weeks[0].current.rate - metrics.weeks[0].unified.rate));
  assert.equal(metrics.weeks[0].standardChanged, true);
  assert.equal(metrics.weeks[4].standardChanged, false);
});
