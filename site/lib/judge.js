/** 异常类型常量。归类规则来自需求文档 M3 判定规则。 */
export const OUTER_HIGH = '外径偏大';
export const OUTER_LOW = '外径偏小';
export const WALL_THICK = '壁厚偏厚';
export const WALL_THIN = '壁厚偏薄';

export const ANOMALY_TYPES = [OUTER_HIGH, OUTER_LOW, WALL_THICK, WALL_THIN];

/**
 * 判定单行记录。
 * 规则：外径须落在 [outerMin, outerMax]；最小壁厚须 ≥ wallMin；最大壁厚须 ≤ wallMax。
 * 三项全部满足判为合格，否则按超限方向归类，一条记录可同时命中多项。
 */
export function judgeRow(row, limits) {
  const issues = [];
  const d = row.outerDiameter;
  const mn = row.minWall;
  const mx = row.maxWall;

  if (d === null || d === undefined) issues.push('外径缺失');
  else if (d < limits.outerMin) issues.push(OUTER_LOW);
  else if (d > limits.outerMax) issues.push(OUTER_HIGH);

  if (mn === null || mn === undefined) issues.push('最小壁厚缺失');
  else if (mn < limits.wallMin) issues.push(WALL_THIN);

  if (mx === null || mx === undefined) issues.push('最大壁厚缺失');
  else if (mx > limits.wallMax) issues.push(WALL_THICK);

  return { pass: issues.length === 0, issues };
}

export function normalizeLimits(input) {
  return {
    outerMin: Number(input.outerMin),
    outerMax: Number(input.outerMax),
    wallMin: Number(input.wallMin),
    wallMax: Number(input.wallMax),
  };
}

/**
 * 校验一组限值是否可用。对应交互逻辑 C3 / C4 / E6。
 */
export function validateLimits(limits) {
  const values = [limits.outerMin, limits.outerMax, limits.wallMin, limits.wallMax];
  if (values.some((v) => !Number.isFinite(v))) {
    return { level: 'block', messages: ['限值必须为数字'] };
  }
  if (limits.outerMin >= limits.outerMax) {
    return {
      level: 'block',
      messages: [`外径下限应小于上限，当前填写为下限 ${limits.outerMin}、上限 ${limits.outerMax}`],
    };
  }
  if (limits.wallMin <= 0 || limits.wallMax <= 0) {
    return { level: 'block', messages: ['壁厚限值必须为正数'] };
  }
  const messages = [];
  if (limits.outerMax - limits.outerMin < 0.01) {
    messages.push('外径公差区间小于 0.01，请确认是否填写正确');
  }
  if (limits.outerMin === limits.outerMax) {
    messages.push('外径上下限相同，将按单点限值判定');
  }
  return { level: messages.length ? 'warning' : 'ok', messages };
}

/** 统计两个限值组是否相同，用于判断该周是否受标准变化影响 */
export function sameLimits(a, b) {
  return (
    a.outerMin === b.outerMin &&
    a.outerMax === b.outerMax &&
    a.wallMin === b.wallMin &&
    a.wallMax === b.wallMax
  );
}
