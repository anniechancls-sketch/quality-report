import { checkNumbers } from './number-check.js';

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const pp = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}pp`;

const SYSTEM_PROMPT = [
  '你是质量数据分析助手。用户会给你一份已经计算完成的指标快照（JSON），你的任务是把这些指标转写成质量人员可以直接使用的说明文字。',
  '',
  '必须遵守的硬约束：',
  '1. 不得进行任何数值计算、推算、插值或补全，正文中的每个数字都必须原样来自输入 JSON。',
  '2. 不得做出没有数据支撑的根因推断。',
  '3. 数据不足时固定输出「数据不足，无法确认原因」。',
  '4. 落在抽样波动范围内的差异（JSON 中 verdict 为 flat）不得表述为上升、下降、改善或恶化。',
  '5. 记录级异常数与指标级异常项是两个不同口径，引用时必须标明。',
  '6. 报废量只允许按原文引用，不得求和或换算单位。',
  '',
  '严格输出四个小节，标题用中文方括号包裹：【整体趋势】【显著变化】【异常结构】【待核实事项】。',
  '使用简洁的中文书面语，不写寒暄，不使用感叹号。',
].join('\n');

/** 模板化解读：全部数值取自程序计算结果 */
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
      lines.push(`· ${c.from} → ${c.to}：统一口径合格率差值 ${pp(c.unifiedDelta)}，两周置信区间不重叠，判定为${c.verdict === 'up' ? '有效上升' : '有效下降'}。`);
    });
  } else {
    lines.push('· 本期没有置信区间不重叠的周对，因此不存在可判定的有效变化。');
  }
  if (flat.length) {
    lines.push(`· 以下周对的差异落在抽样波动范围内，不构成有效变化：${flat.map((c) => `${c.from}→${c.to}`).join('、')}。`);
  }
  lines.push('');

  lines.push('【异常结构】');
  const byType = snapshot.totals.byType || {};
  const typed = Object.entries(byType).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v} 项`).join('、');
  lines.push(`共 ${snapshot.totals.anomalyRecords} 条异常记录（记录级），按指标项计 ${snapshot.totals.anomalyItems} 项。${typed}。`);
  const flipped = weeks.filter((w) => w.flips > 0);
  if (flipped.length) {
    lines.push(`标准变化影响：${flipped.map((w) => `${w.label} 有 ${w.flips} 条记录的判定在当期与统一口径之间发生翻转`).join('；')}，合计 ${snapshot.totals.flips} 条。该部分差异来自限值调整，不代表质量本身变化。`);
  } else {
    lines.push('标准变化影响：各周当期与统一口径判定一致，无翻转记录。');
  }
  lines.push('');

  lines.push('【待核实事项】');
  const small = weeks.filter((w) => w.small);
  if (small.length) {
    lines.push(`· ${small.map((w) => `${w.label}仅 ${w.n} 条记录（阈值 ${snapshot.smallSampleThreshold}）`).join('、')}，样本量不足，相关结论仅供参考，不作为趋势依据。`);
  }
  const first = weeks[0];
  lines.push(`· ${first.label}无备注列，其 ${first.anomalyRecords} 条异常缺少处置记录，无法确认现场处置情况。`);
  if (snapshot.remarks) {
    lines.push(`· 备注中含 ${snapshot.remarks.scrapCount} 条报废记录，报废量原始单位为${(snapshot.remarks.scrapUnits || []).join('、') || '未标注'}；备注中同时出现${(snapshot.remarks.allUnits || []).join('、')}两种度量，分属追溯距离与报废量，一律按原文引用，未做求和。`);
  }
  lines.push('· 对于异常集中出现的箱/扎序号，现有数据不足以支撑根因判断：数据不足，无法确认原因。');
  return lines.join('\n');
}

/**
 * 生成解读：默认可选在线调用（浏览器直连 DeepSeek，Key 只存在当前页面内存里），
 * 任何失败都回落模板文案。数字回查在浏览器内完成。
 */
export async function generateNarrative({ snapshot, apiKey, rules, offline = false, fetchImpl = fetch }) {
  const started = Date.now();
  const fallback = (reason) => ({
    text: buildTemplateNarrative(snapshot),
    meta: { model: '模板生成（离线兜底）', degraded: true, reason, ms: Date.now() - started, check: null },
  });
  if (offline || !apiKey) return fallback(offline ? '已选择离线模式' : '未配置密钥');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), rules.ai.timeoutMs);
  try {
    const res = await fetchImpl(rules.ai.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: rules.ai.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `以下是程序计算好的指标快照（JSON），请据此撰写解读。不要新增任何未出现在本 JSON 中的数值。\n\n${JSON.stringify(snapshot, null, 2)}` },
        ],
        temperature: 0.2,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`模型返回 ${res.status}：${detail.slice(0, 160)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('模型返回内容为空');
    const check = checkNumbers(content, snapshot);
    if (!check.passed) {
      return fallback(`数字回查未通过：${check.unmatched.join('、')}`);
    }
    return { text: content, meta: { model: rules.ai.model, degraded: false, reason: '', ms: Date.now() - started, check } };
  } catch (error) {
    return fallback(error.name === 'AbortError' ? `调用超时（${rules.ai.timeoutMs} ms）` : `网络或服务异常：${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}
