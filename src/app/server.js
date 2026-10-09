import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { loadRules } from '../core/config.js';
import { parseCsv, readHeader, suggestMapping } from '../core/csv.js';
import { readXlsx } from '../core/ooxml/xlsx.js';
import { buildWeek } from '../core/mapping.js';
import { judgeRow } from '../core/judge.js';
import { buildMetrics } from '../core/metrics.js';
import { buildComparisons, selectPairs, buildSnapshot } from '../core/compare.js';
import { categorizeRemarks, describeScrap } from '../core/remarks.js';
import { validateDataset } from '../core/validate.js';
import { generateNarrative, buildTemplateNarrative } from '../ai/narrative.js';
import { exportReports } from '../report/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
const PUBLIC_DIR = join(ROOT, 'public');
const OUTPUT_DIR = join(ROOT, 'output');
const SAMPLES_DIR = join(ROOT, 'data', 'samples');
const MAX_BODY = 40 * 1024 * 1024;

const FIELD_KEYWORDS = {
  boxNo: ['箱/扎', '箱', '扎'],
  outerDiameter: ['平均外径', '外径'],
  minWall: ['最小壁厚'],
  maxWall: ['最大壁厚'],
  verdict: ['判定'],
  remark: ['备注'],
};

const sessions = new Map();

/* ---------- 解析上传文件 ---------- */

function parseUploadedFile(file) {
  const buffer = Buffer.from(file.base64 || '', 'base64');
  const lower = String(file.name || '').toLowerCase();
  let sheets;
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
    sheets = readXlsx(buffer);
  } else if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    const text = buffer.toString('utf8');
    sheets = [{ name: 'Sheet1', rows: parseCsv(text) }];
  } else {
    throw new Error(`不支持的文件类型：${file.name}（当前支持 .xlsx / .csv）`);
  }
  if (!sheets.length) throw new Error(`文件为空或无法解析：${file.name}`);

  return {
    name: file.name,
    sheets: sheets.map((sheet) => {
      const header = readHeader(sheet.rows, 0);
      return {
        name: sheet.name,
        header,
        preview: sheet.rows.slice(0, 6),
        rowCount: Math.max(0, sheet.rows.length - 1),
        suggestion: suggestMapping(header, FIELD_KEYWORDS),
        rawRows: sheet.rows,
      };
    }),
  };
}

function loadSampleDataset() {
  const raw = JSON.parse(readFileSync(join(SAMPLES_DIR, 'weeks.json'), 'utf8'));
  return raw.weeks.map((w, i) => ({
    label: w.label,
    date: w.date,
    limits: { ...w.limits },
    rows: w.rows.map((r) => ({ ...r })),
    sourceName: `${w.label}.csv`,
  }));
}

function sessionFilesFromSamples() {
  return readdirSync(SAMPLES_DIR)
    .filter((f) => f.endsWith('.csv'))
    .sort()
    .map((name) => {
      const text = readFileSync(join(SAMPLES_DIR, name), 'utf8');
      const rows = parseCsv(text);
      const header = readHeader(rows, 0);
      return {
        name,
        isSample: true,
        sheets: [
          {
            name: 'Sheet1',
            header,
            preview: rows.slice(0, 6),
            rowCount: Math.max(0, rows.length - 1),
            suggestion: suggestMapping(header, FIELD_KEYWORDS),
            rawRows: rows,
          },
        ],
      };
    });
}

/* ---------- 分析 ---------- */

function buildSessionDataset(session, spec) {
  const weeks = spec.map((item) => {
    const file = session.files[item.fileIndex];
    if (!file) throw new Error(`文件索引无效：${item.fileIndex}`);
    const sheet = file.sheets[item.sheetIndex || 0];
    const rows = sheet.rawRows;
    if (!rows) throw new Error(`文件 ${file.name} 的行数据不可用，请重新导入`);
    return buildWeek({
      label: item.label,
      date: item.date,
      limits: item.limits,
      rows,
      headerRowIndex: 0,
      mapping: item.mapping,
      sheetName: sheet.name,
    });
  });
  return { weeks };
}

