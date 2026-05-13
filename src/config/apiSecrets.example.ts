/**
 * 默认 API 配置示例
 *
 * 复制本文件为 apiSecrets.ts 并填入真实密钥即可。
 * apiSecrets.ts 已加入 .gitignore，不会提交到 GitHub。
 */

export const DEFAULT_TEXT_CONFIG = {
  provider: 'bailian' as const,
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: 'your-api-key-here',
  model: 'qwen-plus',
};

export const DEFAULT_VISION_CONFIG = {
  provider: 'bailian' as const,
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: 'your-api-key-here',
  model: 'qwen3.5-plus',
};
