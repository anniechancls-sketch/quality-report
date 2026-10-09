import test from 'node:test';
import assert from 'node:assert/strict';
import { createZip, readZip } from '../site/lib/zip.js';
import { buildXlsx, readXlsx } from '../site/lib/xlsx.js';
import { buildDocx } from '../site/lib/docx.js';
import { buildMetrics } from '../site/lib/metrics.js';
import { buildComparisons, buildSnapshot } from '../site/lib/compare.js';
import { RULES } from '../site/lib/rules.js';
import { loadSampleWeeks } from './helpers.js';

test('site 版 ZIP 往返（基于 CompressionStream）', async () => {
  const zip = await createZip([
    { name: 'a.txt', data: 'hello 静态' },
    { name: 'dir/b.xml', data: 'A'.repeat(3000) },
  ]);
  assert.ok(zip instanceof Uint8Array);
  const files = await readZip(zip);
  const decoder = new TextDecoder('utf-8');
  assert.equal(decoder.decode(files['a.txt']), 'hello 静态');
  assert.equal(decoder.decode(files['dir/b.xml']).length, 3000);
});

test('site 版 XLSX 往返（含中文与数字）', async () => {
  const rows = [
    ['周次', '样本量', '合格率'],
    ['1周', 77, '76.6%'],
    [2, 31.756, true],
  ];
  const bytes = await buildXlsx([{ name: '总览指标', rows }]);
  const sheets = await readXlsx(bytes);
  assert.equal(sheets[0].name, '总览指标');
  assert.deepEqual(sheets[0].rows, rows);
});

test('site 版 DOCX 可生成且被 ZIP 读回、XML 标签闭合', async () => {
  const bytes = await buildDocx([
    { type: 'title', text: '质量数据分析报告' },
    { type: 'heading', text: '一、执行摘要' },
    { type: 'para', text: '共 452 条记录。' },
    { type: 'table', rows: [['周次', '合格率'], ['1周', '76.6%']] },
  ]);
  const files = await readZip(bytes);
  const doc = new TextDecoder('utf-8').decode(files['word/document.xml']);
  assert.ok(doc.includes('一、执行摘要'));
  assert.ok(doc.includes('452'));
  const stack = [];
  for (const m of doc.matchAll(/<(\/?)([A-Za-z_:][-A-Za-z0-9_:.]*)([^>]*?)(\/?)>/g)) {
    const [, closing, name, , selfClose] = m;
    if (selfClose === '/') continue;
    if (closing === '/') assert.equal(stack.pop(), name);
    else stack.push(name);
  }
  assert.equal(stack.length, 0);
});

test('site 版核心计算与主版本一致（样例数据 452 条）', () => {
  const weeks = loadSampleWeeks();
  const metrics = buildMetrics(weeks, RULES.presets.latest.limits, RULES);
  assert.equal(metrics.totalN, 452);
  assert.equal(metrics.totalAnomalyRecords, 62);
  assert.equal(metrics.anomalyItemsTotal, 63);
  assert.equal(metrics.flipsTotal, 14);
  assert.equal((metrics.weeks[0].current.rate * 100).toFixed(1), '76.6');
  const strict = buildMetrics(weeks, RULES.presets.strict.limits, RULES);
  assert.equal(strict.flipsTotal, 89);
  assert.equal(strict.weeks[4].unified.pass, 23);
  const comparisons = buildComparisons(metrics, 'chain');
  assert.equal(comparisons.length, 6);
});

test('快照里的周对自带当期与统一合格率，界面与 AI 可直接引用（防 NaN）', () => {
  const weeks = loadSampleWeeks();
  const metrics = buildMetrics(weeks, RULES.presets.latest.limits, RULES);
  const comparisons = buildComparisons(metrics, 'chain');
  const snapshot = buildSnapshot(metrics, 'current', RULES, comparisons);
  const c = snapshot.comparisons[0];
  for (const key of ['fromCurrentRate', 'toCurrentRate', 'fromUnifiedRate', 'toUnifiedRate', 'standardShiftFrom', 'standardShiftTo', 'unifiedDelta']) {
    assert.equal(typeof c[key], 'number', `${key} 缺失或不是数字`);
  }
  assert.equal(Number(((c.toCurrentRate - c.fromCurrentRate) * 100).toFixed(1)), 10.5);
  assert.equal(c.verdict, 'flat');
});
