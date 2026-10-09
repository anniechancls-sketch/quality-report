import { buildDocx } from './docx.js';

/**
 * 按需求文档第八章的章节结构组装 Word 报告。
 * charts 为可选的 { ratePng, paretoPng }，缺图时自动降级为仅表格。
 */
export function buildWordReport(model, charts = {}) {
  const blocks = [];
  const imageBlocks = [];

  blocks.push({ type: 'title', text: model.title });
  blocks.push({
    type: 'para',
    text: `生成时间：${model.head.generatedAtText}　｜　覆盖周次：${model.head.coverWeeks}　｜　抽检日期：${model.head.dates}　｜　样本量：${model.head.totalN} 条`,
  });
  blocks.push({ type: 'para', text: `口径说明：${model.head.basis}` });

  blocks.push({ type: 'heading', text: '一、执行摘要' });
  if (model.narrative) {
    model.narrative
      .split('\n')
      .filter((line) => line.trim())
      .forEach((line) => {
        const isHeading = /^【.*】$/.test(line.trim());
        blocks.push(isHeading ? { type: 'heading', level: 2, text: line.trim() } : { type: 'para', text: line });
      });
  } else {
    model.summary.forEach((s) => blocks.push({ type: 'bullet', text: s }));
  }

  blocks.push({ type: 'heading', text: '二、关键指标总览' });
  if (charts.ratePng) {
    const relId = 'rIdImage1';
    imageBlocks.push({ type: 'image', name: 'rate-trend.png', data: charts.ratePng, relId });
    blocks.push({ type: 'image', name: 'rate-trend.png', data: charts.ratePng, relId });
    blocks.push({ type: 'para', text: '图 1 合格率趋势（含 95% 置信区间，带 * 的周次为样本量不足）' });
  } else {
    blocks.push({ type: 'para', text: '（本机未检测到可用浏览器，趋势图已跳过，指标见下表。）' });
  }
  blocks.push({ type: 'table', rows: model.kpiRows, widths: [0.09, 0.13, 0.08, 0.11, 0.11, 0.09, 0.12, 0.08, 0.08, 0.11] });
  blocks.push({ type: 'para', text: '注：* 表示该周样本量不足；判定翻转指当期口径与统一口径判定结果不一致的记录数。' });

  blocks.push({ type: 'heading', text: '三、周间差异对比' });
  blocks.push({
    type: 'para',
    text: '差异拆成三列：数值变化（统一口径下两周之差，可比）、标准变化（该周当期与统一口径之差，反映限值调整的影响）、抽样波动（两周置信区间是否重叠）。',
  });
  blocks.push({ type: 'table', rows: model.compareRows, widths: [0.14, 0.11, 0.17, 0.11, 0.15, 0.15, 0.17] });
  if (model.head.standardChanged.length) {
    blocks.push({ type: 'para', text: `标准变化提示：以下周次的当期限值与统一基准不一致——${model.head.standardChanged.join('；')}。` });
  }

  blocks.push({ type: 'heading', text: '四、异常结构分析' });
  if (charts.paretoPng) {
    const relId = 'rIdImage2';
    imageBlocks.push({ type: 'image', name: 'pareto.png', data: charts.paretoPng, relId });
    blocks.push({ type: 'image', name: 'pareto.png', data: charts.paretoPng, relId });
    blocks.push({ type: 'para', text: '图 2 异常类型帕累托' });
  }
  blocks.push({ type: 'table', rows: model.anomalyRows, widths: [0.4, 0.3, 0.3] });
  blocks.push({ type: 'para', text: '注：记录级合计为存在超限的记录数，指标级合计按涉及的指标项分别累计，两者口径不同，不可混用。' });
  blocks.push({ type: 'heading', level: 2, text: '备注与处置分布' });
  blocks.push({ type: 'table', rows: model.remarkRows, widths: [0.6, 0.4] });

  blocks.push({ type: 'heading', text: '五、结论与建议' });
  blocks.push({ type: 'heading', level: 2, text: '数据支持的结论' });
  model.supported.forEach((s) => blocks.push({ type: 'bullet', text: s }));
  blocks.push({ type: 'heading', level: 2, text: '数据不足、待现场核实的事项' });
  model.insufficient.forEach((s) => blocks.push({ type: 'bullet', text: s }));

  blocks.push({ type: 'pagebreak' });
  blocks.push({ type: 'heading', text: '附录 A　判定规则与口径说明' });
  blocks.push({
    type: 'para',
    text: '判定规则：平均外径须落在当期限值区间内；最小壁厚须不小于壁厚下限；最大壁厚须不大于壁厚上限。三项全部满足判为合格，否则按超限方向归类，一条记录可同时命中多项。',
  });
  const c = model.head.validation?.consistency;
  blocks.push({
    type: 'para',
    text: `判定复算一致率：${c && c.rate !== null && c.rate !== undefined ? `${(c.rate * 100).toFixed(1)}%（可比对 ${c.comparable} 条）` : '不适用（本期无人工判定列）'}。`,
  });
  blocks.push({ type: 'para', text: `口径说明：${model.head.basis}。报告中的差异与结论一律以统一口径为准；当期口径仅用于描述单周自身结果。` });
  blocks.push({ type: 'table', rows: model.limitsTable, widths: [0.1, 0.18, 0.18, 0.2, 0.2, 0.14] });

  blocks.push({ type: 'pagebreak' });
  blocks.push({ type: 'heading', text: '附录 B　各周抽检明细' });
  blocks.push({ type: 'table', rows: model.detailRows, widths: [0.07, 0.07, 0.12, 0.12, 0.12, 0.14, 0.14, 0.09, 0.13] });

  return buildDocx(blocks, { title: model.title });
}
