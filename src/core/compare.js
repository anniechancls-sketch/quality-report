import { pick } from './metrics.js';

export const EFFECTIVE_UP = 'up';
export const EFFECTIVE_DOWN = 'down';
export const NO_EFFECTIVE_CHANGE = 'flat';

/**
 * 对比两个周次。数值变化与置信区间判定一律使用统一口径，
 * 标准变化使用各周自身的「当期 − 统一」。
 * 对应需求文档 M5 与测试用例 TC-M01 ~ TC-M04。
 */
export function comparePair(weekA, weekB) {
  const a = weekA.unified;
  const b = weekB.unified;
  const delta = b.rate - a.rate;
  const overlap =
    Boolean(a.ci) && Boolean(b.ci) && a.ci[1] >= b.ci[0] && b.ci[1] >= a.ci[0];

  let verdict = NO_EFFECTIVE_CHANGE;
  if (!overlap) verdict = delta > 0 ? EFFECTIVE_UP : EFFECTIVE_DOWN;

  return {
    from: weekA.label,
    to: weekB.label,
    delta,
    overlap,
    verdict,
    fromUnifiedRate: a.rate,
    toUnifiedRate: b.rate,
    fromCurrentRate: weekA.current.rate,
    toCurrentRate: weekB.current.rate,
    standardShiftFrom: weekA.current.rate - weekA.unified.rate,
    standardShiftTo: weekB.current.rate - weekB.unified.rate,
    fromCi: a.ci,
    toCi: b.ci,
    changedStandard: weekA.standardChanged || weekB.standardChanged,
  };
}

export function buildComparisons(metrics, mode = 'chain') {
  const weeks = metrics.weeks;
  const pairs = [];
  if (mode === 'all') {
    for (let i = 1; i < weeks.length; i += 1) pairs.push([weeks[0], weeks[i]]);
  } else {
    for (let i = 1; i < weeks.length; i += 1) pairs.push([weeks[i - 1], weeks[i]]);
  }
  return pairs.map(([a, b]) => comparePair(a, b));
}

/**
 * 按指定的周次对做对比，用于「重点周对」场景（例如验收要求的 3周 → 5周）。
 * labels 形如 [['3周','5周'], ['2周','4周']]，返回顺序与传入一致，无法匹配的周次对会被跳过。
 */
export function selectPairs(metrics, labelPairs = []) {
  const byLabel = new Map(metrics.weeks.map((w) => [w.label, w]));
  const result = [];
  for (const [from, to] of labelPairs) {
    const a = byLabel.get(from);
    const b = byLabel.get(to);
    if (a && b) result.push(comparePair(a, b));
  }
  return result;
}

/** 供 AI 解读使用的口径化指标快照，只包含程序算好的数字 */
export function buildSnapshot(metrics, basisMode, rules, comparisons = [], remarks = null) {
  const view = basisMode === 'current' ? 'current' : 'unified';
  return {
    basisMode,
    basisLimits: metrics.basisLimits,
    smallSampleThreshold: rules.smallSampleThreshold,
    weeks: metrics.weeks.map((w) => {
      const m = w[view];
      const other = w[view === 'current' ? 'unified' : 'current'];
      return {
        label: w.label,
        date: w.date,
        limits: w.limits,
        n: m.n,
        pass: m.pass,
        anomalyRecords: m.anomalyRecords,
        rate: m.rate,
        ci: m.ci,
        otherRate: other.rate,
        unifiedRate: w.unified.rate,
        unifiedCi: w.unified.ci,
        currentRate: w.current.rate,
        currentCi: w.current.ci,
        byType: m.byType,
        meanOuter: m.meanOuter,
        cp: m.cp,
        cpk: m.cpk,
        flips: w.flips,
        small: w.small,
      };
    }),
    comparisons: comparisons.map((c) => ({
      from: c.from,
      to: c.to,
      unifiedDelta: c.delta,
      verdict: c.verdict,
      overlap: c.overlap,
      fromCurrentRate: c.fromCurrentRate,
      toCurrentRate: c.toCurrentRate,
      fromUnifiedRate: c.fromUnifiedRate,
      toUnifiedRate: c.toUnifiedRate,
      fromUnifiedCi: c.fromCi,
      toUnifiedCi: c.toCi,
      standardShiftFrom: c.standardShiftFrom,
      standardShiftTo: c.standardShiftTo,
    })),
    remarks: remarks
      ? {
          total: remarks.total,
          counts: remarks.counts,
          scrapCount: remarks.scrapCount,
          scrapUnits: remarks.scrapUnits,
          allUnits: remarks.allUnits,
        }
      : null,
    totals: {
      n: metrics.totalN,
      pass: metrics.totalPass,
      anomalyRecords: metrics.totalAnomalyRecords,
      anomalyItems: metrics.anomalyItemsTotal,
      byType: metrics.byTypeTotal,
      flips: metrics.flipsTotal,
      smallWeeks: metrics.smallWeeks.map((w) => w.label),
    },
  };
}
