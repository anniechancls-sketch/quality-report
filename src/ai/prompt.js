import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(here, '..', '..', 'prompts');

export function loadPrompt(name = 'report-narrative.md') {
  return readFileSync(join(PROMPTS_DIR, name), 'utf8');
}

export function buildPrompt(snapshot) {
  return {
    system: loadPrompt('report-narrative.md'),
    user: `以下是程序计算好的指标快照（JSON），请据此撰写解读。不要新增任何未出现在本 JSON 中的数值。\n\n${JSON.stringify(
      snapshot,
      null,
      2,
    )}`,
  };
}
