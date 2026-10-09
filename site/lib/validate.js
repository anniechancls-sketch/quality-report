import { judgeRow, validateLimits } from './judge.js';
import { isValidRow } from './metrics.js';

/**
 * 判定复算一致率：算法判定与人工判定逐条比对。
 * 对应测试用例 TC-D08 与 M2 校验项 6。
 */
export function checkRecomputeConsistency(weeks) {
  let total = 0;
  let comparable = 0;
  let matched = 0;
  const mismatches = [];

  for (const week of weeks) {
    for (let i = 0; i < week.rows.length; i += 1) {
      const row = week.rows[i];
      total += 1;
      if (row.verdictManual === null || row.verdictManual === undefined) continue;
      if (!isValidRow(row)) continue;
      comparable += 1;
      const { pass } = judgeRow(row, week.limits);
      if (pass === row.verdictManual) matched += 1;
      else mismatches.push({ week: week.label, boxNo: row.boxNo, rowIndex: i });
    }
  }

  return {
    total,
    comparable,
    matched,
    mismatches,
    rate: comparable ? matched / comparable : null,
  };
}

/**
 * 数据质量校验。返回阻断级与警告级问题清单。
 * 对应交互逻辑 P1 字段校验规则表与提示文案 C2–C8。
 */
export function validateDataset(weeks, rules) {
  const blocking = [];
  const warnings = [];
  const labels = new Set();

  for (const week of weeks) {
    if (labels.has(week.label)) {
      blocking.push(`周次标签「${week.label}」已被其他文件使用`);
    }
    labels.add(week.label);

    const limitCheck = validateLimits(week.limits);
    if (limitCheck.level === 'block') {
      blocking.push(`${week.label}：${limitCheck.messages.join('；')}`);
    } else if (limitCheck.level === 'warning') {
      warnings.push(`${week.label}：${limitCheck.messages.join('；')}`);
    }

    const invalidRows = week.rows.filter((r) => !isValidRow(r));
    if (invalidRows.length) {
      warnings.push(`${week.label}：有 ${invalidRows.length} 行数值缺失，已排除计算`);
    }

    const boxNos = new Set();
    let duplicates = 0;
    for (const row of week.rows) {
      if (row.boxNo === null || row.boxNo === undefined) continue;
      if (boxNos.has(row.boxNo)) duplicates += 1;
      boxNos.add(row.boxNo);
    }
    if (duplicates) warnings.push(`${week.label}：存在 ${duplicates} 行重复的箱/扎序号`);
  }

  const consistency = checkRecomputeConsistency(weeks);
  if (consistency.comparable && consistency.mismatches.length) {
    warnings.push(
      `判定复算一致率为 ${(consistency.rate * 100).toFixed(1)}%，存在 ${consistency.mismatches.length} 条不一致记录，请核对限值与列映射`,
    );
  }

  const smallWeeks = weeks.filter(
    (w) => w.rows.length > 0 && w.rows.length < rules.smallSampleThreshold,
  );
  for (const w of smallWeeks) {
    warnings.push(`${w.label}仅 ${w.rows.length} 条记录，样本量不足，结论仅供参考`);
  }

  return {
    level: blocking.length ? 'block' : warnings.length ? 'warning' : 'ok',
    blocking,
    warnings,
    consistency,
    smallWeeks: smallWeeks.map((w) => w.label),
  };
}
