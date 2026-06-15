import { invoke } from '@tauri-apps/api/tauri';
import type { AppConfig } from '../types';

/**
 * 获取配置
 */
export async function getConfig(): Promise<AppConfig> {
  return await invoke('get_config');
}

/**
 * 更新配置
 */
export async function updateConfig(config: AppConfig): Promise<void> {
  await invoke('update_config', { newConfig: config });
}

/**
 * 选择文镜根目录
 */
export async function selectWenjingRoot(path: string): Promise<boolean> {
  return await invoke('select_wenjing_root', { path });
}
