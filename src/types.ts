export interface AppConfig {
  wenjing_root?: string;
  api_url?: string;
  api_key?: string;
  model?: string;
  common_params?: string;
  concurrency: number;
  timeout_secs: number;
  max_retries: number;
}

export interface TableInfo {
  table_name: string;
  columns: ColumnInfo[];
}

export interface ColumnInfo {
  name: string;
  column_type: string;
}

export interface ProjectInfo {
  id: number;
  name: string;
  created_at: string;
  shot_count: number;
  image_count: number;
}

export interface ShotInfo {
  id: number;
  project_id: number;
  prompt: string;
  order: number;
}

export interface PromptInfo {
  style: string;
  era: string;
  custom: string;
}

export interface ProjectDetail {
  id: number;
  name: string;
  created_at: string;
  shot_count: number;
  image_count: number;
  project_folder: string;
}

export type ShotStatus = 'Pending' | 'Exists' | 'Success' | 'Failed';

export interface ShotProcessInfo {
  shot_id: number;
  prompt: string;
  full_prompt: string;
  status: ShotStatus;
  image_path?: string;
}

export interface ModelInfo {
  id: string;
  object: string;
}

export type TaskUpdateType = 
  | { type: 'Started'; shot_id: number; total: number }
  | { type: 'Progress'; shot_id: number; current: number }
  | { type: 'Success'; shot_id: number; image_path: string }
  | { type: 'Failed'; shot_id: number; error: string }
  | { type: 'Skipped'; shot_id: number; reason: string }
  | { type: 'Completed'; success_count: number; failed_count: number; skipped_count: number };
