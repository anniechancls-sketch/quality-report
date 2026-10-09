import { judgeRow, ANOMALY_TYPES, sameLimits } from './judge.js';
import { mean, stdDev, minOf, maxOf, wilsonInterval, capabilityIndex } from './stats.js';

export function isValidRow(row) {
  return (
    Number.isFinite(row.outerDiameter) &&
    Number.isFinite(row.minWall) &&
    Number.isFinite(row.maxWall)
  );
}

/**
 * 汇总单个周次的指标。无效行（数值缺失）不计入样本量，单独计数。
 */
export function aggregateWeek(week, limits) {
  const valid = [];
  let invalid = 0;
  for (const row of week.rows) {
    if (isValidRow(row)) valid.push(row);
    else invalid += 1;
  }

  const byType = Object.fromEntries(ANOMALY_TYPES.map((t) => [t, 0]));
  const outer = [];
  const minWalls = [];
  const maxWalls = [];
  let pass = 0;
  let anomalyRecords = 0;

  for (const row of valid) {
    const { pass: ok, issues } = judgeRow(row, limits);
    if (ok) pass += 1;
    else anomalyRecords += 1;
    for (const issue of issues) {
      if (byType[issue] !== undefined) byType[issue] += 1;
    }
    outer.push(row.outerDiameter);
    minWalls.push(row.minWall);
    maxWalls.push(row.maxWall);
  }

  const n = valid.length;
  const rate = n ? pass / n : 0;
  const { cp, cpk } = capabilityIndex(outer, limits.outerMin, limits.outerMax);

  return {
    n,
    invalid,
    pass,
    anomalyRecords,
    anomalyItems: Object.values(byType).reduce((s, v) => s + v, 0),
    rate,
    ci: wilsonInterval(pass, n),
    byType,
    meanOuter: mean(outer),
    rangeOuter: outer.length ? maxOf(outer) - minOf(outer) : 0,
    sdOuter: stdDev(outer),
    meanMinWall: mean(minWalls),
    minWall: minOf(minWalls),
    meanMaxWall: mean(maxWalls),
    maxWall: maxOf(maxWalls),
    cp,
    cpk,
  };
}

/**
 * 构建双口径指标。current 使用各周当期限值，unified 使用统一基准。
 * 对应需求文档 M4 与测试用例 TC-C01 ~ TC-C13。
 */
export function buildMetrics(weeks, basisLimits, options = {}) {
  const smallSampleThreshold = options.smallSampleThreshold ?? 30;

  const weekMetrics = weeks.map((week) => {
    const current = aggregateWeek(week, week.limits);
    const unified = aggregateWeek(week, basisLimits);
    return {
      label: week.label,
      date: week.date,
      limits: week.limits,
      basisLimits,
      standardChanged: !sameLimits(week.limits, basisLimits),
      current,
      unified,
      flips: Math.abs(current.pass - unified.pass),
      small: current.n > 0 && current.n < smallSampleThreshold,
    };
  });

  const byTypeTotal = Object.fromEntries(ANOMALY_TYPES.map((t) => [t, 0]));
  for (const w of weekMetrics) {
    for (const t of ANOMALY_TYPES) byTypeTotal[t] += w.current.byType[t];
  }

  const sum = (pick) => weekMetrics.reduce((s, w) => s + pick(w), 0);

  return {
    basisLimits,
    weeks: weekMetrics,
    totalN: sum((w) => w.current.n),
    totalInvalid: sum((w) => w.current.invalid),
    totalPass: sum((w) => w.current.pass),
    totalAnomalyRecords: sum((w) => w.current.anomalyRecords),
    byTypeTotal,
    anomalyItemsTotal: Object.values(byTypeTotal).reduce((s, v) => s + v, 0),
    flipsTotal: sum((w) => w.flips),
    smallWeeks: weekMetrics.filter((w) => w.small),
    changedWeeks: weekMetrics.filter((w) => w.standardChanged),
  };
}

/** 按当前展示口径取指标 */
export function pick(weekMetric, basisMode) {
  return basisMode === 'current' ? weekMetric.current : weekMetric.unified;
}
