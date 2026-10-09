import { describeScrap } from '../core/remarks.js';
import { judgeRow } from '../core/judge.js';

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const ppText = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}pp`;

function basisDescription(basisMode, basisLimits) {
  const mode = basisMode === 'current' ? '当期口径' : '统一口径';
  return `${mode}｜统一基准：外径 ${basisLimits.outerMin}–${basisLimits.outerMax}，最小壁厚 ≥${basisLimits.wallMin}，最大壁厚 ≤${basisLimits.wallMax}`;
}

function fmtRange(ci) {
  return ci ? `${pct(ci[0])} – ${pct(ci[1])}` : '—';
}

/**
 * 组装报告模型。所有数值均来自 core 的计算结果，本模块不做任何新的数值推算。
 */
export function buildReportModel({
  dataset,
  metrics,
  comparisons,
  remarks,
  basisMode,
  rules,
  generatedAt = new Date(),
  validation = null,
  narrative = null,
}) {
  const weeks = metrics.weeks;
  const labels = weeks.map((w) => w.label);
  const pick = (w) => (basisMode === 'current' ? w.current : w.unified);
  const other = (w) => (basisMode === 'current' ? w.unified : w.current);

  const ranked = weeks.slice().sort((a, b) => pick(b).rate - pick(a).rate);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const effective = comparisons.filter((c) => c.verdict !== 'flat');
  const flat = comparisons.filter((c) => c.verdict === 'flat');
  const changedWeeks = weeks.filter((w) => w.flips > 0);
  const topType = Object.entries(metrics.byTypeTotal)
    .sort((a, b) => b[1] - a[1])
    .filter(([, v]) => v > 0)[0];

  const summary = [];
  summary.push(
    `本次分析覆盖 ${weeks.length} 个抽检周次、${metrics.totalN} 条记录，展示口径为${basisMode === 'current' ? '当期口径' : '统一口径'}。合格率区间 ${pct(Math.min(...weeks.map((w) => pick(w).rate)))} – ${pct(Math.max(...weeks.map((w) => pick(w).rate)))}。`,
  );
  summary.push(
    `合格率最高为 ${best.label} ${pct(pick(best).rate)}（n=${pick(best).n}），最低为 ${worst.label} ${pct(pick(worst).rate)}（n=${pick(worst).n}）。`,
  );
  if (effective.length) {
    summary.push(
      `统一口径下共有 ${effective.length} 组周对落在置信区间之外，判定为有效变化：${effective
        .map((c) => `${c.from}→${c.to} ${ppText(c.delta)}（${c.verdict === 'up' ? '上升' : '下降'}）`)
        .join('；')}。`,
    );
  } else {
    summary.push('统一口径下没有周对的置信区间落在彼此之外，因此不存在可判定的有效变化。');
  }
  if (flat.length) {
    summary.push(
      `${flat.map((c) => `${c.from}→${c.to}`).join('、')} 的差异落在抽样波动范围内，不构成有效变化。`,
    );
  }
  if (changedWeeks.length) {
    summary.push(
      `标准变化影响：${changedWeeks.map((w) => `${w.label} ${w.flips} 条`).join('、')}，合计 ${metrics.flipsTotal} 条记录的判定在当期与统一口径之间发生翻转。`,
    );
  } else {
    summary.push('各周当期口径与统一口径判定一致，无翻转记录。');
  }
  if (topType) {
    summary.push(
      `异常按记录级计 ${metrics.totalAnomalyRecords} 条，按指标级计 ${metrics.anomalyItemsTotal} 项，其中${topType[0]} ${topType[1]} 项，占 ${pct(topType[1] / metrics.anomalyItemsTotal)}。`,
    );
  }

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
    [
      '合计',
      '',
      metrics.totalN,
      pct(metrics.totalPass / metrics.totalN),
      '',
      pct(metrics.totalAnomalyRecords / metrics.totalN),
      '',
      '',
      '',
      metrics.flipsTotal,
    ],
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
      c.verdict === 'flat'
        ? '无有效变化（在抽样波动范围内）'
        : c.verdict === 'up'
          ? '有效上升'
          : '有效下降',
    ]),
  ];

  const anomalyOrder = rules.anomalyTypes;
  const anomalyRows = [
    ['异常类型', '记录级计数', '指标级计数'],
    ...anomalyOrder.map((t) => [t, metrics.byTypeTotal[t], metrics.byTypeTotal[t]]),
    ['合计', metrics.totalAnomalyRecords, metrics.anomalyItemsTotal],
  ];

  const pareto = anomalyOrder
    .map((t) => ({ type: t, count: metrics.byTypeTotal[t] }))
    .filter((i) => i.count > 0)
    .sort((a, b) => b.count - a.count);

  const remarkRows = [
    ['处置类型', '备注条数'],
    ...Object.entries(remarks.counts).map(([k, v]) => [k, v]),
    ['合计（非空备注）', remarks.total],
  ];

  const detailRows = buildDetailRows(dataset, metrics, basisMode);

  const supported = [];
  supported.push(`合格率最高周次为 ${best.label}（${pct(pick(best).rate)}），最低为 ${worst.label}（${pct(pick(worst).rate)}）。`);
  if (topType) {
    supported.push(`异常以${topType[0]}为主，按指标级计 ${topType[1]} 项，占全部异常项的 ${pct(topType[1] / metrics.anomalyItemsTotal)}。`);
  }
  supported.push(
    `判定复算一致率为 ${validation?.consistency?.rate === null || validation?.consistency?.rate === undefined ? '不适用' : `${(validation.consistency.rate * 100).toFixed(1)}%`}，报告中的判定结果可由原始数值完全复现。`,
  );

  const insufficient = [];
  if (metrics.smallWeeks.length) {
    insufficient.push(
      `${metrics.smallWeeks.map((w) => `${w.label}（${w.current.n} 条）`).join('、')}样本量低于 ${rules.smallSampleThreshold} 条，相关结论仅供参考，不作为趋势依据。`,
    );
  }
  insufficient.push(
    `${weeks[0].label}无备注列，其 ${weeks[0].current.anomalyRecords} 条异常缺少处置记录，无法确认现场处置情况。`,
  );
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
      basis: basisDescription(basisMode, metrics.basisLimits),
      standardChanged: changedWeeks.map((w) => `${w.label}（限值 ${limitsText(w.limits)}）`),
      validation,
    },
    summary: summary.slice(0, 5),
    narrative,
    kpiRows,
    compareRows,
    anomalyRows,
    pareto,
    remarkRows,
    supported,
    insufficient,
    limitsTable: [
      ['周次', '外径下限', '外径上限', '最小壁厚下限', '最大壁厚上限', '与统一基准是否一致'],
      ...weeks.map((w) => [
        w.label,
        w.limits.outerMin,
        w.limits.outerMax,
        w.limits.wallMin,
        w.limits.wallMax,
        w.standardChanged ? '不一致' : '一致',
      ]),
    ],
    detailRows,
  };
}

/** 附录 B：逐条明细，同时给出当期判定与统一判定，便于人工追溯每个数字 */
function buildDetailRows(dataset, metrics, basisMode) {
  const rows = [['周次', '箱/扎', '平均外径', '最小壁厚', '最大壁厚', '当期判定', '统一判定', '人工判定', '备注']];
  if (!dataset) return rows;
  dataset.weeks.forEach((week, wi) => {
    const metric = metrics.weeks[wi];
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
        row.verdictManual === null || row.verdictManual === undefined
          ? '—'
          : row.verdictManual
            ? '合格'
            : '异常',
        row.remark || '',
      ]);
    });
    if (!metric) rows.push([week.label, '', '', '', '', '', '', '', '']);
  });
  return rows;
}

function limitsText(l) {
  return `${l.outerMin}–${l.outerMax} / ≥${l.wallMin} / ≤${l.wallMax}`;
}

function formatTime(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}
