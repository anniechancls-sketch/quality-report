import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildReportModel } from './model.js';
import { buildWordReport } from './word.js';
import { buildExcelReport } from './excel.js';
import { buildPdfReport } from './pdf.js';
import { renderHtmlToPng } from './browser.js';
import { rateTrendHtml, paretoHtml, rateTrendSvg, paretoSvg } from './charts.js';

const pad = (n) => String(n).padStart(2, '0');

export function fileStamp(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function chartOptions(metrics, basisMode) {
  const pick = (w) => (basisMode === 'current' ? w.current : w.unified);
  const other = (w) => (basisMode === 'current' ? w.unified : w.current);
  return {
    labels: metrics.weeks.map((w) => w.label),
    rates: metrics.weeks.map((w) => pick(w).rate),
    otherRates: metrics.weeks.map((w) => other(w).rate),
    band: metrics.weeks.map((w) => pick(w).ci),
    smallFlags: metrics.weeks.map((w) => w.small),
  };
}

/**
 * 导出报告。返回 { model, files }，files 中每项含 format / name / path / size / ok / error。
 * 单一格式失败不影响其他格式。
 */
export function exportReports({
  dataset,
  metrics,
  comparisons,
  remarks,
  basisMode = 'current',
  rules,
  narrative = null,
  validation = null,
  formats = ['word', 'excel', 'pdf'],
  outDir,
  generatedAt = new Date(),
}) {
  const model = buildReportModel({
    dataset,
    metrics,
    comparisons,
    remarks,
    basisMode,
    rules,
    generatedAt,
    validation,
    narrative,
  });

  mkdirSync(outDir, { recursive: true });
  const stamp = fileStamp(generatedAt);
  const scope = `${metrics.weeks[0].label}-${metrics.weeks[metrics.weeks.length - 1].label}`;
  const files = [];

  const chartCfg = chartOptions(metrics, basisMode);
  const paretoItems = model.pareto;

  if (formats.includes('word')) {
    try {
      const ratePng = renderHtmlToPng(rateTrendHtml(chartCfg), { width: 1200, height: 420 });
      const paretoPng = paretoItems.length
        ? renderHtmlToPng(paretoHtml(paretoItems), { width: 1200, height: 420 })
        : null;
      const buf = buildWordReport(model, { ratePng, paretoPng });
      const name = `质量数据分析报告_${scope}_${stamp}.docx`;
      const path = join(outDir, name);
      writeFileSync(path, buf);
      files.push({ format: 'word', name, path, size: statSync(path).size, ok: true });
    } catch (error) {
      files.push({ format: 'word', name: `质量数据分析报告_${scope}_${stamp}.docx`, ok: false, error: error.message });
    }
  }

  if (formats.includes('excel')) {
    try {
      const buf = buildExcelReport(model, dataset, metrics);
      const name = `质量数据分析数据表_${scope}_${stamp}.xlsx`;
      const path = join(outDir, name);
      writeFileSync(path, buf);
      files.push({ format: 'excel', name, path, size: statSync(path).size, ok: true });
    } catch (error) {
      files.push({ format: 'excel', name: `质量数据分析数据表_${scope}_${stamp}.xlsx`, ok: false, error: error.message });
    }
  }

  if (formats.includes('pdf')) {
    const name = `质量数据分析报告_${scope}_${stamp}.pdf`;
    const path = join(outDir, name);
    try {
      const ok = buildPdfReport(
        model,
        {
          rateSvg: rateTrendSvg(chartCfg),
          paretoSvg: paretoItems.length ? paretoSvg(paretoItems) : null,
        },
        path,
      );
      if (!ok) throw new Error('未检测到可用浏览器，无法生成 PDF');
      files.push({ format: 'pdf', name, path, size: statSync(path).size, ok: true });
    } catch (error) {
      files.push({ format: 'pdf', name, path, ok: false, error: error.message });
    }
  }

  return { model, files };
}
