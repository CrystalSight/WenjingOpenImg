import { invoke } from '@tauri-apps/api/tauri';

export interface ConfigPreset {
  name: string;
  concurrency: number;
  timeout_secs: number;
  max_retries: number;
  common_params: string;
}

export async function saveConfigPreset(preset: ConfigPreset): Promise<void> {
  return invoke('save_config_preset', { preset });
}

export async function loadConfigPreset(name: string): Promise<ConfigPreset> {
  return invoke('load_config_preset', { name });
}

export async function listConfigPresets(): Promise<string[]> {
  return invoke('list_config_presets');
}
