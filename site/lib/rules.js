/**
 * 浏览器版配置。与 config/rules.json 保持一致；静态部署时无法读取本地文件，因此内联。
 * 修改限值或阈值时，这里与 config/rules.json 需要同步。
 */
export const RULES = {
  version: '1.0',
  smallSampleThreshold: 30,
  topAnomalyLimit: 5,
  presets: {
    latest: {
      name: '最新标准（5–7周）',
      limits: { outerMin: 31.46, outerMax: 32.02, wallMin: 1.78, wallMax: 2.11 },
    },
    strict: {
      name: '复合最严标准',
      limits: { outerMin: 31.54, outerMax: 31.94, wallMin: 1.78, wallMax: 2.1 },
    },
  },
  defaultPreset: 'latest',
  anomalyTypes: ['外径偏大', '外径偏小', '壁厚偏厚', '壁厚偏薄'],
  remarkCategories: {
    已反馈班组追溯: ['已反馈', '反馈班组'],
    追溯后合格: ['追溯', '合格'],
    追溯报废: ['报废'],
    其他未处置: [],
  },
  ai: {
    model: 'deepseek-chat',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    timeoutMs: 30000,
    numberCheckRetry: 1,
  },
  report: {
    sections: [
      '报告头（固定，不可取消）',
      '执行摘要',
      '关键指标总览',
      '周间差异对比',
      '异常结构分析',
      '结论与建议',
      '附录 A 判定规则与口径说明',
      '附录 B 各周抽检明细',
    ],
    formats: ['word', 'excel', 'pdf'],
  },
};

export function loadRules() {
  return RULES;
}
