import { RULES } from './lib/rules.js';
import { parseCsv, readHeader, suggestMapping } from './lib/csv.js';
import { readXlsx } from './lib/xlsx.js';
import { buildWeek } from './lib/mapping.js';
import { judgeRow } from './lib/judge.js';
import { buildMetrics } from './lib/metrics.js';
import { buildComparisons, selectPairs, buildSnapshot } from './lib/compare.js';
import { categorizeRemarks, describeScrap } from './lib/remarks.js';
import { validateDataset } from './lib/validate.js';
import { buildTemplateNarrative, generateNarrative } from './lib/narrative.js';
import { buildReportModel, buildWordReport, buildExcelReport, rateTrendSvg, paretoSvg, svgToPng } from './lib/report.js';

const FIELD_KEYWORDS = {
  boxNo: ['箱/扎', '箱', '扎'],
  outerDiameter: ['平均外径', '外径'],
  minWall: ['最小壁厚'],
  maxWall: ['最大壁厚'],
  verdict: ['判定'],
  remark: ['备注'],
};

const S = {
  files: [], spec: [], activeFile: 0,
  basisMode: 'current', presetKey: RULES.defaultPreset,
  appliedLimits: { ...RULES.presets[RULES.defaultPreset].limits },
  draftLimits: { ...RULES.presets[RULES.defaultPreset].limits },
  pending: false, dataset: null, metrics: null, comparisons: null,
  remarks: null, validation: null, snapshot: null, narrative: null, outputs: [],
};

const PAGES = [
  { id: 'import', title: '数据导入', need: 0 },
  { id: 'overview', title: '分析总览', need: 1 },
  { id: 'compare', title: '周间对比', need: 1 },
  { id: 'ai', title: 'AI 解读', need: 1 },
  { id: 'export', title: '报告导出', need: 1 },
];

const $ = (s) => document.querySelector(s);
const pct = (v) => (v * 100).toFixed(1) + '%';
const ppf = (v) => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + 'pp';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v, d = 3) => (Number.isFinite(v) ? Number(v).toFixed(d) : '—');

function toast(text, type) {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' toast--' + type : '');
  el.textContent = text;
  $('#msg').appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

/* ---------- 导航与顶栏 ---------- */
function renderNav() {
  const current = document.querySelector('.page.show')?.id.replace('page-', '');
  $('#nav').innerHTML = PAGES.map((p, i) => {
    const locked = p.need && !S.snapshot;
    return `<div class="nav-item${current === p.id ? ' active' : ''}${locked ? ' locked' : ''}" data-page="${p.id}"><span class="idx">${i + 1}</span><span>${p.title}</span></div>`;
  }).join('');
  document.querySelectorAll('.nav-item').forEach((el) => { el.onclick = () => go(el.dataset.page); });
}
function go(id) {
  if (PAGES.find((p) => p.id === id).need && !S.snapshot) { toast('请先完成数据导入与分析', 'warning'); return; }
  document.querySelectorAll('.page').forEach((el) => el.classList.toggle('show', el.id === 'page-' + id));
  const def = PAGES.find((p) => p.id === id);
  $('#pageTitle').textContent = def.title;
  renderNav();
  if (id === 'overview') renderOverview();
  if (id === 'compare') renderCompare();
  if (id === 'export') renderExport();
}
function renderTop() {
  $('#basisTag').textContent = S.basisMode === 'current' ? '当期口径' : '统一口径';
  $('#dataTag').textContent = S.snapshot ? `已分析 ${S.snapshot.weeks.length} 周 · ${S.snapshot.totals.n} 条` : '未加载数据';
  $('#pendingTag').classList.toggle('hidden', !S.pending);
  $('#applyCfg').disabled = !S.pending;
}

/* ---------- 数据导入 ---------- */
$('#useSample').onclick = async () => {
  try {
    const raw = await (await fetch('./sample/weeks.json')).json();
    S.files = raw.weeks.map((w) => ({
      name: `${w.label}.csv`,
      sheets: [{
        name: 'Sheet1',
        header: sampleHeader(w),
        preview: samplePreview(w),
        rowCount: w.rows.length,
        suggestion: {
          boxNo: 0,
          outerDiameter: 1,
          minWall: w.label === '1周' ? 2 : 3,
          maxWall: w.label === '1周' ? 3 : 4,
          verdict: w.label === '1周' ? 4 : 6,
          remark: w.label === '1周' ? null : 7,
        },
        rows: null,
        sampleWeek: w,
      }],
    }));
    S.spec = raw.weeks.map((w, i) => ({
      fileIndex: i, sheetIndex: 0, label: w.label, date: w.date, limits: { ...w.limits }, mapping: { ...S.files[i].sheets[0].suggestion },
    }));
    S.activeFile = 0;
    S.datasetOverride = raw.weeks.map((w) => ({ label: w.label, date: w.date, limits: { ...w.limits }, rows: w.rows.map((r) => ({ ...r })) }));
    afterLoad('已加载内置样例数据（7 周 / 452 条真实脱敏记录）。');
  } catch (e) { toast('样例数据加载失败：' + e.message, 'error'); }
};

