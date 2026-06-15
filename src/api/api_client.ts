import { invoke } from '@tauri-apps/api/tauri';

export interface TestConnectionResult {
  success: boolean;
  mode?: 'base64' | 'url';
  error?: string;
}

/**
 * 获取可用模型列表
 * @param apiUrl API服务地址
 * @param apiKey API密钥(可选)
 * @returns 模型ID列表
 */
export async function fetchModels(apiUrl: string, apiKey?: string): Promise<string[]> {
  return await invoke('fetch_models', { apiUrl, apiKey });
}

/**
 * 测试API连接
 * @param apiUrl API服务地址
 * @param apiKey API密钥(可选)
 * @param model 要测试的模型名称
 * @returns 测试结果对象
 */
export async function testApiConnection(
  apiUrl: string,
  apiKey: string | undefined,
  model: string
): Promise<TestConnectionResult> {
  return await invoke('test_api_connection', {
    apiUrl,
    apiKey,
    model
  });
}