function analyze(session, { spec, basisLimits, basisMode = 'current', pairLabels = [] }) {
  const dataset = buildSessionDataset(session, spec);
  const rules = loadRules();
  const metrics = buildMetrics(dataset.weeks, basisLimits, rules);
  const comparisons =
    pairLabels && pairLabels.length
      ? selectPairs(metrics, pairLabels)
      : buildComparisons(metrics, 'chain');
  const remarks = categorizeRemarks(
    dataset.weeks.flatMap((w) => w.rows),
    rules.remarkCategories,
  );
  const validation = validateDataset(dataset.weeks, rules);
  const snapshot = buildSnapshot(metrics, basisMode, rules, comparisons, remarks);

  session.dataset = dataset;
  session.metrics = metrics;
  session.comparisons = comparisons;
  session.remarks = remarks;
  session.validation = validation;
  session.snapshot = snapshot;
  session.spec = spec;

  return {
    validation,
    snapshot,
    view: {
      basisMode,
      basisLimits,
      validation,
      weeks: metrics.weeks.map((w, i) => ({
        ...snapshot.weeks[i],
        limitsChanged: w.standardChanged,
      })),
      totals: snapshot.totals,
      comparisons: snapshot.comparisons,
      remarks: {
        total: remarks.total,
        counts: remarks.counts,
        scrapCount: remarks.scrapCount,
        scrapUnits: remarks.scrapUnits,
        allUnits: remarks.allUnits,
        description: describeScrap(remarks),
      },
      anomalyDetail: collectAnomalies(dataset, metrics),
      limitsTable: dataset.weeks.map((w, i) => ({
        label: w.label,
        limits: w.limits,
        uniform: !metrics.weeks[i].standardChanged,
      })),
    },
  };
}

function collectAnomalies(dataset, metrics) {
  const list = [];
  dataset.weeks.forEach((week, wi) => {
    week.rows.forEach((row) => {
      const current = judgeRow(row, week.limits);
      if (current.pass) return;
      const unified = judgeRow(row, metrics.basisLimits);
      list.push({
        week: week.label,
        boxNo: row.boxNo,
        outerDiameter: row.outerDiameter,
        minWall: row.minWall,
        maxWall: row.maxWall,
        issues: current.issues,
        unifiedIssues: unified.issues,
        flipped: current.pass !== unified.pass,
        remark: row.remark || '',
        verdictManual: row.verdictManual,
      });
    });
  });
  return list;
}

/* ---------- HTTP ---------- */

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/**
 * 访问口令校验。
 * 未设置 ACCESS_PASSWORD 时不启用（本机与局域网使用）；
 * 一旦设置，除健康检查外全部页面与接口都要求 HTTP Basic 口令。
 * 公网部署前必须设置该环境变量。
 */
function requireAccess(req, res, url) {
  const password = process.env.ACCESS_PASSWORD;
  if (!password) return true;
  if (url.pathname === '/healthz') return true;

  const header = req.headers.authorization || '';
  const matched = header.match(/^Basic\s+(.+)$/i);
  if (matched) {
    const decoded = Buffer.from(matched[1], 'base64').toString('utf8');
    const pass = decoded.slice(decoded.indexOf(':') + 1);
    if (pass === password) return true;
  }
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="quality-report", charset="UTF-8"',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end('需要访问口令');
  return false;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, filePath, type) {
  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('未找到资源');
    return;
  }
  const data = readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length });
  res.end(data);
}

