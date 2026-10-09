import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRules } from '../src/core/config.js';
import { checkRecomputeConsistency, validateDataset } from '../src/core/validate.js';
import { validateLimits } from '../src/core/judge.js';
import { loadSampleWeeks, cloneWeeks } from './helpers.js';

const rules = loadRules();

test('TC-D08 判定复算一致率 100%', () => {
  const c = checkRecomputeConsistency(loadSampleWeeks());
  assert.equal(c.total, 452);
  assert.equal(c.comparable, 452);
  assert.equal(c.matched, 452);
  assert.equal(c.mismatches.length, 0);
  assert.equal(Number((c.rate * 100).toFixed(1)), 100);
});

test('TC-D08 反向验证：人工判定被篡改时能定位该行', () => {
  const weeks = cloneWeeks(loadSampleWeeks());
  weeks[2].rows[0].verdictManual = !weeks[2].rows[0].verdictManual;
  const c = checkRecomputeConsistency(weeks);
  assert.equal(c.mismatches.length, 1);
  assert.equal(c.mismatches[0].week, '3周');
  assert.equal(c.mismatches[0].rowIndex, 0);
});

test('TC-D10 1周表无备注，产生 18 条无处置记录的异常', () => {
  const weeks = loadSampleWeeks();
  assert.equal(weeks[0].rows.length, 77);
  assert.ok(weeks[0].rows.every((r) => !r.remark));
});

test('TC-D12 限值上下限颠倒被拦截', () => {
  const result = validateLimits({ outerMin: 32, outerMax: 31, wallMin: 1.78, wallMax: 2.11 });
  assert.equal(result.level, 'block');
  assert.match(result.messages[0], /外径下限应小于上限/);
});

test('TC-X12 公差区间过窄给出警告', () => {
  const result = validateLimits({ outerMin: 31.5, outerMax: 31.505, wallMin: 1.78, wallMax: 2.11 });
  assert.equal(result.level, 'warning');
  assert.match(result.messages[0], /公差区间小于 0.01/);
});

test('TC-D13 非数字限值被拦截', () => {
  const result = validateLimits({ outerMin: NaN, outerMax: 32, wallMin: 1.78, wallMax: 2.11 });
  assert.equal(result.level, 'block');
});

test('TC-X08 周次标签重复被阻断', () => {
  const weeks = cloneWeeks(loadSampleWeeks()).slice(0, 2);
  weeks[1].label = weeks[0].label;
  const report = validateDataset(weeks, rules);
  assert.equal(report.level, 'block');
  assert.ok(report.blocking.some((m) => m.includes('已被其他文件使用')));
});

test('TC-X02 数值缺失的行被排除计算并给出警告', () => {
  const weeks = cloneWeeks(loadSampleWeeks()).slice(0, 1);
  weeks[0].rows[0].outerDiameter = null;
  const report = validateDataset(weeks, rules);
  assert.ok(report.warnings.some((m) => m.includes('数值缺失')));
});

test('TC-D09 小样本周在校验结果中被提示', () => {
  const report = validateDataset(loadSampleWeeks(), rules);
  assert.deepEqual(report.smallWeeks, ['7周']);
  assert.ok(report.warnings.some((m) => m.includes('样本量不足')));
});

test('整体样例数据校验为警告级而非阻断级', () => {
  const report = validateDataset(loadSampleWeeks(), rules);
  assert.equal(report.level, 'warning');
  assert.equal(report.blocking.length, 0);
});
