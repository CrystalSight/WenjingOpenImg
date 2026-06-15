import { invoke } from '@tauri-apps/api/tauri';

export async function startBatchGeneration(
  wenjingRoot: string,
  projectId: number,
  apiUrl: string,
  apiKey: string | undefined,
  model: string,
  commonParams: string,
  concurrency: number,
  timeoutSecs: number,
  maxRetries: number
): Promise<string> {
  return await invoke('start_batch_generation', {
    wenjingRoot,
    projectId,
    apiUrl,
    apiKey,
    model,
    commonParams,
    concurrency,
    timeoutSecs,
    maxRetries
  });
}
