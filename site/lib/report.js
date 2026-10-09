import { judgeRow } from './judge.js';
import { describeScrap } from './remarks.js';
import { buildDocx } from './docx.js';
import { buildXlsx } from './xlsx.js';

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const ppText = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}pp`;
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function formatTime(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

function fmtRange(ci) {
  return ci ? `${pct(ci[0])} – ${pct(ci[1])}` : '—';
}

/** 组装报告模型。数值全部来自 core 计算结果，本模块不做新的推算。 */
export function buildReportModel({ dataset, metrics, comparisons, remarks, basisMode, rules, validation, narrative = null, generatedAt = new Date() }) {
  const weeks = metrics.weeks;
  const labels = weeks.map((w) => w.label);
  const pick = (w) => (basisMode === 'current' ? w.current : w.unified);
  const ranked = weeks.slice().sort((a, b) => pick(b).rate - pick(a).rate);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const effective = comparisons.filter((c) => c.verdict !== 'flat');
  const flat = comparisons.filter((c) => c.verdict === 'flat');
  const changed = weeks.filter((w) => w.flips > 0);
  const topType = Object.entries(metrics.byTypeTotal).sort((a, b) => b[1] - a[1]).filter(([, v]) => v > 0)[0];

  const summary = [];
  summary.push(
    `本次分析覆盖 ${weeks.length} 个抽检周次、${metrics.totalN} 条记录，展示口径为${basisMode === 'current' ? '当期口径' : '统一口径'}。合格率区间 ${pct(Math.min(...weeks.map((w) => pick(w).rate)))} – ${pct(Math.max(...weeks.map((w) => pick(w).rate)))}。`,
  );
  summary.push(`合格率最高为 ${best.label} ${pct(pick(best).rate)}（n=${pick(best).n}），最低为 ${worst.label} ${pct(pick(worst).rate)}（n=${pick(worst).n}）。`);
  if (effective.length) {
    summary.push(
      `统一口径下共有 ${effective.length} 组周对落在置信区间之外：${effective.map((c) => `${c.from}→${c.to} ${ppText(c.delta)}（${c.verdict === 'up' ? '上升' : '下降'}）`).join('；')}。`,
    );
  } else {
    summary.push('统一口径下没有周对的置信区间落在彼此之外，因此不存在可判定的有效变化。');
  }
  if (flat.length) summary.push(`${flat.map((c) => `${c.from}→${c.to}`).join('、')} 的差异落在抽样波动范围内，不构成有效变化。`);
  if (changed.length) {
    summary.push(`标准变化影响：${changed.map((w) => `${w.label} ${w.flips} 条`).join('、')}，合计 ${metrics.flipsTotal} 条记录的判定发生翻转。`);
  } else {
    summary.push('各周当期口径与统一口径判定一致，无翻转记录。');
  }
  if (topType) summary.push(`异常按记录级计 ${metrics.totalAnomalyRecords} 条，按指标级计 ${metrics.anomalyItemsTotal} 项，其中${topType[0]} ${topType[1]} 项。`);

  const kpiRows = [
    ['周次', '抽检日期', '样本量', '当期合格率', '统一合格率', '异常率', '平均外径', 'Cp', 'Cpk', '判定翻转'],
    ...weeks.map((w) => [
      w.small ? `${w.label} *` : w.label,
      w.date,
      w.current.n,
      pct(w.current.rate),
      pct(w.unified.rate),
      pct(w.current.anomalyRecords / (w.current.n || 1)),
      w.current.meanOuter.toFixed(3),
      w.current.cp === null ? '—' : w.current.cp.toFixed(2),
      w.current.cpk === null ? '—' : w.current.cpk.toFixed(2),
      w.flips || '—',
    ]),
    ['合计', '', metrics.totalN, pct(metrics.totalPass / metrics.totalN), '', pct(metrics.totalAnomalyRecords / metrics.totalN), '', '', '', metrics.flipsTotal],
  ];

  const compareRows = [
    ['对比', '当期口径差', '标准变化（当期 − 统一）', '统一口径差', '甲周 95% 区间', '乙周 95% 区间', '结论'],
    ...comparisons.map((c) => [
      `${c.from} → ${c.to}`,
      ppText(c.toCurrentRate - c.fromCurrentRate),
      `${ppText(c.standardShiftFrom)} / ${ppText(c.standardShiftTo)}`,
      ppText(c.delta),
      fmtRange(c.fromCi),
      fmtRange(c.toCi),
      c.verdict === 'flat' ? '无有效变化（在抽样波动范围内）' : c.verdict === 'up' ? '有效上升' : '有效下降',
    ]),
  ];

  const anomalyRows = [
    ['异常类型', '记录级计数', '指标级计数'],
    ...rules.anomalyTypes.map((t) => [t, metrics.byTypeTotal[t], metrics.byTypeTotal[t]]),
    ['合计', metrics.totalAnomalyRecords, metrics.anomalyItemsTotal],
  ];

  const remarkRows = [['处置类型', '备注条数'], ...Object.entries(remarks.counts).map(([k, v]) => [k, v]), ['合计（非空备注）', remarks.total]];

  const detailRows = buildDetailRows(dataset, metrics, basisMode);

  const supported = [];
  supported.push(`合格率最高周次为 ${best.label}（${pct(pick(best).rate)}），最低为 ${worst.label}（${pct(pick(worst).rate)}）。`);
  if (topType) supported.push(`异常以${topType[0]}为主，按指标级计 ${topType[1]} 项。`);
  const c = validation?.consistency;
  supported.push(`判定复算一致率为 ${c && c.rate !== null && c.rate !== undefined ? `${(c.rate * 100).toFixed(1)}%` : '不适用'}，报告中的判定结果可由原始数值完全复现。`);

  const insufficient = [];
  if (metrics.smallWeeks.length) {
    insufficient.push(`${metrics.smallWeeks.map((w) => `${w.label}（${w.current.n} 条）`).join('、')}样本量低于 ${rules.smallSampleThreshold} 条，相关结论仅供参考。`);
  }
  insufficient.push(`${weeks[0].label}无备注列，其 ${weeks[0].current.anomalyRecords} 条异常缺少处置记录，无法确认现场处置情况。`);
  insufficient.push(describeScrap(remarks));
  insufficient.push('对于异常集中出现的箱/扎序号，现有数据不足以支撑根因判断：数据不足，无法确认原因。');

  return {
    title: '质量数据分析报告',
    generatedAt,
    basisMode,
    basisLimits: metrics.basisLimits,
    head: {
      coverWeeks: `${labels[0]} – ${labels[labels.length - 1]}`,
      dates: `${weeks[0].date} 至 ${weeks[weeks.length - 1].date}`,
      totalN: metrics.totalN,
      generatedAtText: formatTime(generatedAt),
      basis: `${basisMode === 'current' ? '当期口径' : '统一口径'}｜统一基准：外径 ${metrics.basisLimits.outerMin}–${metrics.basisLimits.outerMax}，最小壁厚 ≥${metrics.basisLimits.wallMin}，最大壁厚 ≤${metrics.basisLimits.wallMax}`,
      standardChanged: changed.map((w) => `${w.label}（限值 ${w.limits.outerMin}–${w.limits.outerMax} / ≥${w.limits.wallMin} / ≤${w.limits.wallMax}）`),
      validation,
    },
    summary: summary.slice(0, 5),
    narrative,
    kpiRows,
    compareRows,
    anomalyRows,
    pareto: rules.anomalyTypes.map((t) => ({ type: t, count: metrics.byTypeTotal[t] })).filter((i) => i.count > 0).sort((a, b) => b.count - a.count),
    remarkRows,
    supported,
    insufficient,
    limitsTable: [
      ['周次', '外径下限', '外径上限', '最小壁厚下限', '最大壁厚上限', '与统一基准是否一致'],
      ...weeks.map((w) => [w.label, w.limits.outerMin, w.limits.outerMax, w.limits.wallMin, w.limits.wallMax, w.standardChanged ? '不一致' : '一致']),
    ],
    detailRows,
  };
}

function buildDetailRows(dataset, metrics, basisMode) {
  const rows = [['周次', '箱/扎', '平均外径', '最小壁厚', '最大壁厚', '当期判定', '统一判定', '人工判定', '备注']];
  dataset.weeks.forEach((week) => {
    week.rows.forEach((row) => {
      const current = judgeRow(row, week.limits);
      const unified = judgeRow(row, metrics.basisLimits);
      rows.push([
        week.label,
        row.boxNo ?? '',
        Number.isFinite(row.outerDiameter) ? row.outerDiameter.toFixed(3) : '缺失',
        Number.isFinite(row.minWall) ? row.minWall.toFixed(3) : '缺失',
        Number.isFinite(row.maxWall) ? row.maxWall.toFixed(3) : '缺失',
        current.pass ? '合格' : current.issues.join('/'),
        unified.pass ? '合格' : unified.issues.join('/'),
        row.verdictManual === null || row.verdictManual === undefined ? '—' : row.verdictManual ? '合格' : '异常',
        row.remark || '',
      ]);
    });
  });
  void basisMode;
  return rows;
}

/* ---------- 图表 SVG 与位图化 ---------- */

export function rateTrendSvg({ labels, rates, otherRates, band, smallFlags, width = 1200, height = 420 }) {
  const P = { l: 90, r: 40, t: 30, b: 60 };
  const iw = width - P.l - P.r;
  const ih = height - P.t - P.b;
  const pool = [...rates, ...otherRates];
  band.forEach((b) => b && pool.push(b[0], b[1]));
  const lo = Math.max(0, Math.min(...pool) - 0.08);
  const hi = Math.min(1, Math.max(...pool) + 0.08);
  const X = (i) => P.l + (labels.length < 2 ? iw / 2 : (i * iw) / (labels.length - 1));
  const Y = (v) => P.t + ih - ((v - lo) / (hi - lo || 1)) * ih;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#ffffff"/>`;
  for (let t = 0; t <= 4; t += 1) {
    const y = P.t + (ih * t) / 4;
    svg += `<line x1="${P.l}" y1="${y}" x2="${width - P.r}" y2="${y}" stroke="#EBEEF5"/><text x="${P.l - 12}" y="${y + 5}" font-size="16" fill="#909399" text-anchor="end" font-family="Microsoft YaHei,Arial">${pct(hi - ((hi - lo) * t) / 4)}</text>`;
  }
  let bandPts = '';
  band.forEach((b, i) => { if (b) bandPts += `${X(i)},${Y(b[1])} `; });
  for (let i = band.length - 1; i >= 0; i -= 1) { const b = band[i]; if (b) bandPts += `${X(i)},${Y(b[0])} `; }
  if (bandPts) svg += `<polygon points="${bandPts.trim()}" fill="#409EFF" opacity="0.16"/>`;
  svg += `<path d="${otherRates.map((v, i) => `${i ? 'L' : 'M'}${X(i)},${Y(v)}`).join(' ')}" fill="none" stroke="#A0CFFF" stroke-width="2.5" stroke-dasharray="8 5"/>`;
  svg += `<path d="${rates.map((v, i) => `${i ? 'L' : 'M'}${X(i)},${Y(v)}`).join(' ')}" fill="none" stroke="#409EFF" stroke-width="4"/>`;
  rates.forEach((v, i) => {
    svg += smallFlags[i]
      ? `<circle cx="${X(i)}" cy="${Y(v)}" r="7" fill="#fff" stroke="#409EFF" stroke-width="3" stroke-dasharray="3 3"/>`
      : `<circle cx="${X(i)}" cy="${Y(v)}" r="6" fill="#409EFF"/>`;
    svg += `<text x="${X(i)}" y="${Y(v) - 18}" font-size="17" fill="#303133" text-anchor="middle" font-family="Microsoft YaHei,Arial">${pct(v)}</text>`;
    svg += `<text x="${X(i)}" y="${height - 24}" font-size="17" fill="#606266" text-anchor="middle" font-family="Microsoft YaHei,Arial">${esc(labels[i])}${smallFlags[i] ? ' *' : ''}</text>`;
  });
  svg += `<text x="${P.l}" y="${height - 6}" font-size="14" fill="#909399" font-family="Microsoft YaHei,Arial">实线为当前口径，浅色虚线为对照口径，阴影为 95% 置信区间；* 表示样本量不足</text></svg>`;
  return svg;
}

