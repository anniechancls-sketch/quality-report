/**
 * 极简静态服务器，仅用于本地预览 site/ 目录（Vercel 上不需要它）。
 * 用法：node tools/serve-static.js [--port 8080]
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', 'site');
const portArg = process.argv.indexOf('--port');
const port = portArg > -1 ? Number(process.argv[portArg + 1]) : 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // 仅用于本地自检：页面把自检结果 POST 回来，落到 output/selftest.json
  if (req.method === 'POST' && url.pathname === '/__selftest') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const target = join(here, '..', 'output', 'selftest.json');
      writeFileSync(target, Buffer.concat(chunks));
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
    return;
  }

  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel.endsWith('/')) rel += 'index.html';
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]/, '');
  const filePath = join(ROOT, safe);
  if (!filePath.startsWith(ROOT) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('未找到资源');
  }
  const data = readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': TYPES[extname(filePath)] || 'application/octet-stream' });
  res.end(data);
}).listen(port, () => {
  console.log(`静态预览已启动：http://localhost:${port}  （目录：${ROOT}）`);
});