function sampleHeader(w) {
  const base = [
    { index: 0, name: '箱/扎', label: '箱/扎', duplicate: false },
    { index: 1, name: `平均外径 要求:${w.limits.outerMin}-${w.limits.outerMax}`, label: `平均外径 要求:${w.limits.outerMin}-${w.limits.outerMax}`, duplicate: false },
  ];
  if (w.label === '1周') {
    base.push({ index: 2, name: `最小壁厚 要求:${w.limits.wallMin}`, label: `最小壁厚 要求:${w.limits.wallMin}`, duplicate: false });
    base.push({ index: 3, name: `最大壁厚 要求:${w.limits.wallMax}`, label: `最大壁厚 要求:${w.limits.wallMax}`, duplicate: false });
    base.push({ index: 4, name: '判定是否合格', label: '判定是否合格', duplicate: false });
  } else {
    base.push({ index: 2, name: '测量工具', label: '测量工具（第 1 列）', duplicate: true });
    base.push({ index: 3, name: `最小壁厚 要求:${w.limits.wallMin}`, label: `最小壁厚 要求:${w.limits.wallMin}`, duplicate: false });
    base.push({ index: 4, name: `最大壁厚 要求:${w.limits.wallMax}`, label: `最大壁厚 要求:${w.limits.wallMax}`, duplicate: false });
    base.push({ index: 5, name: '测量工具', label: '测量工具（第 2 列）', duplicate: true });
    base.push({ index: 6, name: '判定是否合格', label: '判定是否合格', duplicate: false });
    base.push({ index: 7, name: '备注', label: '备注', duplicate: false });
  }
  return base;
}
function samplePreview(w) {
  return w.rows.slice(0, 5).map((r, i) => (w.label === '1周'
    ? [i + 1, r[0], r[1], r[2], r[3] === 1 ? '合格' : '异常']
    : [i + 1, r[0], 'π尺', r[1], r[2], '卡尺', r[3] === 1 ? '合格' : '异常', r[4] || '']));
}

$('#pickFiles').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = async (e) => {
  const files = [...e.target.files];
  if (!files.length) return;
  try {
    const loaded = [];
    for (const f of files) {
      const buf = new Uint8Array(await f.arrayBuffer());
      const lower = f.name.toLowerCase();
      let sheets;
      if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
        sheets = await readXlsx(buf);
      } else if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
        sheets = [{ name: 'Sheet1', rows: parseCsv(new TextDecoder('utf-8').decode(buf)) }];
      } else {
        throw new Error(`不支持的文件类型：${f.name}（当前支持 .xlsx / .csv）`);
      }
      if (!sheets.length) throw new Error(`文件为空或无法解析：${f.name}`);
      loaded.push({
        name: f.name,
        sheets: sheets.map((s) => ({
          name: s.name,
          header: readHeader(s.rows, 0),
          preview: s.rows.slice(0, 6),
          rowCount: Math.max(0, s.rows.length - 1),
          suggestion: suggestMapping(readHeader(s.rows, 0), FIELD_KEYWORDS),
          rows: s.rows,
        })),
      });
    }
    S.files = loaded;
    S.datasetOverride = null;
    S.spec = loaded.map((f, i) => ({
      fileIndex: i, sheetIndex: 0,
      label: `${i + 1}周`,
      date: '',
      limits: { ...(S.sampleLimits?.[i] || RULES.presets[RULES.defaultPreset].limits) },
      mapping: { ...f.sheets[0].suggestion },
    }));
    S.activeFile = 0;
    afterLoad(`已加载 ${loaded.length} 个本地文件。请核对周次、限值与列映射后开始分析。`);
  } catch (err) { toast(err.message, 'error'); }
};

function afterLoad(hint) {
  $('#importHint').textContent = hint;
  ['#fileCard', '#mapCard', '#runCard'].forEach((id) => $(id).classList.remove('hidden'));
  renderFiles(); renderMap(); renderTop();
  toast(`已加载 ${S.files.length} 个文件`, 'success');
}

function renderFiles() {
  $('#fileTable').innerHTML = `<thead><tr><th>文件名</th><th class="num">行数</th><th>周次</th><th>操作</th></tr></thead><tbody>${S.files
    .map((f, i) => `<tr class="clk" data-i="${i}"><td>${esc(f.name)}</td><td class="num">${f.sheets[0].rowCount}</td><td>${esc(S.spec[i].label)}</td><td><button class="btn btn--sm" data-map="${i}">查看映射</button></td></tr>`)
    .join('')}</tbody>`;
  document.querySelectorAll('#fileTable tr[data-i]').forEach((tr) => {
    tr.onclick = (e) => { if (e.target.dataset.map !== undefined) return; S.activeFile = Number(tr.dataset.i); renderFiles(); renderMap(); };
  });
  document.querySelectorAll('#fileTable [data-map]').forEach((b) => {
    b.onclick = () => { S.activeFile = Number(b.dataset.map); renderFiles(); renderMap(); };
  });
}

