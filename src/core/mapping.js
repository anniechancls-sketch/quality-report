import { normalizeLimits } from './judge.js';

/**
 * 数值转换。允许带单位后缀（如 "31.756mm"），能提取则提取并给出警告；
 * 完全无法提取时返回 null，由调用方计入问题行。
 * 对应测试用例 TC-X07 与交互逻辑 P1 字段校验规则。
 */
export function toNumber(value) {
  if (value === null || value === undefined || value === '') return { value: null, warning: null };
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { value, warning: null } : { value: null, warning: '数值无效' };
  }
  const text = String(value).trim();
  if (!text) return { value: null, warning: null };
  const direct = Number(text);
  if (Number.isFinite(direct)) return { value: direct, warning: null };
  const match = text.match(/-?\d+(\.\d+)?/);
  if (match) {
    return { value: Number(match[0]), warning: `「${text}」含非数值内容，已按 ${match[0]} 处理` };
  }
  return { value: null, warning: `「${text}」无法解析为数值` };
}

/** 人工判定列：合格 / 异常；留空记 null，表示本期无人工判定可比对 */
export function toVerdict(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return text === '合格';
}

/**
 * 把一张已解析的表格按列映射转成周次结构。
 * 输入：rows 为二维字符串数组，mapping 为字段到列下标的映射。
 */
export function buildWeek(input) {
  const {
    label,
    date,
    limits,
    rows,
    headerRowIndex = 0,
    mapping,
    sheetName = '',
  } = input;

  const warnings = [];
  const dataRows = rows.slice(headerRowIndex + 1);
  const parsedRows = [];

  dataRows.forEach((cells, i) => {
    const sourceRow = headerRowIndex + 2 + i;
    const boxRaw = mapping.boxNo === null || mapping.boxNo === undefined ? null : cells[mapping.boxNo];
    const outer = toNumber(mapping.outerDiameter === null ? null : cells[mapping.outerDiameter]);
    const minWall = toNumber(mapping.minWall === null ? null : cells[mapping.minWall]);
    const maxWall = toNumber(mapping.maxWall === null ? null : cells[mapping.maxWall]);
    const verdict =
      mapping.verdict === null || mapping.verdict === undefined
        ? null
        : toVerdict(cells[mapping.verdict]);
    const remark =
      mapping.remark === null || mapping.remark === undefined
        ? ''
        : String(cells[mapping.remark] ?? '').trim();

    for (const w of [outer.warning, minWall.warning, maxWall.warning]) {
      if (w) warnings.push({ sourceRow, message: w });
    }

    parsedRows.push({
      sourceRow,
      boxNo: boxRaw === null || boxRaw === '' ? null : Number(boxRaw),
      boxNoRaw: boxRaw,
      outerDiameter: outer.value,
      minWall: minWall.value,
      maxWall: maxWall.value,
      verdictManual: verdict,
      remark,
    });
  });

  return {
    label,
    date: date || '',
    sheetName,
    limits: normalizeLimits(limits),
    rows: parsedRows,
    warnings,
  };
}

export function buildDataset(weekInputs) {
  const weeks = weekInputs.map(buildWeek);
  return {
    weeks,
    warnings: weeks.flatMap((w) => w.warnings.map((x) => ({ week: w.label, ...x }))),
  };
}
