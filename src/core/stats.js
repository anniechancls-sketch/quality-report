/** 95% 置信水平对应的标准正态分位数 */
export const Z_95 = 1.959964;

export function mean(values) {
  if (!values.length) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** 样本标准差（ddof = 1），与需求文档指标定义第 6 条一致 */
export function stdDev(values) {
  const n = values.length;
  if (n < 2) return 0;
  const m = mean(values);
  let acc = 0;
  for (const v of values) acc += (v - m) * (v - m);
  return Math.sqrt(acc / (n - 1));
}

export function minOf(values) {
  return values.length ? Math.min(...values) : 0;
}

export function maxOf(values) {
  return values.length ? Math.max(...values) : 0;
}

/**
 * Wilson 置信区间。中心值与半宽公式见需求文档第六章补充公式。
 * 返回 [下限, 上限]（0–1 区间），样本量为 0 时返回 null。
 */
export function wilsonInterval(successes, n, z = Z_95) {
  if (!n) return null;
  const p = successes / n;
  const z2 = z * z;
  const den = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

/** 过程能力指数，仅适用于双边限值指标（本项目中为平均外径） */
export function capabilityIndex(values, lower, upper) {
  const sd = stdDev(values);
  if (!sd) return { cp: null, cpk: null };
  const m = mean(values);
  const cp = (upper - lower) / (6 * sd);
  const cpk = Math.min(upper - m, m - lower) / (3 * sd);
  return { cp, cpk };
}
