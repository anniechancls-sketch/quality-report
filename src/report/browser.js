import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROME_PATH,
  `${process.env['ProgramFiles']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

let cachedBrowser;

/** 定位本机浏览器。找不到时返回 null，调用方需走降级路径。 */
export function findBrowser() {
  if (cachedBrowser !== undefined) return cachedBrowser;
  cachedBrowser = CANDIDATES.find((p) => existsSync(p)) || null;
  return cachedBrowser;
}

function withTempHtml(html, fn) {
  const name = `qa-report-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const htmlPath = join(tmpdir(), `${name}.html`);
  writeFileSync(htmlPath, html, 'utf8');
  try {
    return fn(htmlPath);
  } finally {
    rmSync(htmlPath, { force: true });
  }
}

function toFileUrl(path) {
  return `file:///${path.replace(/\\/g, '/')}`;
}

/**
 * 把 HTML 渲染成 PNG。用于把趋势图、帕累托图嵌入 Word 报告。
 * 失败时返回 null，由调用方决定是否跳过图表。
 */
export function renderHtmlToPng(html, { width = 1200, height = 420 } = {}) {
  const browser = findBrowser();
  if (!browser) return null;
  return withTempHtml(html, (htmlPath) => {
    const outPath = join(tmpdir(), `qa-chart-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    try {
      execFileSync(
        browser,
        [
          '--headless=new',
          '--disable-gpu',
          '--no-sandbox',
          '--hide-scrollbars',
          '--force-device-scale-factor=2',
          `--window-size=${width},${height}`,
          `--screenshot=${outPath}`,
          toFileUrl(htmlPath),
        ],
        { stdio: 'ignore', timeout: 60000 },
      );
      if (!existsSync(outPath)) return null;
      return readFileSync(outPath);
    } catch {
      return null;
    } finally {
      rmSync(outPath, { force: true });
    }
  });
}

/**
 * 把 HTML 打印成 PDF。用于 PDF 报告导出。
 * 失败时返回 false，由调用方回落到已有文件或提示用户。
 */
export function printHtmlToPdf(html, outPath) {
  const browser = findBrowser();
  if (!browser) return false;
  return withTempHtml(html, (htmlPath) => {
    try {
      execFileSync(
        browser,
        [
          '--headless=new',
          '--disable-gpu',
          '--no-sandbox',
          '--no-pdf-header-footer',
          `--print-to-pdf=${outPath}`,
          toFileUrl(htmlPath),
        ],
        { stdio: 'ignore', timeout: 120000 },
      );
      return existsSync(outPath);
    } catch {
      return false;
    }
  });
}
