import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRules } from '../src/core/config.js';
import { categorizeRemarks, describeScrap } from '../src/core/remarks.js';
import { loadSampleWeeks } from './helpers.js';

const rules = loadRules();
const weeks = loadSampleWeeks();
const allRows = weeks.flatMap((w) => w.rows);
const analysis = categorizeRemarks(allRows, rules.remarkCategories);

test('备注总数 44 条，与异常记录对应关系一致', () => {
  assert.equal(analysis.total, 44);
});

test('处置归类命中数量与原始文案一致', () => {
  assert.equal(analysis.counts['已反馈班组追溯'], 31);
  assert.equal(analysis.counts['追溯后合格'], 4);
  assert.equal(analysis.counts['追溯报废'], 11);
});

test('报废文案被识别，报废量单位统一为米', () => {
  assert.equal(analysis.scrapCount, 11);
  assert.deepEqual(analysis.scrapUnits, ['米']);
});

test('备注整体存在米与公分两种度量，被标记为需要换算', () => {
  assert.equal(analysis.unitMixed, true);
  assert.deepEqual([...analysis.allUnits].sort(), ['公分', '米'].sort());
});

test('报废量不做求和，描述中显式说明', () => {
  const text = describeScrap(analysis);
  assert.match(text, /未做求和/);
  assert.match(text, /报废量原始单位为米/);
  assert.match(text, /不同物理量/);
});

test('备注归类不改写判定：归类结果只产出计数，不返回判定', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(analysis, 'pass'), false);
  assert.ok(analysis.examples['追溯报废'].length > 0);
});
