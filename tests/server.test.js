import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app/server.js';
import { buildXlsx } from '../src/core/ooxml/xlsx.js';

let server;
let base;

test.before(async () => {
  server = createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const getJson = async (path) => {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.json() };
};
const postJson = async (path, payload) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
};

test('GET / 返回前端页面', async () => {
  const res = await fetch(base + '/');
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /质量数据分析/);
  assert.match(html, /id="useSample"/);
});

test('GET /api/rules 返回限值与阈值配置', async () => {
  const { status, body } = await getJson('/api/rules');
  assert.equal(status, 200);
  assert.equal(body.smallSampleThreshold, 30);
  assert.deepEqual(body.presets.latest.limits, {
    outerMin: 31.46,
    outerMax: 32.02,
    wallMin: 1.78,
    wallMax: 2.11,
  });
});

test('内置样例可以完整走通：导入 → 分析 → 解读 → 导出 → 下载', async () => {
  const created = await postJson('/api/session', { source: 'sample' });
  assert.equal(created.status, 200);
  assert.equal(created.body.files.length, 7);
  assert.deepEqual(
    created.body.files.map((f) => f.sheets[0].rowCount),
    [77, 62, 58, 67, 82, 90, 16],
  );
  assert.equal(created.body.files[0].sheets[0].suggestion.outerDiameter, 1);
  assert.equal(created.body.files[0].sheets[0].suggestion.remark, null, '1周表无备注列');

  const spec = created.body.files.map((f) => ({
    fileIndex: f.index,
    sheetIndex: 0,
    label: f.suggestedLabel,
    date: f.suggestedDate,
    limits: f.suggestedLimits,
    mapping: f.sheets[0].suggestion,
  }));

  const analyzed = await postJson(`/api/session/${created.body.sessionId}/analyze`, {
    spec,
    basisLimits: { outerMin: 31.46, outerMax: 32.02, wallMin: 1.78, wallMax: 2.11 },
    basisMode: 'current',
    pairLabels: [['3周', '5周']],
  });
  assert.equal(analyzed.status, 200);
  const view = analyzed.body.view;
  assert.equal(view.totals.n, 452);
  assert.equal(view.totals.anomalyRecords, 62);
  assert.equal(view.totals.anomalyItems, 63);
  assert.equal(view.totals.flips, 14);
  assert.equal((view.weeks[0].rate * 100).toFixed(1), '76.6');
  assert.equal(view.comparisons.length, 1);
  assert.equal(view.comparisons[0].verdict, 'flat');
  assert.equal(view.anomalyDetail.length, 62);

  const narrated = await postJson(`/api/session/${created.body.sessionId}/narrative`, { useTemplate: true });
  assert.equal(narrated.status, 200);
  assert.equal(narrated.body.meta.degraded, true);
  assert.equal(narrated.body.meta.check, null);
  assert.ok(narrated.body.text.includes('【整体趋势】'));

  const exported = await postJson(`/api/session/${created.body.sessionId}/export`, {
    formats: ['excel'],
    basisMode: 'current',
  });
  assert.equal(exported.status, 200);
  const file = exported.body.files[0];
  assert.equal(file.ok, true, file.error || '');
  assert.match(file.downloadUrl, /^\/api\/session\/[a-f0-9]+\/download\//);

  const download = await fetch(base + file.downloadUrl);
  assert.equal(download.status, 200);
  const buf = Buffer.from(await download.arrayBuffer());
  assert.ok(buf.length > 3000);
  assert.deepEqual([...buf.subarray(0, 2)], [0x50, 0x4b], 'xlsx 应为 ZIP 容器');
});

test('上传非法文件类型时给出可读错误', async () => {
  const res = await postJson('/api/session', {
    files: [{ name: 'bad.docx', base64: Buffer.from('x').toString('base64') }],
  });
  assert.equal(res.status, 500);
  assert.match(res.body.error, /不支持的文件类型/);
});

test('上传 .xlsx 文件可被解析并完成分析', async () => {
  const rows = [
    ['箱/扎', '平均外径 要求:31.54-31.94', '测量工具', '最小壁厚 要求:1.78', '最大壁厚 要求:2.11', '测量工具', '判定是否合格', '备注'],
    [1, 31.756, 'π尺', 1.893, 2.071, '卡尺', '合格', ''],
    [2, 31.482, 'π尺', 1.969, 2.097, '卡尺', '外径偏小', '已反馈班组追溯'],
    [3, 31.7, 'π尺', 1.9, 2.12, '卡尺', '壁厚偏厚', '追溯报废91.5米'],
  ];
  const xlsx = buildXlsx([{ name: '巡检记录', rows }]);
  const created = await postJson('/api/session', {
    files: [{ name: '8周.xlsx', base64: xlsx.toString('base64') }],
  });
  assert.equal(created.status, 200);
  const file = created.body.files[0];
  assert.equal(file.sheets[0].name, '巡检记录');
  assert.equal(file.sheets[0].rowCount, 3);
  assert.equal(file.sheets[0].suggestion.minWall, 3);
  assert.equal(file.sheets[0].suggestion.remark, 7);

  const analyzed = await postJson(`/api/session/${created.body.sessionId}/analyze`, {
    spec: [
      {
        fileIndex: 0,
        sheetIndex: 0,
        label: '8周',
        date: '2026/4/30',
        limits: { outerMin: 31.54, outerMax: 31.94, wallMin: 1.78, wallMax: 2.11 },
        mapping: file.sheets[0].suggestion,
      },
    ],
    basisLimits: { outerMin: 31.46, outerMax: 32.02, wallMin: 1.78, wallMax: 2.11 },
  });
  assert.equal(analyzed.status, 200);
  const view = analyzed.body.view;
  assert.equal(view.totals.n, 3);
  assert.equal(view.totals.anomalyRecords, 2);
  assert.equal(view.totals.byType['外径偏小'], 1);
  assert.equal(view.totals.byType['壁厚偏厚'], 1);
  assert.equal(view.validation.consistency.rate, 1, '人工判定应与复算一致');
});

test('会话失效时返回可读错误', async () => {
  const res = await postJson('/api/session/deadbeef/analyze', { spec: [] });
  assert.equal(res.status, 404);
  assert.match(res.body.error, /会话已失效/);
});

test('未知接口返回 404', async () => {
  const { status, body } = await getJson('/api/nope');
  assert.equal(status, 404);
  assert.match(body.error, /接口不存在/);
});

test('下载路径穿越被拒绝', async () => {
  const created = await postJson('/api/session', { source: 'sample' });
  const sid = created.body.sessionId;
  const res = await fetch(`${base}/api/session/${sid}/download/${encodeURIComponent('../../package.json')}`);
  assert.equal(res.status, 404);
});

test('设置 ACCESS_PASSWORD 后，除健康检查外全部请求都需要口令', async () => {
  process.env.ACCESS_PASSWORD = 'demo-pass-123';
  const auth = (pass) => ({ Authorization: 'Basic ' + Buffer.from(`any:${pass}`).toString('base64') });
  try {
    const health = await fetch(base + '/healthz');
    assert.equal(health.status, 200, '健康检查不需要口令');

    const noAuth = await fetch(base + '/api/rules');
    assert.equal(noAuth.status, 401);
    assert.match(noAuth.headers.get('www-authenticate') || '', /Basic/);

    const page = await fetch(base + '/');
    assert.equal(page.status, 401, '前端页面同样受保护');

    const wrong = await fetch(base + '/api/rules', { headers: auth('wrong') });
    assert.equal(wrong.status, 401);

    const ok = await fetch(base + '/api/rules', { headers: auth('demo-pass-123') });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.smallSampleThreshold, 30);
  } finally {
    delete process.env.ACCESS_PASSWORD;
  }

  const after = await fetch(base + '/api/rules');
  assert.equal(after.status, 200, '移除口令后恢复开放');
});
