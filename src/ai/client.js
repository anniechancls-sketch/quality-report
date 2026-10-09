/**
 * DeepSeek（OpenAI 兼容）调用封装。使用 Node 内置 fetch，失败与超时都会抛出，
 * 由上层决定降级，不允许在此处静默吞掉错误。
 */
export async function requestCompletion({
  endpoint,
  apiKey,
  model,
  system,
  user,
  timeoutMs = 30000,
  fetchImpl = globalThis.fetch,
}) {
  if (!apiKey) throw new Error('未配置 API Key');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`模型返回 ${res.status}：${detail.slice(0, 200)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('模型返回内容为空');
    return { content, usage: data.usage || null };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`调用超时（${timeoutMs} ms）`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
