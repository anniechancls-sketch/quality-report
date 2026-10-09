import test from 'node:test';
import assert from 'node:assert/strict';
import { createZip, readZip, crc32 } from '../src/core/ooxml/zip.js';
import { buildXlsx, readXlsx, columnName, columnIndex } from '../src/core/ooxml/xlsx.js';

test('ZIP 往返：普通字符串与高压缩数据都能原样读回', () => {
  const text = 'hello world';
  const repetitive = 'A'.repeat(5000);
  const bin = Buffer.from([0, 1, 2, 250, 251, 252]);
  const zip = createZip([
    { name: 'a.txt', data: text },
    { name: 'nested/b.xml', data: repetitive },
    { name: 'c.bin', data: bin },
  ]);
  const files = readZip(zip);
  assert.equal(files['a.txt'].toString('utf8'), text);
  assert.equal(files['nested/b.xml'].toString('utf8'), repetitive);
  assert.deepEqual([...files['c.bin']], [...bin]);
});

test('ZIP 中文字符名与内容按 UTF-8 处理', () => {
  const zip = createZip([{ name: '中文/表.xml', data: '<a>合格</a>' }]);
  const files = readZip(zip);
  assert.equal(files['中文/表.xml'].toString('utf8'), '<a>合格</a>');
});

test('CRC32 与已知值一致', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('列名与列序号互转正确', () => {
  assert.equal(columnName(0), 'A');
  assert.equal(columnName(25), 'Z');
  assert.equal(columnName(26), 'AA');
  assert.equal(columnIndex('AA1'), 26);
  assert.equal(columnIndex('C12'), 2);
});

test('XLSX 往返：字符串、数字、布尔与空值都能还原', () => {
  const rows = [
    ['箱/扎', '平均外径', '判定是否合格', '备注'],
    [1, 31.756, true, ''],
    [2, 31.482, false, '已反馈班组追溯'],
  ];
  const xlsx = buildXlsx([{ name: '明细', rows }]);
  const sheets = readXlsx(xlsx);
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].name, '明细');
  assert.equal(sheets[0].rows[0][0], '箱/扎');
  assert.equal(sheets[0].rows[1][0], 1);
  assert.equal(sheets[0].rows[1][1], 31.756);
  assert.equal(sheets[0].rows[1][2], true);
  assert.equal(sheets[0].rows[2][2], false);
  assert.equal(sheets[0].rows[2][3], '已反馈班组追溯');
});

test('XLSX 支持多工作表', () => {
  const xlsx = buildXlsx([
    { name: '总览指标', rows: [['周次', '合格率'], ['1周', 0.766]] },
    { name: '异常明细', rows: [['周次', '箱/扎'], ['3周', 3]] },
  ]);
  const sheets = readXlsx(xlsx);
  assert.deepEqual(sheets.map((s) => s.name), ['总览指标', '异常明细']);
});

test('XLSX 读取器能把合并单元格的值扩散到整块区域', () => {
  const withMerge = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="巡检" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>平均外径 要求:31.54-31.94</t></is></c><c r="D1"><v>9</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="A1:C1"/></mergeCells></worksheet>`,
  };
  const xlsx = createZip(
    Object.entries(withMerge).map(([name, data]) => ({ name, data })),
  );
  const sheets = readXlsx(xlsx);
  assert.deepEqual(sheets[0].rows[0].slice(0, 3), [
    '平均外径 要求:31.54-31.94',
    '平均外径 要求:31.54-31.94',
    '平均外径 要求:31.54-31.94',
  ]);
  assert.equal(sheets[0].rows[0][3], 9);
});

test('XLSX 生成结果可被自身的读取器还原为二维数组', () => {
  const rows = [
    ['周次', '样本量', '合格率'],
    ['1周', 77, '76.6%'],
    ['7周', 16, '93.8%'],
  ];
  const back = readXlsx(buildXlsx([{ name: 'S1', rows }]))[0].rows;
  assert.deepEqual(back, rows);
});
