import { createZip, readZip, toBytes, toText } from './zip.js';

const encoder = new TextEncoder();

export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function unescapeXml(value) {
  return String(value ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

export function columnName(index) {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

export function columnIndex(ref) {
  const letters = String(ref).replace(/[^A-Z]/gi, '').toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function cellXml(ref, value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
  if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function sheetXml(rows) {
  const body = rows
    .map((row, r) => {
      const cells = row.map((value, c) => cellXml(`${columnName(c)}${r + 1}`, value)).join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/** 生成 .xlsx（字符串用 inlineStr，无需共享字符串表） */
export async function buildXlsx(sheets) {
  const files = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('')}</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
        .map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join('')}</Relationships>`,
    },
  ];
  sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows || []) }));
  return createZip(files);
}

function parseSharedStrings(files) {
  const entry = files['xl/sharedStrings.xml'];
  if (!entry) return [];
  const xml = toText(entry);
  const items = xml.match(/<si>[\s\S]*?<\/si>/g) || [];
  return items.map((si) => {
    const texts = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
    return texts.map((t) => unescapeXml(t.replace(/<[^>]+>/g, ''))).join('');
  });
}

function parseMerges(xml) {
  const block = xml.match(/<mergeCells[\s\S]*?<\/mergeCells>/);
  if (!block) return [];
  return [...block[0].matchAll(/ref="([A-Z]+\d+):([A-Z]+\d+)"/g)].map((m) => ({ from: m[1], to: m[2] }));
}

function parseSheet(xml, shared) {
  const rows = [];
  const rowMatches = xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || [];
  rowMatches.forEach((rowXml, rowPos) => {
    const rowAttr = rowXml.match(/<row[^>]*r="(\d+)"/);
    const rowIndex = rowAttr ? Number(rowAttr[1]) - 1 : rowPos;
    const cells = [];
    for (const c of rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g)) {
      const attrs = c[1] ?? c[3] ?? '';
      const body = c[2] ?? '';
      const refMatch = attrs.match(/r="([A-Z]+\d+)"/);
      const col = refMatch ? columnIndex(refMatch[1]) : cells.length;
      const type = (attrs.match(/t="([^"]+)"/) || [])[1] || 'n';
      let value = '';
      if (type === 'inlineStr') {
        const texts = body.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
        value = texts.map((t) => unescapeXml(t.replace(/<[^>]+>/g, ''))).join('');
      } else {
        const v = body.match(/<v>([\s\S]*?)<\/v>/);
        const raw = v ? unescapeXml(v[1]) : '';
        if (type === 's') value = shared[Number(raw)] ?? '';
        else if (type === 'b') value = raw === '1';
        else value = raw === '' ? '' : Number(raw);
      }
      cells[col] = value;
    }
    for (let i = 0; i < cells.length; i += 1) if (cells[i] === undefined) cells[i] = '';
    rows[rowIndex] = cells;
  });
  for (let i = 0; i < rows.length; i += 1) if (!rows[i]) rows[i] = [];

  for (const { from, to } of parseMerges(xml)) {
    const r1 = Number(from.match(/\d+/)[0]) - 1;
    const r2 = Number(to.match(/\d+/)[0]) - 1;
    const c1 = columnIndex(from);
    const c2 = columnIndex(to);
    const value = rows[r1]?.[c1] ?? '';
    for (let r = r1; r <= r2; r += 1) {
      if (!rows[r]) rows[r] = [];
      for (let c = c1; c <= c2; c += 1) {
        if (rows[r][c] === undefined || rows[r][c] === '') rows[r][c] = value;
      }
    }
  }
  return rows;
}

/** 读取 .xlsx，返回 [{ name, rows }] */
export async function readXlsx(bytes) {
  const buf = toBytes(bytes);
  const files = await readZip(buf);
  const workbook = files['xl/workbook.xml'] ? toText(files['xl/workbook.xml']) : '';
  const rels = files['xl/_rels/workbook.xml.rels'] ? toText(files['xl/_rels/workbook.xml.rels']) : '';
  const relMap = new Map();
  for (const m of rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    relMap.set(m[1], m[2].replace(/^\/?xl\//, '').replace(/^\//, ''));
  }
  const shared = parseSharedStrings(files);
  const sheets = [];
  for (const m of workbook.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]+)"/g)) {
    const name = unescapeXml(m[1]);
    const target = relMap.get(m[2]) || '';
    const path = `xl/${target.replace(/^\.\//, '')}`;
    const entry = files[path];
    if (!entry) continue;
    sheets.push({ name, rows: parseSheet(toText(entry), shared) });
  }
  const encoderRef = encoder;
  void encoderRef;
  return sheets;
}
