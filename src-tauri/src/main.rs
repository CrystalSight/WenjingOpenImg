// 防止控制台窗口在Windows上显示
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod database;
mod project;
mod api_client;
mod batch_generator;
mod config_presets;

use config::{AppConfig, load_config, save_config, validate_wenjing_root};
use database::{explore_database, list_projects, list_shots, get_project_prompts, get_shot_full_prompt};
use project::{get_project_detail, check_shot_exists};
use api_client::{ApiClient, ImageGenerationRequest};
use batch_generator::{BatchGenerator, TaskUpdate};
use tauri::command;
use tauri::Manager; // 导入Manager trait以使用emit_all
use tokio::sync::mpsc;

/// 获取配置
#[command]
fn get_config() -> AppConfig {
    load_config()
}

/// 更新配置
#[command]
fn update_config(new_config: AppConfig) -> Result<(), String> {
    save_config(&new_config)
}

/// 选择文镜根目录
#[command]
fn select_wenjing_root(path: String) -> Result<bool, String> {
    let path_buf = std::path::PathBuf::from(path);
    let is_valid = validate_wenjing_root(&path_buf);
    
    if is_valid {
        let mut config = load_config();
        config.wenjing_root = Some(path_buf);
        save_config(&config)?;
    }
    
    Ok(is_valid)
}

/// 探索数据库结构
#[command]
fn explore_db(wenjing_root: String) -> Result<Vec<database::TableInfo>, String> {
    let db_path = std::path::PathBuf::from(wenjing_root).join("aigc.sqlite");
    explore_database(&db_path)
}

/// 获取项目列表
#[command]
fn get_projects(wenjing_root: String) -> Result<Vec<database::ProjectInfo>, String> {
    let db_path = std::path::PathBuf::from(wenjing_root).join("aigc.sqlite");
    list_projects(&db_path)
}

/// 获取分镜列表
#[command]
fn get_shots(wenjing_root: String, project_id: i64) -> Result<Vec<database::ShotInfo>, String> {
    let db_path = std::path::PathBuf::from(wenjing_root).join("aigc.sqlite");
    list_shots(&db_path, project_id)
}

/// 获取提示词信息
#[command]
fn get_prompts(wenjing_root: String, project_id: i64) -> Result<database::PromptInfo, String> {
    let db_path = std::path::PathBuf::from(wenjing_root).join("aigc.sqlite");
    get_project_prompts(&db_path, project_id)
}

/// 获取分镜的完整提示词
#[command]
fn get_shot_full_prompt_cmd(wenjing_root: String, shot_id: i64) -> Result<String, String> {
    let db_path = std::path::PathBuf::from(wenjing_root).join("aigc.sqlite");
    get_shot_full_prompt(&db_path, shot_id)
}

/// 获取项目详细信息(包含图片统计)
#[command]
fn get_project_detail_cmd(wenjing_root: String, project_id: i64) -> Result<project::ProjectDetail, String> {
    let wenjing_root_buf = std::path::PathBuf::from(wenjing_root);
    get_project_detail(&wenjing_root_buf, project_id)
}

/// 检查分镜是否已有图片
#[command]
fn check_shot_exists_cmd(wenjing_root: String, project_folder: String, shot_id: i64) -> bool {
    let wenjing_root_buf = std::path::PathBuf::from(wenjing_root);
    check_shot_exists(&wenjing_root_buf, &project_folder, shot_id)
}

/// 备份项目文件夹
#[command]
fn backup_project_cmd(wenjing_root: String, project_id: i64) -> Result<String, String> {
    let wenjing_root_buf = std::path::PathBuf::from(wenjing_root);
    let db_path = wenjing_root_buf.join("aigc.sqlite");
    
    // 先获取项目详情以得到工作区路径和项目文件夹
    let detail = project::get_project_detail(&wenjing_root_buf, project_id)?;
    
    // 从数据库读取工作区路径
    let workspace = database::get_workspace_path(&db_path)?;
    
    // 执行备份
    project::backup_project(&workspace, &detail.project_folder, &detail.name)
}

