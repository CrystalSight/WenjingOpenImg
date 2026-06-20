import { invoke } from '@tauri-apps/api/tauri';

export interface MissingPromptShot {
  shot_id: number;
  order: number;
  prompt: string;
}

export interface ProjectInspection {
  project_id: number;
  project_name: string;
  total_shots: number;
  existing_images: number;
  missing_prompt_shots: MissingPromptShot[];
}

export async function inspectProject(wenjingRoot: string, projectId: number): Promise<ProjectInspection> {
  return invoke('inspect_project', { wenjingRoot, projectId });
}