function renderMap() {
  const i = S.activeFile, file = S.files[i], sheet = file.sheets[0], spec = S.spec[i];
  $('#mapTitle').textContent = `列映射与当期限值 · ${file.name}`;
  $('#mapSub').textContent = `${sheet.header.length} 列 / ${sheet.rowCount} 行`;
  const fields = [['boxNo', '箱/扎序号'], ['outerDiameter', '平均外径'], ['minWall', '最小壁厚'], ['maxWall', '最大壁厚'], ['verdict', '判定列'], ['remark', '备注列']];
  const head = sheet.header.map((h) => `<th>${esc(h.label)}</th>`).join('');
  const preview = sheet.preview.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
  $('#mapBody').innerHTML = `
    <p class="small muted">表头与前几行预览</p>
    <div class="wrap"><table class="tbl"><thead><tr>${head}</tr></thead><tbody>${preview}</tbody></table></div>
    <p class="small muted" style="margin-top:16px">列映射</p>
    <div class="mapgrid">${fields.map(([key, label]) => `<div><div class="small muted">${label}</div><select class="inp" data-field="${key}">${['<option value="">不指定</option>']
      .concat(sheet.header.map((h) => `<option value="${h.index}"${spec.mapping[key] === h.index ? ' selected' : ''}>${esc(h.label)}</option>`)).join('')}</select></div>`).join('')}</div>
    <p class="small muted" style="margin-top:16px">周次与当期限值</p>
    <div class="limitgrid">
      <div><div class="small muted">周次标签</div><input class="inp" id="wkLabel" value="${esc(spec.label)}"></div>
      <div><div class="small muted">抽检日期</div><input class="inp" id="wkDate" value="${esc(spec.date)}"></div>
      <div><div class="small muted">外径下限</div><input class="inp" type="number" step="0.01" id="wkOuterMin" value="${spec.limits.outerMin}"></div>
      <div><div class="small muted">外径上限</div><input class="inp" type="number" step="0.01" id="wkOuterMax" value="${spec.limits.outerMax}"></div>
      <div><div class="small muted">最小壁厚下限</div><input class="inp" type="number" step="0.01" id="wkWallMin" value="${spec.limits.wallMin}"></div>
      <div><div class="small muted">最大壁厚上限</div><input class="inp" type="number" step="0.01" id="wkWallMax" value="${spec.limits.wallMax}"></div>
    </div>
    <p style="margin-top:14px"><button class="btn btn--primary btn--sm" id="saveMap">保存该文件设置</button></p>`;
  document.querySelectorAll('#mapBody select[data-field]').forEach((sel) => {
    sel.onchange = () => { spec.mapping[sel.dataset.field] = sel.value === '' ? null : Number(sel.value); };
  });
  $('#saveMap').onclick = () => {
    spec.label = $('#wkLabel').value.trim() || spec.label;
    spec.date = $('#wkDate').value.trim();
    spec.limits = {
      outerMin: Number($('#wkOuterMin').value), outerMax: Number($('#wkOuterMax').value),
      wallMin: Number($('#wkWallMin').value), wallMax: Number($('#wkWallMax').value),
    };
    if (spec.limits.outerMin >= spec.limits.outerMax) { toast('外径下限应小于上限', 'error'); return; }
    if (spec.limits.wallMin <= 0 || spec.limits.wallMax <= 0) { toast('壁厚限值必须为正数', 'error'); return; }
    renderFiles(); toast('已保存该文件设置', 'success');
  };
}

/* ---------- 口径配置 ---------- */
$('#preset').innerHTML = Object.entries(RULES.presets).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('') + '<option value="custom">自定义</option>';
function fillLimits(l) {
  $('#limOuterMin').value = l.outerMin; $('#limOuterMax').value = l.outerMax;
  $('#limWallMin').value = l.wallMin; $('#limWallMax').value = l.wallMax;
}
function readLimits() {
  return {
    outerMin: Number($('#limOuterMin').value), outerMax: Number($('#limOuterMax').value),
    wallMin: Number($('#limWallMin').value), wallMax: Number($('#limWallMax').value),
  };
}
function markPending() {
  S.draftLimits = readLimits();
  S.pending = Object.keys(S.draftLimits).some((k) => S.draftLimits[k] !== S.appliedLimits[k]);
  renderTop();
}
['limOuterMin', 'limOuterMax', 'limWallMin', 'limWallMax'].forEach((id) => {
  $('#' + id).oninput = () => { S.presetKey = 'custom'; $('#preset').value = 'custom'; markPending(); };
});
$('#preset').onchange = () => {
  S.presetKey = $('#preset').value;
  if (S.presetKey !== 'custom') { S.draftLimits = { ...RULES.presets[S.presetKey].limits }; fillLimits(S.draftLimits); }
  markPending();
};
$('#resetCfg').onclick = () => {
  S.presetKey = RULES.defaultPreset; $('#preset').value = S.presetKey;
  S.draftLimits = { ...RULES.presets[S.presetKey].limits }; fillLimits(S.draftLimits); markPending();
};
$('#applyCfg').onclick = () => {
  const l = readLimits();
  if (l.outerMin >= l.outerMax) { toast('外径下限应小于上限', 'error'); return; }
  if (l.wallMin <= 0 || l.wallMax <= 0) { toast('壁厚限值必须为正数', 'error'); return; }
  S.appliedLimits = l; S.pending = false; renderTop();
  S.narrative = null;
  $('#aiDoc').textContent = '口径已变更，原解读已失效，请重新生成。';
  $('#regenBtn').disabled = true;
  if (S.snapshot) { runAnalyze(true); toast('统一基准已应用', 'success'); }
};
$('#basisMode').onchange = () => { S.basisMode = $('#basisMode').value; renderTop(); if (S.snapshot) runAnalyze(true); };
function pairLabels() {
  return $('#pairLabels').value.split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => s.split(/[-—>]/).map((x) => x.trim())).filter((p) => p.length === 2);
}

/* ---------- 分析 ---------- */
$('#runAnalyze').onclick = () => {
  const seen = new Set();
  for (const s of S.spec) { if (seen.has(s.label)) { toast(`周次标签「${s.label}」重复`, 'error'); return; } seen.add(s.label); }
  runAnalyze(false);
};