export function paretoSvg(items, { width = 1200, height = 420 } = {}) {
  const P = { l: 90, r: 90, t: 30, b: 70 };
  const iw = width - P.l - P.r;
  const ih = height - P.t - P.b;
  const max = Math.max(...items.map((i) => i.count), 1);
  const total = items.reduce((s, i) => s + i.count, 0) || 1;
  let acc = 0;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#ffffff"/>`;
  for (let t = 0; t <= 4; t += 1) {
    const y = P.t + (ih * t) / 4;
    svg += `<line x1="${P.l}" y1="${y}" x2="${width - P.r}" y2="${y}" stroke="#EBEEF5"/><text x="${P.l - 12}" y="${y + 5}" font-size="16" fill="#909399" text-anchor="end" font-family="Microsoft YaHei,Arial">${Math.round(max - (max * t) / 4)}</text><text x="${width - P.r + 12}" y="${y + 5}" font-size="16" fill="#909399" font-family="Microsoft YaHei,Arial">${100 - 25 * t}%</text>`;
  }
  const bw = Math.min(120, (iw / items.length) * 0.5);
  const pts = [];
  items.forEach((it, i) => {
    const x = P.l + (iw * (i + 0.5)) / items.length;
    const h = (it.count / max) * ih;
    const y = P.t + ih - h;
    svg += `<rect x="${x - bw / 2}" y="${y}" width="${bw}" height="${h}" rx="3" fill="#409EFF" opacity="0.88"/>`;
    svg += `<text x="${x}" y="${y - 10}" font-size="18" fill="#303133" text-anchor="middle" font-family="Microsoft YaHei,Arial">${it.count}</text>`;
    svg += `<text x="${x}" y="${height - 34}" font-size="17" fill="#606266" text-anchor="middle" font-family="Microsoft YaHei,Arial">${esc(it.type)}</text>`;
    acc += it.count;
    pts.push([x, P.t + ih - (acc / total) * ih]);
  });
  if (pts.length > 1) svg += `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ')}" fill="none" stroke="#E6A23C" stroke-width="3"/>`;
  pts.forEach((p) => { svg += `<circle cx="${p[0]}" cy="${p[1]}" r="5" fill="#E6A23C"/>`; });
  return `${svg}</svg>`;
}