/// 保存配置方案
#[command]
fn save_config_preset(preset: config_presets::ConfigPreset) -> Result<(), String> {
    config_presets::save_preset(&preset)
}

/// 加载配置方案
#[command]
fn load_config_preset(name: String) -> Result<config_presets::ConfigPreset, String> {
    config_presets::load_preset(&name)
}

/// 列出所有配置方案
#[command]
fn list_config_presets() -> Result<Vec<String>, String> {
    config_presets::list_presets()
}

/// 项目预检结果
#[derive(serde::Serialize)]
struct ProjectInspection {
    project_id: i64,
    project_name: String,
    total_shots: i64,
    existing_images: i64,
    missing_prompt_shots: Vec<MissingPromptShot>,
}

#[derive(serde::Serialize)]
struct MissingPromptShot {
    shot_id: i64,
    order: i64,
    prompt: String,
}

/// 项目预检 - 检查分镜提示词完整性和已有图片
#[command]
fn inspect_project(wenjing_root: String, project_id: i64) -> Result<ProjectInspection, String> {
    let wenjing_root_buf = std::path::PathBuf::from(wenjing_root);
    let db_path = wenjing_root_buf.join("aigc.sqlite");
    
    // 1. 获取项目详情
    let detail = project::get_project_detail(&wenjing_root_buf, project_id)?;
    
    // 2. 获取所有分镜
    let shots = database::list_shots(&db_path, project_id)?;
    let total_shots = shots.len() as i64;
    
    // 3. 检查缺少提示词的分镜
    let mut missing_prompt_shots = Vec::new();
    for shot in &shots {
        if shot.prompt.trim().is_empty() {
            missing_prompt_shots.push(MissingPromptShot {
                shot_id: shot.id,
                order: shot.order,
                prompt: shot.prompt.clone(),
            });
        }
    }
    
    Ok(ProjectInspection {
        project_id,
        project_name: detail.name,
        total_shots,
        existing_images: detail.image_count,
        missing_prompt_shots,
    })
}

/// 获取可用模型列表
#[command]
async fn fetch_models(api_url: String, api_key: Option<String>) -> Result<Vec<String>, String> {
    let client = ApiClient::new(api_url, api_key, 30);
    client.get_models().await
}

/// API连接测试结果
#[derive(serde::Serialize)]
struct TestConnectionResult {
    success: bool,
    mode: Option<String>,  // "base64" 或 "url"
    error: Option<String>,
}

/// 测试API连接
#[command]
async fn test_api_connection(
    api_url: String,
    api_key: Option<String>,
    model: String,
    test_prompt: Option<String>,
) -> Result<TestConnectionResult, String> {
    let client = ApiClient::new(api_url, api_key, 180);
    
    // 如果前端未提供提示词,使用默认提示词
    let prompt = test_prompt.unwrap_or_else(|| "A beautiful sunset over the ocean".to_string());
    
    let request = ImageGenerationRequest {
        model,
        prompt,
        n: 1,
        size: Some("1024x1024".to_string()),
        extra_params: serde_json::json!({}),
    };
    
    match client.generate_with_retry(&request, 1).await {
        Ok(result) => {
            if result.url.is_some() {
                Ok(TestConnectionResult {
                    success: true,
                    mode: Some("url".to_string()),
                    error: None,
                })
            } else if result.b64_json.is_some() {
                Ok(TestConnectionResult {
                    success: true,
                    mode: Some("base64".to_string()),
                    error: None,
                })
            } else {
                Ok(TestConnectionResult {
                    success: false,
                    mode: None,
                    error: Some("API返回数据格式异常".to_string()),
                })
            }
        }
        Err(e) => Ok(TestConnectionResult {
            success: false,
            mode: None,
            error: Some(e),
        }),
    }
}

