import { printHtmlToPdf } from './browser.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function table(rows, className = '') {
  if (!rows.length) return '';
  const head = rows[0];
  const body = rows.slice(1);
  return `<table class="${className}"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

function list(items) {
  return `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
}

export function buildPdfHtml(model, charts = {}) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(model.title)}</title><style>
  @page { size: A4; margin: 16mm 14mm; }
  body { font-family: "Microsoft YaHei", Arial, sans-serif; color:#303133; font-size:12.5px; line-height:1.75; }
  h1 { font-size:22px; margin:0 0 6px; }
  h2 { font-size:15px; margin:22px 0 8px; border-left:3px solid #409EFF; padding-left:8px; }
  h3 { font-size:13px; margin:14px 0 6px; }
  .meta { color:#606266; font-size:12px; margin-bottom:4px; }
  .basis { color:#606266; font-size:12px; margin-bottom:14px; }
  table { width:100%; border-collapse:collapse; margin:8px 0 12px; font-size:11px; }
  th,td { border:1px solid #DCDFE6; padding:5px 7px; text-align:left; }
  th { background:#F5F7FA; }
  ul { margin:6px 0 12px 18px; padding:0; }
  li { margin-bottom:3px; }
  .note { color:#909399; font-size:11px; }
  .chart { width:100%; margin:6px 0 4px; }
  .pagebreak { page-break-before: always; }
  </style></head><body>
  <h1>${esc(model.title)}</h1>
  <div class="meta">生成时间：${esc(model.head.generatedAtText)}　｜　覆盖周次：${esc(model.head.coverWeeks)}　｜　抽检日期：${esc(model.head.dates)}　｜　样本量：${esc(model.head.totalN)} 条</div>
  <div class="basis">口径说明：${esc(model.head.basis)}</div>
  <h2>一、执行摘要</h2>
  ${model.narrative ? `<div style="white-space:pre-wrap">${esc(model.narrative)}</div>` : list(model.summary)}
  <h2>二、关键指标总览</h2>
  ${charts.rateSvg ? `<div class="chart">${charts.rateSvg}</div>` : ''}
  ${table(model.kpiRows)}
  <div class="note">* 表示该周样本量不足；判定翻转指当期口径与统一口径结果不一致的记录数。</div>
  <h2>三、周间差异对比</h2>
  ${table(model.compareRows)}
  ${model.head.standardChanged.length ? `<div class="note">标准变化提示：${esc(model.head.standardChanged.join('；'))}。</div>` : ''}
  <h2>四、异常结构分析</h2>
  ${charts.paretoSvg ? `<div class="chart">${charts.paretoSvg}</div>` : ''}
  ${table(model.anomalyRows)}
  <div class="note">记录级合计为存在超限的记录数，指标级合计按指标项分别累计，两者口径不同。</div>
  <h3>备注与处置分布</h3>
  ${table(model.remarkRows)}
  <h2>五、结论与建议</h2>
  <h3>数据支持的结论</h3>${list(model.supported)}
  <h3>数据不足、待现场核实的事项</h3>${list(model.insufficient)}
  <div class="pagebreak"></div>
  <h2>附录 A　判定规则与口径说明</h2>
  <p>判定规则：平均外径须落在当期限值区间内；最小壁厚须不小于壁厚下限；最大壁厚须不大于壁厚上限。三项全部满足判为合格。</p>
  <p>${esc(model.head.basis)}。报告中的差异与结论一律以统一口径为准；当期口径仅用于描述单周自身结果。</p>
  ${table(model.limitsTable)}
  <div class="pagebreak"></div>
  <h2>附录 B　各周抽检明细</h2>
  ${table(model.detailRows)}
  </body></html>`;
}

export function buildPdfReport(model, charts, outPath) {
  return printHtmlToPdf(buildPdfHtml(model, charts), outPath);
}