/** 把 SVG 转成 PNG（用于嵌入 Word）。浏览器端通过 canvas 完成，失败时返回 null。 */
export async function svgToPng(svg, width, height) {
  try {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('图表渲染失败'));
      el.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width * 2;
    canvas.height = height * 2;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!pngBlob) return null;
    return new Uint8Array(await pngBlob.arrayBuffer());
  } catch {
    return null;
  }
}

/* ---------- Word ---------- */

export async function buildWordReport(model, charts = {}) {
  const blocks = [];
  blocks.push({ type: 'title', text: model.title });
  blocks.push({ type: 'para', text: `生成时间：${model.head.generatedAtText}　｜　覆盖周次：${model.head.coverWeeks}　｜　抽检日期：${model.head.dates}　｜　样本量：${model.head.totalN} 条` });
  blocks.push({ type: 'para', text: `口径说明：${model.head.basis}` });

  blocks.push({ type: 'heading', text: '一、执行摘要' });
  if (model.narrative) {
    model.narrative.split('\n').filter((l) => l.trim()).forEach((line) => {
      blocks.push(/^【.*】$/.test(line.trim()) ? { type: 'heading', level: 2, text: line.trim() } : { type: 'para', text: line });
    });
  } else {
    model.summary.forEach((s) => blocks.push({ type: 'bullet', text: s }));
  }

  blocks.push({ type: 'heading', text: '二、关键指标总览' });
  if (charts.ratePng) {
    blocks.push({ type: 'image', name: 'rate-trend.png', data: charts.ratePng, relId: 'rIdImage1' });
    blocks.push({ type: 'para', text: '图 1 合格率趋势（含 95% 置信区间，带 * 的周次为样本量不足）' });
  }
  blocks.push({ type: 'table', rows: model.kpiRows, widths: [0.09, 0.13, 0.08, 0.11, 0.11, 0.09, 0.12, 0.08, 0.08, 0.11] });
  blocks.push({ type: 'para', text: '注：* 表示该周样本量不足；判定翻转指当期口径与统一口径判定结果不一致的记录数。' });

  blocks.push({ type: 'heading', text: '三、周间差异对比' });
  blocks.push({ type: 'para', text: '差异拆成三列：数值变化（统一口径下两周之差，可比）、标准变化（该周当期与统一口径之差）、抽样波动（两周置信区间是否重叠）。' });
  blocks.push({ type: 'table', rows: model.compareRows, widths: [0.14, 0.11, 0.17, 0.11, 0.15, 0.15, 0.17] });
  if (model.head.standardChanged.length) blocks.push({ type: 'para', text: `标准变化提示：${model.head.standardChanged.join('；')}。` });

  blocks.push({ type: 'heading', text: '四、异常结构分析' });
  if (charts.paretoPng) {
    blocks.push({ type: 'image', name: 'pareto.png', data: charts.paretoPng, relId: 'rIdImage2' });
    blocks.push({ type: 'para', text: '图 2 异常类型帕累托' });
  }
  blocks.push({ type: 'table', rows: model.anomalyRows, widths: [0.4, 0.3, 0.3] });
  blocks.push({ type: 'para', text: '注：记录级合计为存在超限的记录数，指标级合计按涉及的指标项分别累计，两者口径不同。' });
  blocks.push({ type: 'heading', level: 2, text: '备注与处置分布' });
  blocks.push({ type: 'table', rows: model.remarkRows, widths: [0.6, 0.4] });

  blocks.push({ type: 'heading', text: '五、结论与建议' });
  blocks.push({ type: 'heading', level: 2, text: '数据支持的结论' });
  model.supported.forEach((s) => blocks.push({ type: 'bullet', text: s }));
  blocks.push({ type: 'heading', level: 2, text: '数据不足、待现场核实的事项' });
  model.insufficient.forEach((s) => blocks.push({ type: 'bullet', text: s }));

  blocks.push({ type: 'pagebreak' });
  blocks.push({ type: 'heading', text: '附录 A　判定规则与口径说明' });
  blocks.push({ type: 'para', text: '判定规则：平均外径须落在当期限值区间内；最小壁厚须不小于壁厚下限；最大壁厚须不大于壁厚上限。三项全部满足判为合格，否则按超限方向归类，一条记录可同时命中多项。' });
  const c = model.head.validation?.consistency;
  blocks.push({ type: 'para', text: `判定复算一致率：${c && c.rate !== null && c.rate !== undefined ? `${(c.rate * 100).toFixed(1)}%（可比对 ${c.comparable} 条）` : '不适用（本期无人工判定列）'}。` });
  blocks.push({ type: 'para', text: `口径说明：${model.head.basis}。报告中的差异与结论一律以统一口径为准；当期口径仅用于描述单周自身结果。` });
  blocks.push({ type: 'table', rows: model.limitsTable, widths: [0.1, 0.18, 0.18, 0.2, 0.2, 0.14] });

  blocks.push({ type: 'pagebreak' });
  blocks.push({ type: 'heading', text: '附录 B　各周抽检明细' });
  blocks.push({ type: 'table', rows: model.detailRows, widths: [0.07, 0.07, 0.12, 0.12, 0.12, 0.14, 0.14, 0.09, 0.13] });

  return buildDocx(blocks, { title: model.title });
}

