import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRules } from '../src/core/config.js';
import { buildMetrics } from '../src/core/metrics.js';
import { loadSampleWeeks, latestLimits, strictLimits, pct, round } from './helpers.js';

const rules = loadRules();
const weeks = loadSampleWeeks();

test('TC-D03 各周行数与原始数据一致', () => {
  assert.deepEqual(
    weeks.map((w) => w.rows.length),
    [77, 62, 58, 67, 82, 90, 16],
  );
});

test('TC-D04 解析总行数 452', () => {
  const m = buildMetrics(weeks, latestLimits(), rules);
  assert.equal(m.totalN, 452);
});

test('TC-C01 当期合格率七周数值正确', () => {
  const m = buildMetrics(weeks, latestLimits(), rules);
  assert.deepEqual(
    m.weeks.map((w) => pct(w.current.rate)),
    [76.6, 87.1, 75.9, 83.6, 96.3, 92.2, 93.8],
  );
});

test('TC-C02 Wilson 95% 置信区间正确', () => {
  const m = buildMetrics(weeks, latestLimits(), rules);
  const ci = m.weeks.map((w) => w.current.ci.map((v) => pct(v)));
  assert.deepEqual(ci, [
    [66.0, 84.7],
    [76.6, 93.3],
    [63.5, 85.0],
    [72.9, 90.6],
    [89.8, 98.7],
    [84.8, 96.2],
    [71.7, 98.9],
  ]);
});

test('TC-C03 统一基准默认取最新标准四项限值', () => {
  const latest = loadRules().presets.latest.limits;
  assert.deepEqual(latest, { outerMin: 31.46, outerMax: 32.02, wallMin: 1.78, wallMax: 2.11 });
});

test('TC-C04 统一到最新标准的合格率正确', () => {
  const m = buildMetrics(weeks, latestLimits(), rules);
  assert.deepEqual(
    m.weeks.map((w) => pct(w.unified.rate)),
    [83.1, 88.7, 84.5, 88.1, 96.3, 92.2, 93.8],
  );
});

test('TC-C05 标准变化影响量分周与合计正确', () => {
  const m = buildMetrics(weeks, latestLimits(), rules);
  assert.deepEqual(
    m.weeks.map((w) => w.flips),
    [5, 1, 5, 3, 0, 0, 0],
  );
  assert.equal(m.flipsTotal, 14);
});

test('TC-C06 / TC-C07 复合最严基准复算与 5周合格数', () => {
  const m = buildMetrics(weeks, strictLimits(), rules);
  assert.deepEqual(
    m.weeks.map((w) => pct(w.unified.rate)),
    [74.0, 87.1, 75.9, 83.6, 28.0, 63.3, 62.5],
  );
  assert.deepEqual(
    m.weeks.map((w) => w.flips),
    [2, 0, 0, 0, 56, 26, 5],
  );
  assert.equal(m.flipsTotal, 89);
  assert.equal(m.weeks[4].unified.pass, 23);
  assert.equal(m.weeks[4].current.pass, 79);
});

test('TC-C08 复算只改判定不改测量值', () => {
  const a = buildMetrics(weeks, latestLimits(), rules);
  const b = buildMetrics(weeks, strictLimits(), rules);
  for (let i = 0; i < a.weeks.length; i += 1) {
    assert.equal(round(a.weeks[i].current.meanOuter), round(b.weeks[i].current.meanOuter));
    assert.equal(round(a.weeks[i].current.meanMinWall), round(b.weeks[i].current.meanMinWall));
    assert.equal(round(a.weeks[i].current.meanMaxWall), round(b.weeks[i].current.meanMaxWall));
  }
});

test('TC-C09 / TC-C13 记录级与指标级异常计数', () => {
  const m = buildMetrics(weeks, latestLimits(), rules);
  assert.equal(m.totalAnomalyRecords, 62);
  assert.equal(m.anomalyItemsTotal, 63);
  assert.equal(m.totalPass, 390);
  assert.deepEqual(m.byTypeTotal, {
    外径偏大: 30,
    外径偏小: 22,
    壁厚偏厚: 11,
    壁厚偏薄: 0,
  });
});

test('TC-C13 异常率 13.7%', () => {
  const m = buildMetrics(weeks, latestLimits(), rules);
  assert.equal(pct(m.totalAnomalyRecords / m.totalN), 13.7);
});

test('TC-C10 组合异常在记录级计 1 条、指标级分别计数', () => {
  const m = buildMetrics(weeks, latestLimits(), rules);
  const combined = m.totalAnomalyRecords - m.anomalyItemsTotal;
  assert.equal(combined, -1, '存在一条记录同时命中两个指标项，指标级比记录级多 1');

  const week3 = m.weeks[2];
  const multi = week3.current.byType['外径偏大'] + week3.current.byType['壁厚偏厚'];
  assert.ok(multi > 0, '3周存在外径与壁厚同时出现的异常');
});

test('TC-D09 / TC-O05 小样本周识别为 7周', () => {
  const m = buildMetrics(weeks, latestLimits(), rules);
  assert.deepEqual(m.smallWeeks.map((w) => w.label), ['7周']);
  assert.equal(m.weeks[6].current.n, 16);
});

test('TC-D11 修改单周限值只影响该周', () => {
  const changed = loadSampleWeeks();
  const before = buildMetrics(changed, latestLimits(), rules);
  changed[0].limits = { ...changed[0].limits, outerMin: 31.9 };
  const after = buildMetrics(changed, latestLimits(), rules);
  assert.notEqual(before.weeks[0].current.pass, after.weeks[0].current.pass);
  for (let i = 1; i < after.weeks.length; i += 1) {
    assert.equal(before.weeks[i].current.pass, after.weeks[i].current.pass);
  }
});

test('TC-C12 壁厚偏薄分类保留且计数为 0', () => {
  const m = buildMetrics(weeks, latestLimits(), rules);
  assert.equal(m.byTypeTotal['壁厚偏薄'], 0);
  assert.ok('壁厚偏薄' in m.byTypeTotal);
});

test('TC-O02 平均外径 Cp/Cpk 可计算，容量为 7 周', () => {
  const m = buildMetrics(weeks, latestLimits(), rules);
  for (const w of m.weeks) {
    assert.ok(Number.isFinite(w.current.cp));
    assert.ok(Number.isFinite(w.current.cpk));
  }
});