function buildDataset() {
  if (S.datasetOverride) {
    return { weeks: S.datasetOverride.map((w, i) => ({ ...w, limits: { ...S.spec[i].limits }, label: S.spec[i].label, date: S.spec[i].date || w.date })) };
  }
  const weeks = S.spec.map((item) => {
    const sheet = S.files[item.fileIndex].sheets[item.sheetIndex || 0];
    return buildWeek({
      label: item.label, date: item.date, limits: item.limits,
      rows: sheet.rows, headerRowIndex: 0, mapping: item.mapping, sheetName: sheet.name,
    });
  });
  return { weeks };
}

function runAnalyze(silent) {
  try {
    const dataset = buildDataset();
    const metrics = buildMetrics(dataset.weeks, S.appliedLimits, RULES);
    const pairs = pairLabels();
    const comparisons = pairs.length ? selectPairs(metrics, pairs) : buildComparisons(metrics, 'chain');
    const remarks = categorizeRemarks(dataset.weeks.flatMap((w) => w.rows), RULES.remarkCategories);
    const validation = validateDataset(dataset.weeks, RULES);
    S.dataset = dataset; S.metrics = metrics; S.comparisons = comparisons;
    S.remarks = remarks; S.validation = validation;
    S.snapshot = buildSnapshot(metrics, S.basisMode, RULES, comparisons, remarks);
    S.anomalyDetail = collectAnomalies(dataset, metrics);
    renderTop(); renderOverview(); renderCompare();
    if (!silent) { toast('分析完成', 'success'); go('overview'); }
  } catch (e) { toast('分析失败：' + e.message, 'error'); }
}

function collectAnomalies(dataset, metrics) {
  const list = [];
  dataset.weeks.forEach((week) => {
    week.rows.forEach((row) => {
      const current = judgeRow(row, week.limits);
      if (current.pass) return;
      const unified = judgeRow(row, metrics.basisLimits);
      list.push({
        week: week.label, boxNo: row.boxNo,
        outerDiameter: row.outerDiameter, minWall: row.minWall, maxWall: row.maxWall,
        issues: current.issues, unifiedIssues: unified.issues,
        flipped: current.pass !== unified.pass,
        remark: row.remark || '', verdictManual: row.verdictManual,
      });
    });
  });
  return list;
}

/* ---------- 总览 ---------- */
function renderOverview() {
  if (!S.snapshot) return;
  const v = S.snapshot, current = S.basisMode === 'current';
  const rates = v.weeks.map((w) => (current ? w.rate : w.unifiedRate));
  const others = v.weeks.map((w) => (current ? w.unifiedRate : w.rate));
  const band = v.weeks.map((w) => (current ? w.ci : w.unifiedCi));
  const avg = rates.reduce((s, x) => s + x, 0) / rates.length;
  let alerts = `<div class="alert alert--info">当前展示口径：<b>${current ? '当期口径' : '统一口径'}</b>。统一基准：外径 ${S.appliedLimits.outerMin}–${S.appliedLimits.outerMax}，最小壁厚 ≥${S.appliedLimits.wallMin}，最大壁厚 ≤${S.appliedLimits.wallMax}。</div>`;
  if (v.totals.smallWeeks.length) alerts += `<div class="alert alert--warning">${v.totals.smallWeeks.join('、')} 样本量不足（阈值 ${RULES.smallSampleThreshold}），带 * 号，不作为趋势依据。</div>`;
  const warn = S.validation.warnings.filter((w) => /一致率/.test(w));
  if (warn.length) alerts += `<div class="alert alert--warning">${esc(warn.join('；'))}</div>`;
  $('#overviewAlerts').innerHTML = alerts;
  $('#kpiGrid').innerHTML = [
    ['合格率（当前口径展示）', pct(avg), `${rates.length} 周均值`, 'kpi--primary'],
    ['异常率', pct(v.totals.anomalyRecords / v.totals.n), `${v.totals.anomalyRecords} / ${v.totals.n} 条`, 'kpi--warning'],
    ['抽检记录总数', v.totals.n, `${v.weeks.length} 个周次`, ''],
    ['标准变化影响量', v.totals.flips + ' 条', '当期与统一口径判定翻转数', ''],
    ['指标级异常项', v.totals.anomalyItems + ' 项', `记录级 ${v.totals.anomalyRecords} 条`, ''],
    ['判定复算一致率', S.validation.consistency.rate === null ? '不适用' : (S.validation.consistency.rate * 100).toFixed(1) + '%', '与人工判定逐条比对', 'kpi--success'],
  ].map(([l, val, s, cls]) => `<div class="kpi ${cls}"><div class="l">${l}</div><div class="v">${val}</div><div class="s">${s}</div></div>`).join('');
  $('#rateChart').innerHTML = inlineTrend({ labels: v.weeks.map((w) => w.label), rates, otherRates: others, band, smallFlags: v.weeks.map((w) => w.small) });
  $('#rateLegend').innerHTML = `<span><i class="dot" style="background:#409EFF"></i>${current ? '当期口径' : '统一口径'}（当前）</span><span><i class="dot" style="background:#A0CFFF"></i>${current ? '统一口径' : '当期口径'}（对照）</span><span><i class="dot" style="background:#409EFF;opacity:.18"></i>95% 置信区间</span><span>* 样本量不足</span>`;
  const paretoItems = RULES.anomalyTypes
    .map((t) => ({ type: t, count: v.totals.byType[t] || 0 }))
    .filter((i) => i.count > 0)
    .sort((a, b) => b.count - a.count);
  $('#paretoChart').innerHTML = inlinePareto(paretoItems);
  $('#kpiTable').innerHTML = `<thead><tr><th>周次</th><th class="num">样本量</th><th class="num">当期</th><th class="num">统一</th><th class="num">平均外径</th><th class="num">Cp</th><th class="num">Cpk</th><th class="num">翻转</th></tr></thead><tbody>${v.weeks
    .map((w) => `<tr><td>${esc(w.label)}${w.small ? ' <span class="tag tag--warning">小样本</span>' : ''}</td><td class="num">${w.n}</td><td class="num">${pct(w.rate)}</td><td class="num">${pct(w.unifiedRate)}</td><td class="num">${num(w.meanOuter)}</td><td class="num">${num(w.cp, 2)}</td><td class="num">${num(w.cpk, 2)}</td><td class="num">${w.flips || '—'}</td></tr>`)
    .join('')}</tbody>`;
  $('#anomTable').innerHTML = `<thead><tr><th>异常类型</th><th class="num">记录级计数</th><th class="num">指标级计数</th></tr></thead><tbody>${RULES.anomalyTypes
    .map((t) => `<tr><td>${t}</td><td class="num">${v.totals.byType[t] || 0}</td><td class="num">${v.totals.byType[t] || 0}</td></tr>`)
    .join('')}<tr><td>合计</td><td class="num">${v.totals.anomalyRecords}</td><td class="num">${v.totals.anomalyItems}</td></tr></tbody>`;
}