/// 启动批量生图任务
#[command]
async fn start_batch_generation(
    app: tauri::AppHandle,
    wenjing_root: String,
    project_id: i64,
    api_url: String,
    api_key: Option<String>,
    model: String,
    common_params: String,
    concurrency: u32,
    timeout_secs: u64,
    max_retries: u32,
) -> Result<String, String> {
    let wenjing_root_buf = std::path::PathBuf::from(wenjing_root);
    let common_params_json: serde_json::Value = serde_json::from_str(&common_params)
        .map_err(|e| format!("解析通用参数失败: {}", e))?;
    
    let generator = BatchGenerator::new(
        api_url,
        api_key,
        timeout_secs,
        concurrency as usize,
        max_retries,
    );
    
    // 创建事件通道
    let (sender, mut receiver) = mpsc::channel::<TaskUpdate>(100);
    
    // 启动后台任务
    let handle = tokio::spawn(async move {
        generator.generate_batch(
            wenjing_root_buf,
            project_id,
            model,
            common_params_json,
            sender,
        ).await
    });
    
    // 实时推送事件到前端
    let mut total: usize = 0;
    let mut completed: usize = 0;
    
    while let Some(update) = receiver.recv().await {
        tracing::info!("任务更新: {:?}", update);
        
        // 将TaskUpdate转换为JSON并发送到前端
        let event_name = "task-update";
        let payload = match &update {
            TaskUpdate::Started { shot_id, total: t } => {
                total = *t;
                serde_json::json!({
                    "type": "Started",
                    "shot_id": shot_id,
                    "total": t,
                    "current": 0,
                    "percent": 0.0
                })
            }
            TaskUpdate::Success { shot_id, image_path } => {
                completed += 1;
                let percent = if total > 0 { (completed as f64 / total as f64) * 100.0 } else { 0.0 };
                serde_json::json!({
                    "type": "Success",
                    "shot_id": shot_id,
                    "image_path": image_path,
                    "current": completed,
                    "total": total,
                    "percent": percent
                })
            }
            TaskUpdate::Failed { shot_id, error } => {
                completed += 1;
                let percent = if total > 0 { (completed as f64 / total as f64) * 100.0 } else { 0.0 };
                serde_json::json!({
                    "type": "Failed",
                    "shot_id": shot_id,
                    "error": error,
                    "current": completed,
                    "total": total,
                    "percent": percent
                })
            }
            TaskUpdate::Skipped { shot_id, reason } => {
                completed += 1;
                let percent = if total > 0 { (completed as f64 / total as f64) * 100.0 } else { 0.0 };
                serde_json::json!({
                    "type": "Skipped",
                    "shot_id": shot_id,
                    "reason": reason,
                    "current": completed,
                    "total": total,
                    "percent": percent
                })
            }
            TaskUpdate::Completed { success_count, failed_count, skipped_count } => {
                serde_json::json!({
                    "type": "Completed",
                    "success_count": success_count,
                    "failed_count": failed_count,
                    "skipped_count": skipped_count,
                    "current": total,
                    "total": total,
                    "percent": 100.0
                })
            }
        };
        
        // 发送事件到前端
        if let Err(e) = app.emit_all(event_name, &payload) {
            tracing::warn!("发送事件失败: {}", e);
        }
    }
    
    // 等待任务完成
    match handle.await {
        Ok(result) => result.map(|_| "批量生图完成".to_string()),
        Err(e) => Err(format!("任务执行失败: {}", e)),
    }
}

fn main() {
    // 初始化日志系统
    tracing_subscriber::fmt::init();

    // 启动Tauri应用
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_config,
            update_config,
            select_wenjing_root,
            explore_db,
            get_projects,
            get_shots,
            get_prompts,
            get_shot_full_prompt_cmd,
            get_project_detail_cmd,
            check_shot_exists_cmd,
            backup_project_cmd,
            save_config_preset,
            load_config_preset,
            list_config_presets,
            inspect_project,
            fetch_models,
            test_api_connection,
            start_batch_generation,
        ])
        .run(tauri::generate_context!())
        .expect("运行Tauri应用时出错");
}