/* ---------- Excel ---------- */

const CATEGORIES = [
  ['已反馈班组追溯', ['已反馈', '反馈班组']],
  ['追溯后合格', ['追溯', '合格']],
  ['追溯报废', ['报废']],
];

function categorize(remark) {
  const text = String(remark || '');
  if (!text) return '';
  return CATEGORIES.filter(([, keys]) => keys.every((k) => text.includes(k))).map(([name]) => name).join('、');
}

function anomalySheet(dataset, metrics) {
  const rows = [['周次', '箱/扎', '平均外径', '最小壁厚', '最大壁厚', '超限类型', '判定翻转', '备注原文', '处置归类']];
  dataset.weeks.forEach((week) => {
    week.rows.forEach((row) => {
      const current = judgeRow(row, week.limits);
      if (current.pass) return;
      const unified = judgeRow(row, metrics.basisLimits);
      rows.push([week.label, row.boxNo ?? '', row.outerDiameter, row.minWall, row.maxWall, current.issues.join(' / '), current.pass === unified.pass ? '否' : '是', row.remark || '', categorize(row.remark)]);
    });
  });
  return rows;
}

function rawSheet(dataset, metrics) {
  const rows = [['周次', '抽检日期', '箱/扎', '平均外径', '最小壁厚', '最大壁厚', '当期限值', '当期判定', '统一判定', '人工判定', '备注']];
  dataset.weeks.forEach((week) => {
    week.rows.forEach((row) => {
      const current = judgeRow(row, week.limits);
      const unified = judgeRow(row, metrics.basisLimits);
      rows.push([
        week.label, week.date, row.boxNo ?? '',
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

export async function buildExcelReport(model, dataset, metrics) {
  return buildXlsx([
    { name: '总览指标', rows: model.kpiRows },
    { name: '周间对比', rows: model.compareRows },
    { name: '异常明细', rows: anomalySheet(dataset, metrics) },
    { name: '原始明细', rows: rawSheet(dataset, metrics) },
  ]);
}
