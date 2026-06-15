import { invoke } from '@tauri-apps/api/tauri';
import type { TableInfo, ProjectInfo, ShotInfo, PromptInfo } from '../types';

export async function exploreDatabase(wenjingRoot: string): Promise<TableInfo[]> {
  return await invoke('explore_db', { wenjingRoot });
}

export async function getProjects(wenjingRoot: string): Promise<ProjectInfo[]> {
  return await invoke('get_projects', { wenjingRoot });
}

export async function getShots(wenjingRoot: string, projectId: number): Promise<ShotInfo[]> {
  return await invoke('get_shots', { wenjingRoot, projectId });
}

export async function getPrompts(wenjingRoot: string, projectId: number): Promise<PromptInfo> {
  return await invoke('get_prompts', { wenjingRoot, projectId });
}

export async function getShotFullPrompt(wenjingRoot: string, shotId: number): Promise<string> {
  return await invoke('get_shot_full_prompt_cmd', { wenjingRoot, shotId });
}