export function createApp() {
  return createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    try {
      if (req.method === 'GET' && path === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('ok');
      }
      if (!requireAccess(req, res, url)) return;

      if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
        return serveStatic(res, join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && path.startsWith('/public/')) {
        const rel = normalize(path.replace('/public/', '')).replace(/^(\.\.[/\\])+/, '');
        const ext = rel.split('.').pop();
        const type = ext === 'css' ? 'text/css; charset=utf-8' : ext === 'js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
        return serveStatic(res, join(PUBLIC_DIR, rel), type);
      }

      if (req.method === 'GET' && path === '/api/rules') {
        return json(res, 200, loadRules());
      }

      if (req.method === 'POST' && path === '/api/session') {
        const body = await readBody(req);
        const id = randomBytes(8).toString('hex');
        let files;
        if (body.source === 'sample') {
          files = sessionFilesFromSamples();
        } else {
          const uploaded = Array.isArray(body.files) ? body.files : [];
          if (!uploaded.length) return json(res, 400, { error: '未收到文件' });
          files = uploaded.map(parseUploadedFile);
        }
        const session = { id, files, createdAt: new Date() };
        sessions.set(id, session);
        const sampleWeeks = loadSampleDataset();
        return json(res, 200, {
          sessionId: id,
          files: files.map((f, i) => ({
            index: i,
            name: f.name,
            sheets: f.sheets.map((s) => ({
              name: s.name,
              header: s.header,
              preview: s.preview,
              rowCount: s.rowCount,
              suggestion: s.suggestion,
            })),
            suggestedLabel: sampleWeeks[i]?.label || `${i + 1}周`,
            suggestedDate: sampleWeeks[i]?.date || '',
            suggestedLimits: sampleWeeks[i]?.limits || { outerMin: 31.46, outerMax: 32.02, wallMin: 1.78, wallMax: 2.11 },
          })),
        });
      }

      const sessionMatch = path.match(/^\/api\/session\/([a-f0-9]+)\/(analyze|narrative|export|download\/.+)$/);
      if (sessionMatch) {
        const session = sessions.get(sessionMatch[1]);
        if (!session) return json(res, 404, { error: '会话已失效，请重新导入数据' });
        const action = sessionMatch[2];

        if (action === 'analyze' && req.method === 'POST') {
          const body = await readBody(req);
          const rules = loadRules();
          const basisLimits = body.basisLimits || rules.presets[rules.defaultPreset].limits;
          const result = analyze(session, {
            spec: body.spec || [],
            basisLimits,
            basisMode: body.basisMode || 'current',
            pairLabels: body.pairLabels || [],
          });
          return json(res, 200, result);
        }

        if (action === 'narrative' && req.method === 'POST') {
          const body = await readBody(req);
          if (!session.snapshot) return json(res, 400, { error: '请先完成分析' });
          const apiKey = body.apiKey || process.env.DEEPSEEK_API_KEY || '';
          const result = body.useTemplate
            ? { text: buildTemplateNarrative(session.snapshot), meta: { model: '模板生成', degraded: true, reason: '用户选择模板生成', ms: 0, check: null } }
            : await generateNarrative({
                snapshot: session.snapshot,
                apiKey,
                rules: loadRules(),
                offline: Boolean(body.offline),
              });
          session.narrative = result.text;
          return json(res, 200, result);
        }

        if (action === 'export' && req.method === 'POST') {
          const body = await readBody(req);
          if (!session.metrics) return json(res, 400, { error: '请先完成分析' });
          const { files } = exportReports({
            dataset: session.dataset,
            metrics: session.metrics,
            comparisons: session.comparisons,
            remarks: session.remarks,
            basisMode: body.basisMode || 'current',
            rules: loadRules(),
            narrative: body.narrative ?? session.narrative ?? null,
            validation: session.validation,
            formats: body.formats || ['word', 'excel', 'pdf'],
            outDir: OUTPUT_DIR,
          });
          return json(res, 200, {
            files: files.map((f) => ({
              ...f,
              downloadUrl: f.ok ? `/api/session/${session.id}/download/${encodeURIComponent(f.name)}` : null,
            })),
          });
        }

        if (action.startsWith('download/') && req.method === 'GET') {
          const name = decodeURIComponent(action.replace('download/', ''));
          const safe = normalize(name).replace(/^(\.\.[/\\])+/, '');
          const filePath = join(OUTPUT_DIR, safe);
          if (!filePath.startsWith(OUTPUT_DIR) || !existsSync(filePath)) {
            return json(res, 404, { error: '文件不存在' });
          }
          const data = readFileSync(filePath);
          const ext = safe.split('.').pop();
          const mime =
            ext === 'pdf'
              ? 'application/pdf'
              : ext === 'docx'
                ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          res.writeHead(200, {
            'Content-Type': mime,
            'Content-Length': data.length,
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safe)}`,
          });
          return res.end(data);
        }
      }

      json(res, 404, { error: '接口不存在' });
    } catch (error) {
      json(res, 500, { error: error.message || '服务内部错误' });
    }
  });
}

export function localAddresses(port) {
  const list = [];
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) list.push(`http://${net.address}:${port}`);
    }
  }
  return list;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1]);
if (isMain) {
  const portArg = process.argv.indexOf('--port');
  const hostArg = process.argv.indexOf('--host');
  const port = portArg > -1 ? Number(process.argv[portArg + 1]) : Number(process.env.PORT || 8787);
  const host = hostArg > -1 ? process.argv[hostArg + 1] : process.env.HOST || '0.0.0.0';
  const server = createApp();
  server.listen(port, host, () => {
    console.log(`质量数据分析与报告生成工具已启动`);
    console.log(`  本机访问：http://localhost:${port}`);
    for (const addr of localAddresses(port)) console.log(`  局域网访问：${addr}`);
    console.log(`  导出目录：${OUTPUT_DIR}`);
    if (process.env.ACCESS_PASSWORD) {
      console.log('  访问口令：已启用（浏览器会弹出登录框，用户名随意填，口令为 ACCESS_PASSWORD）');
    } else {
      console.log('  访问口令：未启用（仅建议本机或内网使用）');
    }
  });
}
