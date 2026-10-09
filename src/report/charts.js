const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function page(svg, width, height) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#fff;width:${width}px;height:${height}px;}
svg{display:block}
text{font-family:"Microsoft YaHei",Arial,sans-serif}
</style></head><body>${svg}</body></html>`;
}

/**
 * 合格率趋势图：折线 + 95% 置信区间带，小样本周以虚线点区分。
 * 输出完整 HTML，供浏览器无头渲染成 PNG 后插入 Word 报告。
 */
export function rateTrendSvg({ labels, rates, otherRates, band, smallFlags, width = 1200, height = 420 }) {
  const P = { l: 90, r: 40, t: 30, b: 60 };
  const iw = width - P.l - P.r;
  const ih = height - P.t - P.b;
  const pool = [...rates, ...(otherRates || [])];
  if (band) band.forEach((b) => b && pool.push(b[0], b[1]));
  let lo = Math.min(...pool, 0);
  let hi = Math.max(...pool, 1);
  const X = (i) => P.l + (labels.length < 2 ? iw / 2 : (i * iw) / (labels.length - 1));
  const Y = (v) => P.t + ih - ((v - lo) / (hi - lo || 1)) * ih;
  const fmt = (v) => `${(v * 100).toFixed(1)}%`;

  let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  svg += `<rect width="${width}" height="${height}" fill="#ffffff"/>`;
  for (let t = 0; t <= 4; t += 1) {
    const y = P.t + (ih * t) / 4;
    const v = hi - ((hi - lo) * t) / 4;
    svg += `<line x1="${P.l}" y1="${y}" x2="${width - P.r}" y2="${y}" stroke="#EBEEF5"/>`;
    svg += `<text x="${P.l - 12}" y="${y + 5}" font-size="16" fill="#909399" text-anchor="end">${fmt(v)}</text>`;
  }
  if (band) {
    let pts = '';
    band.forEach((b, i) => {
      if (b) pts += `${X(i)},${Y(b[1])} `;
    });
    for (let i = band.length - 1; i >= 0; i -= 1) {
      const b = band[i];
      if (b) pts += `${X(i)},${Y(b[0])} `;
    }
    svg += `<polygon points="${pts.trim()}" fill="#409EFF" opacity="0.16"/>`;
  }
  if (otherRates) {
    const d = otherRates.map((v, i) => `${i ? 'L' : 'M'}${X(i)},${Y(v)}`).join(' ');
    svg += `<path d="${d}" fill="none" stroke="#A0CFFF" stroke-width="2.5" stroke-dasharray="8 5"/>`;
  }
  const line = rates.map((v, i) => `${i ? 'L' : 'M'}${X(i)},${Y(v)}`).join(' ');
  svg += `<path d="${line}" fill="none" stroke="#409EFF" stroke-width="4" stroke-linejoin="round"/>`;
  rates.forEach((v, i) => {
    const small = smallFlags && smallFlags[i];
    svg += small
      ? `<circle cx="${X(i)}" cy="${Y(v)}" r="7" fill="#ffffff" stroke="#409EFF" stroke-width="3" stroke-dasharray="3 3"/>`
      : `<circle cx="${X(i)}" cy="${Y(v)}" r="6" fill="#409EFF"/>`;
    svg += `<text x="${X(i)}" y="${Y(v) - 18}" font-size="17" fill="#303133" text-anchor="middle">${fmt(v)}</text>`;
    svg += `<text x="${X(i)}" y="${height - 24}" font-size="17" fill="#606266" text-anchor="middle">${esc(labels[i])}${small ? ' *' : ''}</text>`;
  });
  svg += `<text x="${P.l}" y="${height - 6}" font-size="14" fill="#909399">实线为当前口径合格率，浅色虚线为对照口径，阴影为 95% 置信区间；* 表示样本量不足</text>`;
  return `${svg}</svg>`;
}

export function rateTrendHtml(options) {
  const { width = 1200, height = 420 } = options;
  return page(rateTrendSvg(options), width, height);
}

/** 异常类型帕累托图：柱为记录级计数，折线为累计占比 */
export function paretoSvg(items, { width = 1200, height = 420 } = {}) {
  const P = { l: 90, r: 90, t: 30, b: 70 };
  const iw = width - P.l - P.r;
  const ih = height - P.t - P.b;
  const max = Math.max(...items.map((i) => i.count), 1);
  const total = items.reduce((s, i) => s + i.count, 0) || 1;
  let acc = 0;
  let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  svg += `<rect width="${width}" height="${height}" fill="#ffffff"/>`;
  for (let t = 0; t <= 4; t += 1) {
    const y = P.t + (ih * t) / 4;
    svg += `<line x1="${P.l}" y1="${y}" x2="${width - P.r}" y2="${y}" stroke="#EBEEF5"/>`;
    svg += `<text x="${P.l - 12}" y="${y + 5}" font-size="16" fill="#909399" text-anchor="end">${Math.round(max - (max * t) / 4)}</text>`;
    svg += `<text x="${width - P.r + 12}" y="${y + 5}" font-size="16" fill="#909399">${100 - 25 * t}%</text>`;
  }
  const barWidth = Math.min(120, (iw / items.length) * 0.5);
  const points = [];
  items.forEach((item, i) => {
    const x = P.l + (iw * (i + 0.5)) / items.length;
    const h = (item.count / max) * ih;
    const y = P.t + ih - h;
    svg += `<rect x="${x - barWidth / 2}" y="${y}" width="${barWidth}" height="${h}" rx="3" fill="#409EFF" opacity="0.88"/>`;
    svg += `<text x="${x}" y="${y - 10}" font-size="18" fill="#303133" text-anchor="middle">${item.count}</text>`;
    svg += `<text x="${x}" y="${height - 34}" font-size="17" fill="#606266" text-anchor="middle">${esc(item.type)}</text>`;
    acc += item.count;
    points.push([x, P.t + ih - (acc / total) * ih]);
  });
  if (points.length > 1) {
    svg += `<path d="${points.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ')}" fill="none" stroke="#E6A23C" stroke-width="3"/>`;
  }
  points.forEach((p) => {
    svg += `<circle cx="${p[0]}" cy="${p[1]}" r="5" fill="#E6A23C"/>`;
  });
  svg += `<text x="${P.l}" y="${height - 8}" font-size="14" fill="#909399">柱为异常记录数，折线为累计占比</text>`;
  return `${svg}</svg>`;
}

export function paretoHtml(items, options = {}) {
  const { width = 1200, height = 420 } = options;
  return page(paretoSvg(items, options), width, height);
}
