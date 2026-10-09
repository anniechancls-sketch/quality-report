import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv, readHeader, suggestMapping } from '../src/core/csv.js';
import { buildWeek, toNumber } from '../src/core/mapping.js';
import { buildMetrics } from '../src/core/metrics.js';
import { checkRecomputeConsistency } from '../src/core/validate.js';
import { loadRules } from '../src/core/config.js';
import { SAMPLES_DIR, latestLimits, pct } from './helpers.js';

const rules = loadRules();
const sampleWeeks = JSON.parse(readFileSync(join(SAMPLES_DIR, 'weeks.json'), 'utf8')).weeks;
const KEYWORDS = {
  boxNo: ['箱/扎'],
  outerDiameter: ['平均外径'],
  minWall: ['最小壁厚'],
  maxWall: ['最大壁厚'],
  verdict: ['判定'],
  remark: ['备注'],
};

function loadWeekFromCsv(label) {
  const text = readFileSync(join(SAMPLES_DIR, `${label}.csv`), 'utf8');
  const rows = parseCsv(text);
  const header = readHeader(rows, 0);
  const mapping = suggestMapping(header, KEYWORDS);
  const meta = sampleWeeks.find((w) => w.label === label);
  return {
    week: buildWeek({
      label,
      date: meta.date,
      limits: meta.limits,
      rows,
      headerRowIndex: 0,
      mapping,
    }),
    header,
    mapping,
  };
}

const built = sampleWeeks.map((w) => loadWeekFromCsv(w.label).week);

test('TC-D01 / TC-D02 七个 CSV 文件全部解析成功', () => {
  assert.equal(built.length, 7);
  assert.ok(built.every((w) => w.rows.length > 0));
});

test('TC-D03 / TC-D04 解析行数与原始数据一致，合计 452', () => {
  assert.deepEqual(
    built.map((w) => w.rows.length),
    [77, 62, 58, 67, 82, 90, 16],
  );
  assert.equal(built.reduce((s, w) => s + w.rows.length, 0), 452);
});

test('TC-D05 1周表无备注列，映射建议为不指定', () => {
  const { mapping, header } = loadWeekFromCsv('1周');
  assert.equal(mapping.remark, null);
  assert.ok(!header.some((h) => h.name === '备注'));
});

test('TC-D06 / TC-D07 2–7周表识别到重复的「测量工具」列', () => {
  const { header, mapping } = loadWeekFromCsv('2周');
  const tools = header.filter((h) => h.name === '测量工具');
  assert.equal(tools.length, 2);
  assert.ok(tools[1].duplicate);
  assert.ok(mapping.remark !== null);
});

test('TC-D08 CSV 链路复算一致率仍为 100%', () => {
  const c = checkRecomputeConsistency(built);
  assert.equal(c.total, 452);
  assert.equal(c.mismatches.length, 0);
  assert.equal(Number((c.rate * 100).toFixed(1)), 100);
});

test('CSV 链路得到的合格率与样例数据完全一致', () => {
  const m = buildMetrics(built, latestLimits(), rules);
  assert.deepEqual(
    m.weeks.map((w) => pct(w.current.rate)),
    [76.6, 87.1, 75.9, 83.6, 96.3, 92.2, 93.8],
  );
  assert.equal(m.totalN, 452);
  assert.equal(m.totalAnomalyRecords, 62);
  assert.equal(m.anomalyItemsTotal, 63);
});

test('TC-D15 各文件限值独立，互不串位', () => {
  const m = buildMetrics(built, latestLimits(), rules);
  assert.deepEqual(
    m.weeks.map((w) => w.limits.outerMin),
    [31.54, 31.54, 31.54, 31.54, 31.46, 31.46, 31.46],
  );
  assert.deepEqual(
    m.weeks.map((w) => w.limits.wallMax),
    [2.11, 2.1, 2.1, 2.1, 2.11, 2.11, 2.11],
  );
});

test('TC-X07 带单位后缀的数值能被提取并给出警告', () => {
  const a = toNumber('31.756mm');
  assert.equal(a.value, 31.756);
  assert.match(a.warning, /含非数值内容/);
  const b = toNumber('1,832');
  assert.equal(b.value, 1);
  const c = toNumber('待测');
  assert.equal(c.value, null);
  assert.match(c.warning, /无法解析/);
});

test('TC-X05 判定列留空时一致率显示不适用', () => {
  const text = readFileSync(join(SAMPLES_DIR, '1周.csv'), 'utf8');
  const rows = parseCsv(text);
  const header = readHeader(rows, 0);
  const mapping = { ...suggestMapping(header, KEYWORDS), verdict: null };
  const meta = sampleWeeks[0];
  const week = buildWeek({
    label: '1周',
    date: meta.date,
    limits: meta.limits,
    rows,
    mapping,
  });
  const c = checkRecomputeConsistency([week]);
  assert.equal(c.comparable, 0);
  assert.equal(c.rate, null);
});

test('CSV 解析支持引号包裹、字段内逗号与 BOM', () => {
  const text = '\uFEFFa,"b,c",d\r\n1,"say ""hi""",3\r\n';
  const rows = parseCsv(text);
  assert.deepEqual(rows[0], ['a', 'b,c', 'd']);
  assert.deepEqual(rows[1], ['1', 'say "hi"', '3']);
});
