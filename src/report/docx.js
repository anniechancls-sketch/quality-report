import { createZip } from '../core/ooxml/zip.js';
import { escapeXml } from '../core/ooxml/xlsx.js';

const EMU_PER_INCH = 914400;
const CONTENT_WIDTH_INCH = 6.0;

function readPngSize(buffer) {
  if (buffer.length < 24) return { width: 800, height: 400 };
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function runs(text) {
  const parts = String(text ?? '').split('\n');
  return parts
    .map((p, i) => `${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${escapeXml(p)}</w:t>`)
    .join('');
}

function para(text, style) {
  return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r>${runs(text)}</w:r></w:p>`;
}

function bullet(text) {
  return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:ind w:left="420" w:hanging="210"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r>${runs('· ')}</w:r><w:r>${runs(text)}</w:r></w:p>`;
}

function table(rows, options = {}) {
  const widths = options.widths;
  const colCount = Math.max(...rows.map((r) => r.length));
  const totalWidth = CONTENT_WIDTH_INCH * 1440;
  const colWidths = Array.from({ length: colCount }, (_, i) => {
    if (widths && widths[i]) return Math.round(totalWidth * widths[i]);
    return Math.round(totalWidth / colCount);
  });
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="DCDFE6"/>`)
    .join('');

  const body = rows
    .map((row, r) => {
      const isHead = options.headerRow !== false && r === 0;
      const cells = Array.from({ length: colCount }, (_, c) => {
        const value = row[c] ?? '';
        const shading = isHead ? '<w:shd w:val="clear" w:fill="F5F7FA"/>' : '';
        const bold = isHead ? '<w:rPr><w:b/></w:rPr>' : '';
        return `<w:tc><w:tcPr><w:tcW w:w="${colWidths[c]}" w:type="dxa"/>${shading}</w:tcPr><w:p><w:r>${bold}${runs(value)}</w:r></w:p></w:tc>`;
      }).join('');
      return `<w:tr>${isHead ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells}</w:tr>`;
    })
    .join('');

  const grid = colWidths.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${totalWidth}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl><w:p/>`;
}

function imageBlock(image, index) {
  const { width, height } = readPngSize(image.data);
  const cx = Math.round(CONTENT_WIDTH_INCH * EMU_PER_INCH);
  const cy = Math.round((cx * height) / width);
  const id = index + 1;
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${escapeXml(image.name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${image.relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function renderBlock(block, imageCounter) {
  switch (block.type) {
    case 'title':
      return para(block.text, 'Title');
    case 'heading':
      return para(block.text, block.level === 2 ? 'Heading2' : 'Heading1');
    case 'para':
      return para(block.text);
    case 'bullet':
      return bullet(block.text);
    case 'table':
      return table(block.rows, { widths: block.widths, headerRow: block.headerRow });
    case 'image': {
      const xml = imageBlock(block, imageCounter.value);
      imageCounter.value += 1;
      return xml;
    }
    case 'pagebreak':
      return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    case 'spacer':
      return '<w:p/>';
    default:
      return para(String(block.text ?? ''));
  }
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI" w:eastAsia="Microsoft YaHei"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="240" w:after="240"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="280" w:after="140"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="220" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr></w:style>
</w:styles>`;

/**
 * 生成 .docx。blocks 为内容块数组，图片块需带 data(PNG Buffer) 与 relId。
 */
export function buildDocx(blocks, options = {}) {
  const images = blocks.filter((b) => b.type === 'image');
  const counter = { value: 0 };
  const bodyXml = blocks.map((b) => renderBlock(b, counter)).join('');

  const files = [];
  files.push({
    name: '[Content_Types].xml',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
  });
  files.push({
    name: '_rels/.rels',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
  });
  files.push({
    name: 'docProps/core.xml',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeXml(options.title || '质量数据分析报告')}</dc:title><dc:creator>${escapeXml(options.author || '质量数据分析与报告生成工具')}</dc:creator></cp:coreProperties>`,
  });
  files.push({ name: 'word/styles.xml', data: STYLES });

  const docNamespaces = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`;
  files.push({
    name: 'word/document.xml',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${docNamespaces}><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418"/></w:sectPr></w:body></w:document>`,
  });

  if (images.length) {
    const rels = images
      .map(
        (img, i) =>
          `<Relationship Id="${img.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${img.name}"/>`,
      )
      .join('');
    files.push({
      name: 'word/_rels/document.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
    });
    images.forEach((img) => {
      files.push({ name: `word/media/${img.name}`, data: img.data });
    });
  }

  return createZip(files);
}
