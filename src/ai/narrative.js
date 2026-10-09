import { buildPrompt } from './prompt.js';
import { requestCompletion } from './client.js';
import { checkNumbers } from './number-check.js';

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const pp = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}pp`;

/**
 * 模板化解读：全部数值来自程序计算结果，结构与模型输出一致。
 * 调用失败、超时、未配置密钥或数字回查连续失败时使用。
 */
export function buildTemplateNarrative(snapshot) {
  const weeks = snapshot.weeks;
  const label = snapshot.basisMode === 'current' ? '当期口径' : '统一口径';
  const ranked = weeks.slice().sort((a, b) => b.rate - a.rate);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const rates = weeks.map((w) => w.rate);
  const lines = [];

  lines.push('【整体趋势】');
  lines.push(
    `本报告覆盖 ${weeks.length} 个抽检周次、${snapshot.totals.n} 条记录，展示口径为${label}。合格率区间为 ${pct(Math.min(...rates))}–${pct(Math.max(...rates))}。最高为 ${best.label} ${pct(best.rate)}（n=${best.n}），最低为 ${worst.label} ${pct(worst.rate)}（n=${worst.n}）。`,
  );
  lines.push('');

  lines.push('【显著变化】');
  const strong = (snapshot.comparisons || []).filter((c) => c.verdict !== 'flat');
  const flat = (snapshot.comparisons || []).filter((c) => c.verdict === 'flat');
  if (strong.length) {
    strong.slice(0, 3).forEach((c) => {
      lines.push(
        `· ${c.from} → ${c.to}：统一口径合格率差值 ${pp(c.unifiedDelta)}，两周置信区间不重叠，判定为${c.verdict === 'up' ? '有效上升' : '有效下降'}。`,
      );
    });
  } else {
    lines.push('· 本期没有置信区间不重叠的周对，因此不存在可判定的有效变化。');
  }
  if (flat.length) {
    lines.push(
      `· 以下周对的差异落在抽样波动范围内，不构成有效变化：${flat.map((c) => `${c.from}→${c.to}`).join('、')}。`,
    );
  }
  lines.push('');

  lines.push('【异常结构】');
  const byType = snapshot.totals.byType || {};
  const typed = Object.entries(byType)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k} ${v} 项`)
    .join('、');
  lines.push(`共 ${snapshot.totals.anomalyRecords} 条异常记录（记录级），按指标项计 ${snapshot.totals.anomalyItems} 项。${typed}。`);
  const flipped = weeks.filter((w) => w.flips > 0);
  if (flipped.length) {
    lines.push(
      `标准变化影响：${flipped.map((w) => `${w.label} 有 ${w.flips} 条记录的判定在当期与统一口径之间发生翻转`).join('；')}，合计 ${snapshot.totals.flips} 条。该部分差异来自限值调整，不代表质量本身变化。`,
    );
  } else {
    lines.push('标准变化影响：各周当期与统一口径判定一致，无翻转记录。');
  }
  lines.push('');

  lines.push('【待核实事项】');
  const small = weeks.filter((w) => w.small);
  if (small.length) {
    lines.push(
      `· ${small.map((w) => `${w.label}仅 ${w.n} 条记录（阈值 ${snapshot.smallSampleThreshold}）`).join('、')}，样本量不足，相关结论仅供参考，不作为趋势依据。`,
    );
  }
  const firstWeek = weeks[0];
  lines.push(`· ${firstWeek.label}无备注列，其 ${firstWeek.anomalyRecords} 条异常缺少处置记录，无法确认现场处置情况。`);
  if (snapshot.remarks) {
    const units = (snapshot.remarks.allUnits || []).join('、');
    lines.push(
      `· 备注中含 ${snapshot.remarks.scrapCount} 条报废记录，报废量原始单位为${(snapshot.remarks.scrapUnits || []).join('、') || '未标注'}；备注中同时出现${units}两种度量，分属追溯距离与报废量，一律按原文引用，未做求和。`,
    );
  }
  lines.push('· 对于异常集中出现的箱/扎序号，现有数据不足以支撑根因判断：数据不足，无法确认原因。');
  return lines.join('\n');
}

/**
 * 生成解读。任何一步失败都回落到模板文案，保证界面永远有可用结果。
 */
export async function generateNarrative({
  snapshot,
  apiKey,
  rules,
  offline = false,
  fetchImpl,
  log = () => {},
}) {
  const ai = rules.ai;
  const started = Date.now();
  const fallback = (reason) => ({
    text: buildTemplateNarrative(snapshot),
    meta: {
      model: '模板生成（离线兜底）',
      degraded: true,
      reason,
      ms: Date.now() - started,
      check: null,
    },
  });

  if (offline) return fallback('已选择离线模式');
  if (!apiKey) return fallback('未配置密钥');

  const { system, user } = buildPrompt(snapshot);
  let attempts = (ai.numberCheckRetry ?? 1) + 1;
  let lastReason = '';

  while (attempts > 0) {
    attempts -= 1;
    try {
      const { content } = await requestCompletion({
        endpoint: ai.endpoint,
        apiKey,
        model: ai.model,
        system,
        user,
        timeoutMs: ai.timeoutMs,
        fetchImpl,
      });
      const check = checkNumbers(content, snapshot);
      if (check.passed) {
        return {
          text: content,
          meta: {
            model: ai.model,
            degraded: false,
            reason: attempts < (ai.numberCheckRetry ?? 1) ? '首次生成数字回查未通过，已重新生成' : '',
            ms: Date.now() - started,
            check,
          },
        };
      }
      lastReason = `数字回查未通过：${check.unmatched.join('、')}`;
      log(lastReason);
    } catch (error) {
      lastReason = `网络或服务异常：${error.message}`;
      log(lastReason);
      break;
    }
  }
  return fallback(lastReason || '生成失败');
}
