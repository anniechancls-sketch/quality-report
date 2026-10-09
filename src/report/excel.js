import { buildXlsx } from '../core/ooxml/xlsx.js';
import { judgeRow } from '../core/judge.js';

function anomalySheet(dataset, metrics) {
  const rows = [['周次', '箱/扎', '平均外径', '最小壁厚', '最大壁厚', '超限类型', '判定翻转', '备注原文', '处置归类']];
  dataset.weeks.forEach((week, wi) => {
    const metric = metrics.weeks[wi];
    week.rows.forEach((row) => {
      const current = judgeRow(row, week.limits);
      if (current.pass) return;
      const unified = judgeRow(row, metrics.basisLimits);
      rows.push([
        week.label,
        row.boxNo ?? '',
        row.outerDiameter,
        row.minWall,
        row.maxWall,
        current.issues.join(' / '),
        current.pass === unified.pass ? '否' : '是',
        row.remark || '',
        categorize(row.remark),
      ]);
    });
  });
  return rows;
}

const CATEGORIES = [
  ['已反馈班组追溯', ['已反馈', '反馈班组']],
  ['追溯后合格', ['追溯', '合格']],
  ['追溯报废', ['报废']],
];

function categorize(remark) {
  const text = String(remark || '');
  if (!text) return '';
  const hits = CATEGORIES.filter(([, keys]) => keys.every((k) => text.includes(k))).map(([name]) => name);
  return hits.join('、');
}

function rawSheet(dataset, metrics) {
  const rows = [['周次', '抽检日期', '箱/扎', '平均外径', '最小壁厚', '最大壁厚', '当期限值', '当期判定', '统一判定', '人工判定', '备注']];
  dataset.weeks.forEach((week, wi) => {
    week.rows.forEach((row) => {
      const current = judgeRow(row, week.limits);
      const unified = judgeRow(row, metrics.basisLimits);
      rows.push([
        week.label,
        week.date,
        row.boxNo ?? '',
        Number.isFinite(row.outerDiameter) ? row.outerDiameter : '',
        Number.isFinite(row.minWall) ? row.minWall : '',
        Number.isFinite(row.maxWall) ? row.maxWall : '',
        `${week.limits.outerMin}-${week.limits.outerMax} / >=${week.limits.wallMin} / <=${week.limits.wallMax}`,
        current.pass ? '合格' : current.issues.join('/'),
        unified.pass ? '合格' : unified.issues.join('/'),
        row.verdictManual === null || row.verdictManual === undefined ? '—' : row.verdictManual ? '合格' : '异常',
        row.remark || '',
      ]);
    });
  });
  return rows;
}

/** 生成 Excel 报告：总览指标、周间对比、异常明细、原始明细四个工作表 */
export function buildExcelReport(model, dataset, metrics) {
  return buildXlsx([
    { name: '总览指标', rows: model.kpiRows },
    { name: '周间对比', rows: model.compareRows },
    { name: '异常明细', rows: anomalySheet(dataset, metrics) },
    { name: '原始明细', rows: rawSheet(dataset, metrics) },
  ]);
}
