import { invoke } from '@tauri-apps/api/tauri';
import type { ProjectDetail } from '../types';

export async function getProjectDetail(
  wenjingRoot: string,
  projectId: number
): Promise<ProjectDetail> {
  return await invoke('get_project_detail_cmd', {
    wenjingRoot,
    projectId
  });
}

export async function checkShotExists(
  wenjingRoot: string,
  projectFolder: string,
  shotId: number
): Promise<boolean> {
  return await invoke('check_shot_exists_cmd', {
    wenjingRoot,
    projectFolder,
    shotId
  });
}

export async function backupProject(
  wenjingRoot: string,
  projectId: number
): Promise<string> {
  return await invoke('backup_project_cmd', {
    wenjingRoot,
    projectId
  });
}
