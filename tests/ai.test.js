import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRules } from '../src/core/config.js';
import { buildMetrics } from '../src/core/metrics.js';
import { buildComparisons, buildSnapshot } from '../src/core/compare.js';
import { categorizeRemarks } from '../src/core/remarks.js';
import { buildTemplateNarrative, generateNarrative } from '../src/ai/narrative.js';
import { checkNumbers, extractNumbers } from '../src/ai/number-check.js';
import { loadSampleWeeks, latestLimits } from './helpers.js';

const rules = loadRules();
const weeks = loadSampleWeeks();
const metrics = buildMetrics(weeks, latestLimits(), rules);
const comparisons = buildComparisons(metrics, 'chain');
const remarks = categorizeRemarks(
  weeks.flatMap((w) => w.rows),
  rules.remarkCategories,
);
const snapshot = buildSnapshot(metrics, 'current', rules, comparisons, remarks);

const fakeFetch = (content, capture = {}) => async (url, options) => {
  capture.body = JSON.parse(options.body);
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }], usage: { total_tokens: 100 } }),
    text: async () => '',
  };
};

test('模板解读四段齐全且引用真实数值', () => {
  const text = buildTemplateNarrative(snapshot);
  for (const section of ['【整体趋势】', '【显著变化】', '【异常结构】', '【待核实事项】']) {
    assert.ok(text.includes(section), `缺少小节 ${section}`);
  }
  assert.ok(text.includes('452'));
  assert.ok(text.includes('62'));
  assert.ok(text.includes('63'));
});

test('TC-A03 模板解读的全部数字都通过回查', () => {
  const text = buildTemplateNarrative(snapshot);
  const result = checkNumbers(text, snapshot);
  assert.equal(result.passed, true, `未匹配：${result.unmatched.join('、')}`);
  assert.ok(result.total > 20, '应校验到一定数量的数字');
});

test('TC-A04 数字回查能拦截凭空出现的数字', () => {
  const text = buildTemplateNarrative(snapshot) + '\n· 另有 427 条记录存在设备参数漂移。';
  const result = checkNumbers(text, snapshot);
  assert.equal(result.passed, false);
  assert.ok(result.unmatched.includes('427'));
});

test('数字回查不放过与合法值四舍五入后相等的伪造数字', () => {
  const text = buildTemplateNarrative(snapshot) + '\n· 合格率提升到 99.9%，异常共 100.2 条。';
  const result = checkNumbers(text, snapshot);
  assert.equal(result.passed, false);
  assert.ok(result.unmatched.includes('99.9'));
  assert.ok(result.unmatched.includes('100.2'));
});

test('数字回查允许引用程序算出的差值，不需要模型自己推算', () => {
  const text = '1周 → 2周 统一口径差值为 5.6pp，当期口径差值为 10.5pp。';
  assert.equal(checkNumbers(text, snapshot).passed, true);
});

test('数字提取能处理百分数、小数与整数', () => {
  assert.deepEqual(extractNumbers('76.6% 与 452 条，区间 63.5–85.0'), ['76.6', '452', '63.5', '85.0']);
});

test('TC-A06 未配置密钥时直接降级为模板生成', async () => {
  const { text, meta } = await generateNarrative({ snapshot, apiKey: '', rules });
  assert.equal(meta.degraded, true);
  assert.equal(meta.reason, '未配置密钥');
  assert.ok(text.includes('【整体趋势】'));
  assert.equal(checkNumbers(text, snapshot).passed, true);
});

test('TC-A05 调用失败时降级且记录原因', async () => {
  const failing = async () => {
    const error = new Error('getaddrinfo ENOTFOUND');
    throw error;
  };
  const { meta } = await generateNarrative({
    snapshot,
    apiKey: 'sk-test',
    rules,
    fetchImpl: failing,
  });
  assert.equal(meta.degraded, true);
  assert.match(meta.reason, /网络或服务异常/);
  assert.match(meta.reason, /ENOTFOUND/);
});

test('超时被识别为超时错误并降级', async () => {
  const timeout = async () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  };
  const { meta } = await generateNarrative({
    snapshot,
    apiKey: 'sk-test',
    rules,
    fetchImpl: timeout,
  });
  assert.equal(meta.degraded, true);
  assert.match(meta.reason, /调用超时/);
});

test('TC-A01 模型返回合规内容时采用模型结果，不降级', async () => {
  const good = buildTemplateNarrative(snapshot);
  const { text, meta } = await generateNarrative({
    snapshot,
    apiKey: 'sk-test',
    rules,
    fetchImpl: fakeFetch(good),
  });
  assert.equal(meta.degraded, false);
  assert.equal(meta.model, rules.ai.model);
  assert.equal(meta.check.passed, true);
  assert.equal(text, good);
});

test('模型输出错误数字时先重试，重试仍失败则降级', async () => {
  let calls = 0;
  const bad = buildTemplateNarrative(snapshot) + '\n· 合格率提升到 99.9%。';
  const fetchImpl = async (url, options) => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: bad } }] }),
      text: async () => '',
      options,
    };
  };
  const { meta } = await generateNarrative({ snapshot, apiKey: 'sk-test', rules, fetchImpl });
  assert.equal(calls, 2, '应重试一次');
  assert.equal(meta.degraded, true);
  assert.match(meta.reason, /数字回查未通过/);
  assert.match(meta.reason, /99.9/);
});

test('第二次生成通过回查时采用模型结果并标注已重新生成', async () => {
  const good = buildTemplateNarrative(snapshot);
  const bad = `${good}\n· 共 888 条异常。`;
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    const content = calls === 1 ? bad : good;
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => '',
    };
  };
  const { meta, text } = await generateNarrative({ snapshot, apiKey: 'sk-test', rules, fetchImpl });
  assert.equal(calls, 2);
  assert.equal(meta.degraded, false);
  assert.match(meta.reason, /重新生成/);
  assert.equal(text, good);
});

test('提示词包含输入快照且声明硬约束', async () => {
  const capture = {};
  await generateNarrative({
    snapshot,
    apiKey: 'sk-test',
    rules,
    fetchImpl: fakeFetch(buildTemplateNarrative(snapshot), capture),
  });
  const messages = capture.body.messages;
  assert.match(messages[0].content, /不得进行任何数值计算/);
  assert.match(messages[0].content, /数据不足，无法确认原因/);
  assert.match(messages[1].content, /"totals"/);
});

test('TC-A07 离线模式不发起任何请求', async () => {
  let called = false;
  const { meta } = await generateNarrative({
    snapshot,
    apiKey: 'sk-test',
    rules,
    offline: true,
    fetchImpl: async () => {
      called = true;
    },
  });
  assert.equal(called, false);
  assert.equal(meta.degraded, true);
  assert.equal(meta.reason, '已选择离线模式');
});
