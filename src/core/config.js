import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_RULES_PATH = join(here, '..', '..', 'config', 'rules.json');

let cached = null;

/**
 * 读取 config/rules.json。限值、阈值、分类词表一律从配置读取，不得硬编码在业务代码中。
 */
export function loadRules(path = DEFAULT_RULES_PATH) {
  if (!path && cached) return cached;
  const raw = readFileSync(path, 'utf8');
  const rules = JSON.parse(raw);
  if (!path) cached = rules;
  return rules;
}

export function resetRulesCache() {
  cached = null;
}
