import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRules } from '../src/core/config.js';
import { buildMetrics } from '../src/core/metrics.js';
import { buildComparisons, selectPairs } from '../src/core/compare.js';
import { categorizeRemarks } from '../src/core/remarks.js';
import { validateDataset } from '../src/core/validate.js';
import { buildReportModel } from '../src/report/model.js';
import { buildWordReport } from '../src/report/word.js';
import { buildExcelReport } from '../src/report/excel.js';
import { exportReports } from '../src/report/index.js';
import { readZip } from '../src/core/ooxml/zip.js';
import { readXlsx } from '../src/core/ooxml/xlsx.js';
import { loadSampleWeeks, latestLimits } from './helpers.js';

const rules = loadRules();
const dataset = { weeks: loadSampleWeeks() };
const metrics = buildMetrics(dataset.weeks, latestLimits(), rules);
const comparisons = buildComparisons(metrics, 'chain');
const remarks = categorizeRemarks(
  dataset.weeks.flatMap((w) => w.rows),
  rules.remarkCategories,
);
const validation = validateDataset(dataset.weeks, rules);

const model = buildReportModel({
  dataset,
  metrics,
  comparisons,
  remarks,
  basisMode: 'current',
  rules,
  validation,
});

function assertBalancedXml(xml, label) {
  const stack = [];
  const tagRe = /<(\/?)([A-Za-z_:][-A-Za-z0-9_:.]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(xml))) {
    const [, closing, name, attrs, selfClose] = m;
    if (attrs.includes('<?') || name.startsWith('?')) continue;
    if (selfClose === '/') continue;
    if (closing === '/') {
      const last = stack.pop();
      assert.equal(last, name, `${label}: 标签闭合顺序错误，期望 </${last}>，实际 </${name}>`);
    } else {
      stack.push(name);
    }
  }
  assert.equal(stack.length, 0, `${label}: 存在未闭合标签 ${stack.join(',')}`);
}

test('报告模型：执行摘要不超过 5 条且含关键结论', () => {
  assert.ok(model.summary.length <= 5);
  assert.ok(model.summary.some((s) => s.includes('452')));
  assert.ok(model.summary.some((s) => s.includes('有效变化')));
});

test('报告模型：关键指标表包含双口径与合计行', () => {
  const flat = model.kpiRows.map((r) => r.join('|'));
  assert.ok(flat.some((r) => r.includes('76.6%')));
  assert.ok(flat.some((r) => r.includes('83.1%')));
  assert.ok(flat.some((r) => r.startsWith('合计')));
});

test('报告模型：差异对比表含环比六组，且给出抽样波动结论', () => {
  assert.equal(model.compareRows.length, 7);
  const conclusions = model.compareRows.slice(1).map((r) => r[6]);
  assert.ok(conclusions.every((c) => /无有效变化|有效上升|有效下降/.test(c)));
});

test('TC-M02 验收要求：可对任意周对做对比，3周 → 5周 判定无有效变化', () => {
  const custom = selectPairs(metrics, [
    ['3周', '5周'],
    ['2周', '4周'],
  ]);
  const customModel = buildReportModel({
    dataset,
    metrics,
    comparisons: custom,
    remarks,
    basisMode: 'current',
    rules,
    validation,
  });
  const row = customModel.compareRows.find((r) => r[0] === '3周 → 5周');
  assert.ok(row);
  assert.equal(row[3], '+11.9pp');
  assert.match(row[6], /无有效变化/);
  assert.equal(customModel.compareRows.length, 3);
});

test('报告模型：异常构成区分记录级与指标级合计', () => {
  const total = model.anomalyRows[model.anomalyRows.length - 1];
  assert.equal(total[1], 62);
  assert.equal(total[2], 63);
});

test('报告模型：附录 B 明细行数为 1 + 452', () => {
  assert.equal(model.detailRows.length, 453);
  assert.deepEqual(model.detailRows[0].slice(0, 3), ['周次', '箱/扎', '平均外径']);
});

test('Word 报告：产出合法 zip 且 document.xml 标签闭合、含全部章节', () => {
  const buf = buildWordReport(model, {});
  const files = readZip(buf);
  const doc = files['word/document.xml'].toString('utf8');
  assert.ok(doc.includes('一、执行摘要'));
  assert.ok(doc.includes('二、关键指标总览'));
  assert.ok(doc.includes('三、周间差异对比'));
  assert.ok(doc.includes('四、异常结构分析'));
  assert.ok(doc.includes('五、结论与建议'));
  assert.ok(doc.includes('附录 A'));
  assert.ok(doc.includes('附录 B'));
  assert.ok(doc.includes('76.6%'));
  assertBalancedXml(doc, 'document.xml');
  assertBalancedXml(files['word/styles.xml'].toString('utf8'), 'styles.xml');
});

test('Excel 报告：四个工作表齐全且可被读回', () => {
  const buf = buildExcelReport(model, dataset, metrics);
  const sheets = readXlsx(buf);
  assert.deepEqual(sheets.map((s) => s.name), ['总览指标', '周间对比', '异常明细', '原始明细']);
  assert.equal(sheets[2].rows.length, 63);
  assert.equal(sheets[3].rows.length, 453);
  assert.equal(sheets[3].rows[1][0], '1周');
});

test('Excel 异常明细：判定翻转列能标出标准变化影响', () => {
  const sheets = readXlsx(buildExcelReport(model, dataset, metrics));
  const anomaly = sheets[2].rows;
  const flipped = anomaly.filter((r) => r[6] === '是');
  assert.equal(flipped.length, 14);
});

test('整体导出：Word / Excel / PDF 三种格式均产出文件', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'qa-report-'));
  const { files } = exportReports({
    dataset,
    metrics,
    comparisons,
    remarks,
    basisMode: 'current',
    rules,
    validation,
    formats: ['word', 'excel', 'pdf'],
    outDir,
  });
  const byFormat = Object.fromEntries(files.map((f) => [f.format, f]));
  assert.equal(byFormat.word.ok, true, byFormat.word.error || '');
  assert.equal(byFormat.excel.ok, true, byFormat.excel.error || '');
  assert.equal(byFormat.pdf.ok, true, byFormat.pdf.error || '');
  for (const f of files) {
    assert.ok(existsSync(f.path), `${f.format} 文件不存在`);
    assert.ok(statSync(f.path).size > 1000, `${f.format} 文件过小`);
  }
  assert.equal(readFileSync(byFormat.pdf.path).subarray(0, 4).toString(), '%PDF');
  assert.match(byFormat.word.name, /^质量数据分析报告_1周-7周_\d{8}_\d{6}\.docx$/);
  assert.match(byFormat.excel.name, /^质量数据分析数据表_1周-7周_\d{8}_\d{6}\.xlsx$/);
});

test('单一格式失败不影响其他格式', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'qa-report-partial-'));
  const { files } = exportReports({
    dataset,
    metrics,
    comparisons,
    remarks,
    basisMode: 'current',
    rules,
    validation,
    formats: ['word', 'excel'],
    outDir,
  });
  assert.ok(files.every((f) => f.ok));
  assert.equal(files.length, 2);
});
