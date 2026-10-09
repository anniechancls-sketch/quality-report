/**
 * CSV 解析。支持 BOM、CRLF、双引号包裹、字段内逗号与换行、双引号转义。
 * 实现依据 RFC 4180，用于兜底导入真实现场文件。
 */
export function parseCsv(text) {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += ch === '\r' && input[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  while (rows.length && rows[rows.length - 1].every((c) => String(c).trim() === '')) {
    rows.pop();
  }
  return rows.map((r) => r.map((c) => String(c).trim()));
}

/** 取表头行：返回去重后的列名与原始索引，便于应对重复列名（如两列「测量工具」） */
export function readHeader(rows, headerRowIndex = 0) {
  const raw = rows[headerRowIndex] || [];
  const seen = new Map();
  return raw.map((name, index) => {
    const count = (seen.get(name) || 0) + 1;
    seen.set(name, count);
    return {
      index,
      name,
      label: count > 1 ? `${name}（第 ${count} 列）` : name,
      duplicate: count > 1,
    };
  });
}

/** 按表头关键字模糊匹配列，用于给出默认映射建议，最终仍需用户确认 */
export function suggestMapping(header, fieldKeywords) {
  const result = {};
  const used = new Set();
  for (const [field, keywords] of Object.entries(fieldKeywords)) {
    const hit = header.find(
      (h) => !used.has(h.index) && keywords.some((k) => h.name.includes(k)),
    );
    if (hit) {
      result[field] = hit.index;
      used.add(hit.index);
    } else {
      result[field] = null;
    }
  }
  return result;
}