function inlineTrend(cfg) {
  const W = 780, H = 280, P = { l: 62, r: 24, t: 18, b: 36 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b, labels = cfg.labels;
  const pool = cfg.rates.concat(cfg.otherRates || []);
  cfg.band.forEach((b) => { if (b) pool.push(b[0], b[1]); });
  let lo = Math.min(...pool), hi = Math.max(...pool);
  const sp = (hi - lo) || 0.1; lo = Math.max(0, lo - sp * 0.25); hi = Math.min(1, hi + sp * 0.25);
  const X = (i) => P.l + (labels.length < 2 ? iw / 2 : (i * iw) / (labels.length - 1));
  const Y = (v) => P.t + ih - ((v - lo) / (hi - lo || 1)) * ih;
  let svg = `<svg viewBox="0 0 ${W} ${H}">`;
  for (let t = 0; t <= 4; t += 1) {
    const y = P.t + (ih * t) / 4, v = hi - ((hi - lo) * t) / 4;
    svg += `<line x1="${P.l}" y1="${y}" x2="${W - P.r}" y2="${y}" stroke="#EBEEF5"/><text x="${P.l - 8}" y="${y + 4}" font-size="11" fill="#909399" text-anchor="end">${pct(v)}</text>`;
  }
  let band = '';
  cfg.band.forEach((b, i) => { if (b) band += `${X(i)},${Y(b[1])} `; });
  for (let i = cfg.band.length - 1; i >= 0; i -= 1) { const b = cfg.band[i]; if (b) band += `${X(i)},${Y(b[0])} `; }
  if (band) svg += `<polygon points="${band.trim()}" fill="#409EFF" opacity="0.16"/>`;
  if (cfg.otherRates) svg += `<path d="${cfg.otherRates.map((v, i) => `${i ? 'L' : 'M'}${X(i)},${Y(v)}`).join(' ')}" fill="none" stroke="#A0CFFF" stroke-width="2" stroke-dasharray="6 4"/>`;
  svg += `<path d="${cfg.rates.map((v, i) => `${i ? 'L' : 'M'}${X(i)},${Y(v)}`).join(' ')}" fill="none" stroke="#409EFF" stroke-width="3"/>`;
  cfg.rates.forEach((v, i) => {
    svg += cfg.smallFlags[i]
      ? `<circle cx="${X(i)}" cy="${Y(v)}" r="5" fill="#fff" stroke="#409EFF" stroke-width="2" stroke-dasharray="2 2"><title>${labels[i]} ${pct(v)}（样本量不足）</title></circle>`
      : `<circle cx="${X(i)}" cy="${Y(v)}" r="4" fill="#409EFF"><title>${labels[i]} ${pct(v)}</title></circle>`;
    svg += `<text x="${X(i)}" y="${H - 12}" font-size="12" fill="#606266" text-anchor="middle">${esc(labels[i])}${cfg.smallFlags[i] ? ' *' : ''}</text>`;
  });
  return svg + '</svg>';
}
function inlinePareto(items) {
  const W = 780, H = 280, P = { l: 58, r: 58, t: 24, b: 44 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const max = Math.max(...items.map((i) => i.count), 1);
  const total = items.reduce((s, i) => s + i.count, 0) || 1;
  const bw = Math.min(80, (iw / items.length) * 0.5);
  let acc = 0, svg = `<svg viewBox="0 0 ${W} ${H}">`;
  for (let t = 0; t <= 4; t += 1) {
    const y = P.t + (ih * t) / 4;
    svg += `<line x1="${P.l}" y1="${y}" x2="${W - P.r}" y2="${y}" stroke="#EBEEF5"/><text x="${P.l - 8}" y="${y + 4}" font-size="11" fill="#909399" text-anchor="end">${Math.round(max - (max * t) / 4)}</text><text x="${W - P.r + 8}" y="${y + 4}" font-size="11" fill="#909399">${100 - 25 * t}%</text>`;
  }
  const pts = [];
  items.forEach((it, i) => {
    const x = P.l + (iw * (i + 0.5)) / items.length, h = (it.count / max) * ih, y = P.t + ih - h;
    svg += `<rect x="${x - bw / 2}" y="${y}" width="${bw}" height="${h}" rx="2" fill="#409EFF" opacity="0.85"><title>${esc(it.type)}：${it.count} 项</title></rect>`;
    svg += `<text x="${x}" y="${y - 6}" font-size="12" fill="#303133" text-anchor="middle">${it.count}</text><text x="${x}" y="${H - 16}" font-size="12" fill="#606266" text-anchor="middle">${esc(it.type)}</text>`;
    acc += it.count; pts.push([x, P.t + ih - (acc / total) * ih]);
  });
  svg += `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ')}" fill="none" stroke="#E6A23C" stroke-width="2"/>`;
  pts.forEach((p) => { svg += `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="#E6A23C"/>`; });
  return svg + '</svg>';
}

/* ---------- 对比 ---------- */
function renderCompare() {
  if (!S.snapshot) return;
  const v = S.snapshot;
  $('#diffTable').innerHTML = `<thead><tr><th>对比</th><th class="num">当期口径差</th><th class="num">标准变化（当期 − 统一）</th><th class="num">统一口径差</th><th class="num">甲周 95% 区间</th><th class="num">乙周 95% 区间</th><th>结论</th></tr></thead><tbody>${v.comparisons
    .map((c) => {
      const tag = c.verdict === 'flat' ? '<span class="tag tag--info">无有效变化（在抽样波动范围内）</span>' : c.verdict === 'up' ? '<span class="tag tag--success">有效上升</span>' : '<span class="tag tag--danger">有效下降</span>';
      return `<tr><td>${esc(c.from)} → ${esc(c.to)}</td><td class="num">${ppf(c.toCurrentRate - c.fromCurrentRate)}</td><td class="num">${ppf(c.standardShiftFrom)} / ${ppf(c.standardShiftTo)}</td><td class="num">${ppf(c.unifiedDelta)}</td><td class="num small">${ciText(c.fromUnifiedCi)}</td><td class="num small">${ciText(c.toUnifiedCi)}</td><td>${tag}</td></tr>`;
    })
    .join('')}</tbody>`;
  const rows = S.anomalyDetail || [];
  $('#detailSub').textContent = `共 ${rows.length} 条异常记录（记录级，当期口径）· 点击任意一行查看记录详情`;
  $('#detailTable').innerHTML = `<thead><tr><th>周次</th><th class="num">箱/扎</th><th class="num">平均外径</th><th class="num">最小壁厚</th><th class="num">最大壁厚</th><th>超限类型</th><th>备注原文</th></tr></thead><tbody>${rows
    .map((r, i) => `<tr class="clk" data-i="${i}"><td>${esc(r.week)}</td><td class="num">${esc(r.boxNo)}</td><td class="num">${num(r.outerDiameter)}</td><td class="num">${num(r.minWall)}</td><td class="num">${num(r.maxWall)}</td><td><span class="tag tag--danger">${esc(r.issues.join(' / '))}</span></td><td class="small">${esc(r.remark || '—')}</td></tr>`)
    .join('')}</tbody>`;
  document.querySelectorAll('#detailTable tr.clk').forEach((tr) => { tr.onclick = () => openDetail(rows[Number(tr.dataset.i)]); });
  $('#remarkSub').textContent = describeScrap(S.remarks);
  $('#remarkTable').innerHTML = `<thead><tr><th>处置类型</th><th class="num">备注条数</th></tr></thead><tbody>${Object.entries(S.remarks.counts)
    .map(([k, n]) => `<tr><td>${esc(k)}</td><td class="num">${n}</td></tr>`)
    .join('')}<tr><td>合计（非空备注）</td><td class="num">${S.remarks.total}</td></tr></tbody>`;
}
const ciText = (ci) => (ci ? `${pct(ci[0])} – ${pct(ci[1])}` : '—');

function openDetail(r) {
  $('#drawerTitle').textContent = `${r.week} · 箱/扎 ${r.boxNo}`;
  $('#drawerBody').innerHTML = `<div class="kv"><span class="k">平均外径</span><span>${num(r.outerDiameter)}</span></div>
    <div class="kv"><span class="k">最小壁厚</span><span>${num(r.minWall)}</span></div>
    <div class="kv"><span class="k">最大壁厚</span><span>${num(r.maxWall)}</span></div>
    <div class="kv"><span class="k">当期判定</span><span><span class="tag tag--danger">${esc(r.issues.join(' / '))}</span></span></div>
    <div class="kv"><span class="k">统一判定</span><span>${r.unifiedIssues.length ? `<span class="tag tag--danger">${esc(r.unifiedIssues.join(' / '))}</span>` : '<span class="tag tag--success">合格</span>'}</span></div>
    <div class="kv"><span class="k">判定翻转</span><span>${r.flipped ? '是' : '否'}</span></div>
    <div class="kv"><span class="k">人工判定</span><span>${r.verdictManual === null || r.verdictManual === undefined ? '—' : r.verdictManual ? '合格' : '异常'}</span></div>
    <p class="small muted" style="margin-top:14px">备注原文</p><div>${esc(r.remark || '（无备注）')}</div>
    <p class="small muted" style="margin-top:12px">备注只作说明与文本归类，不改写判定结论。</p>`;
  $('#drawerMask').classList.add('show'); $('#drawer').classList.add('show');
}
$('#drawerClose').onclick = () => { $('#drawerMask').classList.remove('show'); $('#drawer').classList.remove('show'); };
$('#drawerMask').onclick = () => { $('#drawerMask').classList.remove('show'); $('#drawer').classList.remove('show'); };

/* ---------- AI ---------- */
$('#genBtn').onclick = () => genNarrative(false);
$('#regenBtn').onclick = () => genNarrative(true);
async function genNarrative(isRegen) {
  if (!S.snapshot) { toast('请先完成分析', 'warning'); return; }
  if (isRegen && !confirm('重新生成会再次调用模型，可能产生额外费用。当前编辑内容将被覆盖，是否继续？')) return;
  const mode = $('#aiMode').value;
  $('#genBtn').disabled = true; $('#regenBtn').disabled = true;
  $('#aiMeta').className = 'alert alert--info';
  $('#aiMeta').textContent = mode === 'online' ? '正在调用 DeepSeek…（超时 30 秒，失败自动降级）' : '正在使用模板生成…';
  try {
    const apiKey = mode === 'online' ? $('#apiKey').value : '';
    const data = mode === 'template'
      ? { text: buildTemplateNarrative(S.snapshot), meta: { model: '模板生成', degraded: true, reason: '用户选择模板生成', ms: 0, check: null } }
      : await generateNarrative({ snapshot: S.snapshot, apiKey, rules: RULES, offline: mode === 'offline' });
    S.narrative = data.text;
    $('#aiDoc').textContent = data.text;
    $('#aiDoc').setAttribute('contenteditable', 'true');
    const m = data.meta;
    $('#aiMeta').className = 'alert ' + (m.degraded ? 'alert--warning' : 'alert--success');
    $('#aiMeta').innerHTML = `模型：<b>${esc(m.model)}</b> · 耗时 ${m.ms} ms · 数字回查：<b>${m.check ? (m.check.passed ? '通过' : '未通过') : '不适用'}</b>${m.check ? `（校验 ${m.check.total} 个数字）` : ''}${m.reason ? ' · ' + esc(m.reason) : ''}`;
    $('#regenBtn').disabled = false;
    toast(m.degraded ? '已使用模板生成' : '解读生成完成，数字回查通过', m.degraded ? 'warning' : 'success');
  } catch (e) { toast(e.message, 'error'); }
  finally { $('#genBtn').disabled = false; }
}

/* ---------- 导出 ---------- */
function renderExport() {
  $('#sectionList').innerHTML = RULES.report.sections.map((s, i) => `<label class="small" style="display:block;margin-bottom:6px"><input type="checkbox" ${i === 0 ? 'checked disabled' : 'checked'} data-sec="${i}"> ${esc(s)}</label>`).join('');
  const fmts = [['word', 'Word（.docx）'], ['excel', 'Excel（.xlsx，4 个工作表）'], ['pdf', 'PDF（浏览器打印另存）']];
  $('#formatList').innerHTML = fmts.map(([k, label], i) => `<label class="small" style="display:block;margin-bottom:6px"><input type="checkbox" data-fmt="${k}" ${i === 2 ? '' : 'checked'}> ${label}</label>`).join('');
  renderOutputs();
}
function renderOutputs() {
  $('#outputTable').innerHTML = `<thead><tr><th>文件名</th><th class="num">大小</th><th>状态</th></tr></thead><tbody>${
    S.outputs.length
      ? S.outputs.map((o) => `<tr><td>${o.url ? `<a class="btn--link" href="${o.url}" download="${esc(o.name)}">${esc(o.name)}</a>` : esc(o.name)}</td><td class="num">${o.size ? Math.round(o.size / 1024) + ' KB' : '—'}</td><td>${o.ok ? '<span class="tag tag--success">生成成功</span>' : `<span class="tag tag--danger">${esc(o.error || '失败')}</span>`}</td></tr>`).join('')
      : '<tr><td colspan="3" class="muted" style="text-align:center;padding:26px">暂无导出产物</td></tr>'
  }</tbody>`;
}

function download(name, bytes, type) {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return url;
}

$('#exportBtn').onclick = async () => {
  if (!S.snapshot) { toast('请先完成分析', 'warning'); return; }
  if (S.pending) { toast('口径配置有未应用的修改，请先点击「应用」', 'warning'); return; }
  const formats = [...document.querySelectorAll('#formatList input:checked')].map((i) => i.dataset.fmt);
  if (!formats.length) { toast('请至少选择一种输出格式', 'warning'); return; }
  const stamp = fileStamp(new Date());
  const scope = `${S.snapshot.weeks[0].label}-${S.snapshot.weeks[S.snapshot.weeks.length - 1].label}`;
  const narrative = $('#aiDoc').getAttribute('contenteditable') === 'true' ? $('#aiDoc').textContent : null;
  $('#exportBtn').disabled = true;
  const model = buildReportModel({
    dataset: S.dataset, metrics: S.metrics, comparisons: S.comparisons, remarks: S.remarks,
    basisMode: S.basisMode, rules: RULES, validation: S.validation, narrative,
  });
  const produced = [];
  try {
    if (formats.includes('word')) {
      const cfg = chartConfig();
      const ratePng = await svgToPng(rateTrendSvg(cfg), 1200, 420);
      const paretoPng = model.pareto.length ? await svgToPng(paretoSvg(model.pareto), 1200, 420) : null;
      const bytes = await buildWordReport(model, { ratePng, paretoPng });
      const name = `质量数据分析报告_${scope}_${stamp}.docx`;
      produced.push({ name, size: bytes.length, ok: true, url: download(name, bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') });
    }
    if (formats.includes('excel')) {
      const bytes = await buildExcelReport(model, S.dataset, S.metrics);
      const name = `质量数据分析数据表_${scope}_${stamp}.xlsx`;
      produced.push({ name, size: bytes.length, ok: true, url: download(name, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') });
    }
    if (formats.includes('pdf')) {
      openPrintView(model, rateTrendSvg(chartConfig()), model.pareto.length ? paretoSvg(model.pareto) : null);
      produced.push({ name: `质量数据分析报告_${scope}_${stamp}.pdf`, ok: true, size: 0 });
    }
  } catch (e) {
    produced.push({ name: '导出失败', ok: false, error: e.message });
  } finally {
    $('#exportBtn').disabled = false;
  }
  S.outputs = produced.concat(S.outputs).slice(0, 10);
  renderOutputs();
  const failed = produced.filter((p) => !p.ok);
  toast(failed.length ? `导出出现问题：${failed.map((f) => f.error).join('；')}` : `导出完成，共 ${produced.length} 个文件`, failed.length ? 'warning' : 'success');
};

function chartConfig() {
  const v = S.snapshot, current = S.basisMode === 'current';
  return {
    labels: v.weeks.map((w) => w.label),
    rates: v.weeks.map((w) => (current ? w.rate : w.unifiedRate)),
    otherRates: v.weeks.map((w) => (current ? w.unifiedRate : w.rate)),
    band: v.weeks.map((w) => (current ? w.ci : w.unifiedCi)),
    smallFlags: v.weeks.map((w) => w.small),
  };
}

function fileStamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function openPrintView(model, rateSvg, paretoSvgMarkup) {
  const table = (rows) => `<table><thead><tr>${rows[0].map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const win = window.open('', '_blank');
  if (!win) { toast('浏览器拦截了打印窗口，请允许弹出窗口后重试', 'warning'); return; }
  win.document.write(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(model.title)}</title><style>
  @page{size:A4;margin:16mm 14mm}body{font-family:"Microsoft YaHei",Arial,sans-serif;color:#303133;font-size:12.5px;line-height:1.75}
  h1{font-size:22px;margin:0 0 6px}h2{font-size:15px;margin:22px 0 8px;border-left:3px solid #409EFF;padding-left:8px}h3{font-size:13px;margin:14px 0 6px}
  .meta,.basis{color:#606266;font-size:12px;margin-bottom:6px}
  table{width:100%;border-collapse:collapse;margin:8px 0 12px;font-size:11px}th,td{border:1px solid #DCDFE6;padding:5px 7px;text-align:left}th{background:#F5F7FA}
  ul{margin:6px 0 12px 18px;padding:0}.note{color:#909399;font-size:11px}.chart svg{width:100%;height:auto}.pagebreak{page-break-before:always}
  </style></head><body>
  <h1>${esc(model.title)}</h1>
  <div class="meta">生成时间：${esc(model.head.generatedAtText)}　｜　覆盖周次：${esc(model.head.coverWeeks)}　｜　抽检日期：${esc(model.head.dates)}　｜　样本量：${model.head.totalN} 条</div>
  <div class="basis">口径说明：${esc(model.head.basis)}</div>
  <h2>一、执行摘要</h2>${model.narrative ? `<div style="white-space:pre-wrap">${esc(model.narrative)}</div>` : `<ul>${model.summary.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`}
  <h2>二、关键指标总览</h2><div class="chart">${rateSvg}</div>${table(model.kpiRows)}
  <div class="note">* 表示该周样本量不足；判定翻转指当期口径与统一口径结果不一致的记录数。</div>
  <h2>三、周间差异对比</h2>${table(model.compareRows)}
  <h2>四、异常结构分析</h2>${paretoSvgMarkup ? `<div class="chart">${paretoSvgMarkup}</div>` : ''}${table(model.anomalyRows)}
  <div class="note">记录级合计为存在超限的记录数，指标级合计按指标项分别累计，两者口径不同。</div>
  <h3>备注与处置分布</h3>${table(model.remarkRows)}
  <h2>五、结论与建议</h2><h3>数据支持的结论</h3><ul>${model.supported.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
  <h3>数据不足、待现场核实的事项</h3><ul>${model.insufficient.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
  <div class="pagebreak"></div><h2>附录 A　判定规则与口径说明</h2>
  <p>判定规则：平均外径须落在当期限值区间内；最小壁厚须不小于壁厚下限；最大壁厚须不大于壁厚上限。三项全部满足判为合格。</p>
  <p>${esc(model.head.basis)}。报告中的差异与结论一律以统一口径为准；当期口径仅用于描述单周自身结果。</p>
  ${table(model.limitsTable)}
  <div class="pagebreak"></div><h2>附录 B　各周抽检明细</h2>${table(model.detailRows)}
  </body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 600);
}

/* ---------- 启动 ---------- */
fillLimits(S.draftLimits);
renderNav();
renderTop();
renderExport();
