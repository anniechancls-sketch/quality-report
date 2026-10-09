/**
 * 数字回查：提取生成文本中的全部数字，与程序计算的指标集合比对。
 * 对应需求文档 7.2 与测试用例 TC-A03 / TC-A04。
 */

export function extractNumbers(text) {
  return String(text ?? '').match(/[0-9]+(?:\.[0-9]+)?/g) || [];
}

function putNumber(set, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  for (const digits of [0, 1, 2, 3, 4]) set.add(value.toFixed(digits));
}

/** 收集全部允许出现的数字：指标快照、限值、日期、固定常量 */
export function collectAllowedNumbers(snapshot) {
  const set = new Set();
  const walk = (node) => {
    if (typeof node === 'number') putNumber(set, node);
    else if (typeof node === 'string') {
      for (const part of node.split(/[^0-9.]+/)) if (part) putNumber(set, Number(part));
    } else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') Object.values(node).forEach(walk);
  };
  walk(snapshot);

  // 派生值：百分比形式与百分比差
  for (const w of snapshot.weeks) {
    putNumber(set, w.rate * 100);
    putNumber(set, (w.ci ? w.ci[0] : 0) * 100);
    putNumber(set, (w.ci ? w.ci[1] : 0) * 100);
    putNumber(set, w.unifiedRate * 100);
    putNumber(set, Math.abs(w.currentRate - w.unifiedRate) * 100);
    if (w.ci) putNumber(set, (w.ci[1] - w.ci[0]) * 100);
    if (w.unifiedCi) putNumber(set, (w.unifiedCi[1] - w.unifiedCi[0]) * 100);
    putNumber(set, Math.abs(w.currentRate - w.rate) * 100);
  }
  for (const c of snapshot.comparisons || []) {
    putNumber(set, Math.abs(c.unifiedDelta) * 100);
    putNumber(set, c.unifiedDelta * 100);
    // 当期口径下的差值：允许模型引用，但数值仍来自程序快照
    const from = snapshot.weeks.find((w) => w.label === c.from);
    const to = snapshot.weeks.find((w) => w.label === c.to);
    if (from && to) {
      putNumber(set, (to.currentRate - from.currentRate) * 100);
      putNumber(set, Math.abs(to.currentRate - from.currentRate) * 100);
      putNumber(set, (to.unifiedRate - from.unifiedRate) * 100);
    }
  }
  putNumber(set, snapshot.totals?.anomalyItems && snapshot.totals.anomalyRecords
    ? (100 * (Object.values(snapshot.totals.byType || {}).sort((a, b) => b - a)[0] || 0)) /
        snapshot.totals.anomalyItems
    : 0);

  // 文本中允许出现的固定数字：置信水平、阈值上限等
  ['95', '100', '0', '1', '2', '3', '4', '5', '6', '7'].forEach((n) => set.add(n));
  return set;
}

export function checkNumbers(text, snapshot) {
  const allowed = collectAllowedNumbers(snapshot);
  const numbers = extractNumbers(text);
  const unmatched = [];
  for (const raw of numbers) {
    if (allowed.has(raw)) continue;
    // 只按候选数字自身的小数位数比对：文本写 99.9，就要求存在某个计算值四舍五入到一位小数等于 99.9。
    // 不能用更少的小数位去容忍，否则 99.9 会被 "100" 这个合法值套住而漏过。
    const decimals = (raw.split('.')[1] || '').length;
    if (allowed.has(Number(raw).toFixed(decimals))) continue;
    unmatched.push(raw);
  }
  return {
    total: numbers.length,
    matched: numbers.length - unmatched.length,
    unmatched,
    passed: unmatched.length === 0,
  };
}
