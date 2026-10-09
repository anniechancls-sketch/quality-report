/**
 * 备注归类。规则来源：需求文档 4.7 与 M2。
 * 约束：备注只作说明与文本归类，不改写判定结论；报废量按原文引用，不做求和。
 */

const SCRAP_PATTERN = /报废/;
const UNIT_PATTERNS = [
  { unit: '米', pattern: /[0-9]+(\.[0-9]+)?\s*米/ },
  { unit: '公分', pattern: /[0-9]+(\.[0-9]+)?\s*公分/ },
];

function detectUnits(text) {
  const found = [];
  for (const { unit, pattern } of UNIT_PATTERNS) {
    if (pattern.test(text)) found.push(unit);
  }
  return found;
}

export function categorizeRemarks(rows, categories) {
  const names = Object.keys(categories);
  const counts = Object.fromEntries(names.map((n) => [n, 0]));
  const examples = Object.fromEntries(names.map((n) => [n, []]));
  const scrapTexts = [];
  const scrapUnits = new Set();
  const allUnits = new Set();
  let total = 0;

  for (const row of rows) {
    const text = (row.remark || '').trim();
    if (!text) continue;
    total += 1;

    for (const unit of detectUnits(text)) allUnits.add(unit);

    for (const name of names) {
      const keywords = categories[name];
      if (!keywords.length) continue;
      const hit = keywords.every((k) => text.includes(k));
      if (hit) {
        counts[name] += 1;
        if (examples[name].length < 3) examples[name].push(text);
      }
    }

    if (SCRAP_PATTERN.test(text)) {
      scrapTexts.push(text);
      for (const unit of detectUnits(text)) scrapUnits.add(unit);
    }
  }

  return {
    total,
    counts,
    examples,
    scrapTexts,
    scrapCount: scrapTexts.length,
    /** 报废量本身使用的单位，本样例中统一为「米」 */
    scrapUnits: [...scrapUnits],
    /** 全部备注中出现过的单位，本样例中同时含「米」与「公分」 */
    allUnits: [...allUnits],
    /** 备注整体存在多种单位，因此禁止直接求和 */
    unitMixed: allUnits.size > 1,
  };
}

/**
 * 报废量一律按原文引用。单位混用时给出显式提示，避免读者误把不同单位的数字相加。
 */
export function describeScrap(analysis) {
  if (!analysis.scrapCount) return '本期备注中没有报废记录。';
  const scrapUnitText = analysis.scrapUnits.length
    ? `报废量原始单位为${analysis.scrapUnits.join('、')}`
    : '报废量未标注单位';
  const mixedText = analysis.unitMixed
    ? `；备注中同时出现${analysis.allUnits.join('、')}两种度量，分属追溯距离与报废量，属不同物理量`
    : '';
  return `备注中含 ${analysis.scrapCount} 条报废记录，${scrapUnitText}${mixedText}，一律按原文引用，未做求和。`;
}
