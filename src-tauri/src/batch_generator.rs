use crate::api_client::{ApiClient, ImageGenerationRequest, ConcurrentController};
use crate::database;
use crate::project;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing;

/// 生图任务状态更新
#[derive(Debug, Clone)]
pub enum TaskUpdate {
    Started { shot_id: i64, total: usize },
    Progress { shot_id: i64, current: usize },
    Success { shot_id: i64, image_path: String },
    Failed { shot_id: i64, error: String },
    Skipped { shot_id: i64, reason: String },
    Completed { success_count: usize, failed_count: usize, skipped_count: usize },
}

/// 批量生图管理器
pub struct BatchGenerator {
    api_client: Arc<ApiClient>,
    concurrent_controller: Arc<ConcurrentController>,
    max_retries: u32,
}

impl BatchGenerator {
    pub fn new(
        api_url: String,
        api_key: Option<String>,
        timeout_secs: u64,
        max_concurrent: usize,
        max_retries: u32,
    ) -> Self {
        Self {
            api_client: Arc::new(ApiClient::new(api_url, api_key, timeout_secs)),
            concurrent_controller: Arc::new(ConcurrentController::new(max_concurrent)),
            max_retries,
        }
    }
    
    /// 执行批量生图
    pub async fn generate_batch(
        &self,
        wenjing_root: PathBuf,
        project_id: i64,
        model: String,
        common_params: serde_json::Value,
        sender: mpsc::Sender<TaskUpdate>,
    ) -> Result<(), String> {
        // 1. 获取项目信息
        let db_path = wenjing_root.join("aigc.sqlite");
        
        // 获取项目详情(包含正确的项目文件夹路径)
        let project_detail = project::get_project_detail(&wenjing_root, project_id)?;
        let project_folder = project_detail.project_folder.clone();
        
        // 获取公用提示词
        let prompts = database::get_project_prompts(&db_path, project_id)?;
        
        // 获取分镜列表
        let shots = database::list_shots(&db_path, project_id)?;
        
        if shots.is_empty() {
            return Err("该项目没有分镜".to_string());
        }
        
        let total = shots.len();
        let mut success_count = 0usize;
        let mut failed_count = 0usize;
        let mut skipped_count = 0usize;
        
        // 发送开始事件
        sender.send(TaskUpdate::Started { shot_id: 0, total }).await
            .map_err(|e| format!("发送事件失败: {}", e))?;
        
        // 2. 遍历分镜,并发执行
        let mut tasks = Vec::new();
        
        for (index, shot) in shots.iter().enumerate() {
            let shot_id = shot.id;
            let shot_prompt = shot.prompt.clone();
            let style = prompts.style.clone();
            let era = prompts.era.clone();
            let custom = prompts.custom.clone();
            let model_clone = model.clone();
            let params_clone = common_params.clone();
            let api_client_clone = self.api_client.clone();
            let controller_clone = self.concurrent_controller.clone();
            let max_retries = self.max_retries;
            let project_folder_clone = project_folder.clone();
            let sender_clone = sender.clone();
            let db_path_clone = db_path.clone();
            
            let task = tokio::spawn(async move {
                // 获取并发许可
                let _permit = controller_clone.acquire().await
                    .map_err(|e| format!("获取并发许可失败: {}", e))?;
                
                // 发送进度事件
                sender_clone.send(TaskUpdate::Progress { 
                    shot_id, 
                    current: index + 1 
                }).await.ok();
                
                // 检查是否已存在图片
                if project::check_shot_exists(&PathBuf::from("."), &project_folder_clone, shot_id) {
                    tracing::info!("分镜 {} 已有图片,跳过", shot_id);
                    sender_clone.send(TaskUpdate::Skipped { 
                        shot_id, 
                        reason: "图片已存在".to_string() 
                    }).await.ok();
                    return Ok::<_, String>("skipped");
                }
                
                // 拼接完整提示词
                let full_prompt = database::build_prompt(&style, &era, &shot_prompt, &custom);
                
                // 构建API请求
                let request = ImageGenerationRequest {
                    model: model_clone,
                    prompt: full_prompt,
                    n: 1,
                    size: None,
                    extra_params: params_clone,
                };
                
                // 调用API生成图片
                let image_data = api_client_clone.generate_with_retry(&request, max_retries).await?;
                
                // 保存图片到正确的项目文件夹
                let save_path = PathBuf::from(&project_folder_clone)
                    .join("base")
                    .join(format!("{}.png", shot_id));
                
                api_client_clone.download_and_save_image(&image_data, &save_path).await?;
                
                // 更新数据库Path字段
                let image_path_str = save_path.to_string_lossy().to_string();
                if let Err(e) = update_shot_path(&db_path_clone, shot_id, &image_path_str) {
                    tracing::warn!("更新Path字段失败: {}", e);
                    // 不中断流程,继续处理下一个分镜
                }
                
                // 发送成功事件
                sender_clone.send(TaskUpdate::Success { 
                    shot_id, 
                    image_path: image_path_str.clone() 
                }).await.ok();
                
                Ok::<_, String>("success")
            });
            
            tasks.push(task);
        }
        
        // 3. 等待所有任务完成
        for task in tasks {
            match task.await {
                Ok(result) => {
                    match result {
                        Ok(status) => {
                            if status == "success" {
                                success_count += 1;
                            } else if status == "skipped" {
                                skipped_count += 1;
                            }
                        }
                        Err(e) => {
                            tracing::error!("任务执行失败: {}", e);
                            failed_count += 1;
                        }
                    }
                }
                Err(e) => {
                    tracing::error!("任务panic: {}", e);
                    failed_count += 1;
                }
            }
        }
        
        // 发送完成事件
        sender.send(TaskUpdate::Completed { 
            success_count, 
            failed_count, 
            skipped_count 
        }).await.map_err(|e| format!("发送完成事件失败: {}", e))?;
        
        Ok(())
    }
}

/// 更新分镜的Path字段
fn update_shot_path(db_path: &PathBuf, shot_id: i64, image_path: &str) -> Result<(), String> {
    let conn = database::open_database(db_path)?;
    
    conn.execute(
        "UPDATE Articles SET Path = ? WHERE ID = ?",
        [image_path, &shot_id.to_string()]
    ).map_err(|e| format!("更新Path字段失败: {}", e))?;
    
    tracing::info!("已更新分镜 {} 的Path字段: {}", shot_id, image_path);
    Ok(())
}
