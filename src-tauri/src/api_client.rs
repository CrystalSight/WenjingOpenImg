use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;
use tokio::fs;
use tokio::sync::Semaphore;
use tokio::time::timeout;
use tracing;

/// API请求体
#[derive(Debug, Clone, Serialize)]
pub struct ImageGenerationRequest {
    pub model: String,
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub n: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<String>,
    #[serde(flatten)]
    pub extra_params: serde_json::Value,  // 用户自定义的通用参数
}

/// API响应
#[derive(Debug, Clone, Deserialize)]
pub struct ImageGenerationResponse {
    pub data: Vec<ImageData>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImageData {
    pub url: Option<String>,
    pub b64_json: Option<String>,
}

/// 模型信息
#[derive(Debug, Clone, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub object: String,
}

/// 模型列表响应
#[derive(Debug, Clone, Deserialize)]
pub struct ModelsResponse {
    pub data: Vec<ModelInfo>,
}

/// API客户端
pub struct ApiClient {
    client: Client,
    api_url: String,
    api_key: Option<String>,
    timeout_secs: u64,
}

impl ApiClient {
    /// 创建新的API客户端
    pub fn new(api_url: String, api_key: Option<String>, timeout_secs: u64) -> Result<Self, String> {
        let client = Client::builder()
            .timeout(Duration::from_secs(timeout_secs))
            .build()
            .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;
        
        Ok(Self {
            client,
            api_url,
            api_key,
            timeout_secs,
        })
    }
    
    /// 获取可用模型列表
    pub async fn get_models(&self) -> Result<Vec<String>, String> {
        let models_url = format!("{}/models", self.api_url.trim_end_matches('/'));
        
        let mut request = self.client.get(&models_url);
        
        if let Some(key) = &self.api_key {
            request = request.header("Authorization", format!("Bearer {}", key));
        }
        
        let response = request
            .send()
            .await
            .map_err(|e| format!("请求模型列表失败: {}", e))?;
        
        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("获取模型列表失败 ({}): {}", status, error_text));
        }
        
        let models_resp: ModelsResponse = response
            .json()
            .await
            .map_err(|e| format!("解析模型列表响应失败: {}", e))?;
        
        // 过滤出文生图模型(简单启发式:包含"image"或"dall"的模型)
        let image_models: Vec<String> = models_resp.data
            .into_iter()
            .filter(|m| {
                let id_lower = m.id.to_lowercase();
                id_lower.contains("image") || 
                id_lower.contains("dall") ||
                id_lower.contains("flux") ||
                id_lower.contains("stable")
            })
            .map(|m| m.id)
            .collect();
        
        Ok(image_models)
    }
    
    /// 生成单张图片(带超时控制)
    pub async fn generate_image_with_timeout(
        &self,
        request: &ImageGenerationRequest,
    ) -> Result<ImageData, String> {
        let timeout_duration = Duration::from_secs(self.timeout_secs);
        
        timeout(timeout_duration, self.generate_image(request))
            .await
            .map_err(|_| format!("请求超时({}秒)", self.timeout_secs))?
    }
    
    /// 生成单张图片
    async fn generate_image(
        &self,
        request: &ImageGenerationRequest,
    ) -> Result<ImageData, String> {
        let images_url = format!("{}/images/generations", self.api_url.trim_end_matches('/'));
        
        let mut req_builder = self.client.post(&images_url)
            .json(request);
        
        if let Some(key) = &self.api_key {
            req_builder = req_builder.header("Authorization", format!("Bearer {}", key));
        }
        
        let response = req_builder
            .send()
            .await
            .map_err(|e| format!("发送请求失败: {}", e))?;
        
        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            
            // 根据错误类型给出优化建议
            let error_msg = match status.as_u16() {
                401 => "API密钥错误: 请检查API Key是否正确配置",
                404 => "模型不存在: 该模型不可用,请重新选择模型",
                429 => "请求频率超限: 建议降低并发数或增加请求间隔",
                _ => &error_text,
            };
            
            return Err(format!("API请求失败 ({}): {}", status, error_msg));
        }
        
        let gen_resp: ImageGenerationResponse = response
            .json()
            .await
            .map_err(|e| format!("解析响应失败: {}", e))?;
        
        if gen_resp.data.is_empty() {
            return Err("API返回空数据".to_string());
        }
        
        Ok(gen_resp.data[0].clone())
    }
    
    /// 带退避重试的图片生成
    pub async fn generate_with_retry(
        &self,
        request: &ImageGenerationRequest,
        max_retries: u32,
    ) -> Result<ImageData, String> {
        let mut delay = Duration::from_secs(1);
        let mut last_error = String::new();
        
        for attempt in 0..max_retries {
            match self.generate_image_with_timeout(request).await {
                Ok(image_data) => {
                    tracing::info!("图片生成成功 (尝试 {}/{})", attempt + 1, max_retries);
                    return Ok(image_data);
                }
                Err(e) => {
                    last_error = e.clone();
                    tracing::warn!("图片生成失败 (尝试 {}/{}): {}", attempt + 1, max_retries, e);
                    
                    if attempt < max_retries - 1 {
                        // 指数退避
                        tracing::info!("等待 {} 秒后重试...", delay.as_secs());
                        tokio::time::sleep(delay).await;
                        delay = std::cmp::min(delay * 2, Duration::from_secs(60));
                    }
                }
            }
        }
        
        Err(format!("达到最大重试次数({}),最后错误: {}", max_retries, last_error))
    }
    
    /// 下载图片并保存到指定路径
    pub async fn download_and_save_image(
        &self,
        image_data: &ImageData,
        save_path: &PathBuf,
    ) -> Result<String, String> {
        // 确保父目录存在
        if let Some(parent) = save_path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("创建目录失败: {}", e))?;
        }
        
        if let Some(url) = &image_data.url {
            // URL模式: 下载图片
            self.download_image_from_url(url, save_path).await
        } else if let Some(b64_json) = &image_data.b64_json {
            // Base64模式: 解码并保存
            self.save_base64_image(b64_json, save_path).await
        } else {
            Err("API返回数据中既无URL也无Base64数据".to_string())
        }
    }
    
    /// 从URL下载图片
    async fn download_image_from_url(
        &self,
        url: &str,
        save_path: &PathBuf,
    ) -> Result<String, String> {
        let response = self.client.get(url)
            .send()
            .await
            .map_err(|e| format!("下载图片失败: {}", e))?;
        
        if !response.status().is_success() {
            return Err(format!("下载图片失败: HTTP {}", response.status()));
        }
        
        let bytes = response.bytes()
            .await
            .map_err(|e| format!("读取图片数据失败: {}", e))?;
        
        // 原子写入: 先写到临时文件,再重命名
        let temp_path = save_path.with_extension("tmp");
        fs::write(&temp_path, &bytes)
            .await
            .map_err(|e| format!("写入临时文件失败: {}", e))?;
        
        // 重命名为最终文件名
        fs::rename(&temp_path, save_path)
            .await
            .map_err(|e| format!("重命名文件失败: {}", e))?;
        
        tracing::info!("图片保存成功: {:?}", save_path);
        Ok(save_path.to_string_lossy().to_string())
    }
    
    /// 保存Base64编码的图片
    async fn save_base64_image(
        &self,
        b64_json: &str,
        save_path: &PathBuf,
    ) -> Result<String, String> {
        // 解码Base64
        let decoded = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64_json)
            .map_err(|e| format!("Base64解码失败: {}", e))?;
        
        // 原子写入
        let temp_path = save_path.with_extension("tmp");
        fs::write(&temp_path, &decoded)
            .await
            .map_err(|e| format!("写入临时文件失败: {}", e))?;
        
        fs::rename(&temp_path, save_path)
            .await
            .map_err(|e| format!("重命名文件失败: {}", e))?;
        
        tracing::info!("图片保存成功(Base64): {:?}", save_path);
        Ok(save_path.to_string_lossy().to_string())
    }
}

/// 并发控制器
pub struct ConcurrentController {
    semaphore: Semaphore,
}

impl ConcurrentController {
    /// 创建并发控制器
    pub fn new(max_concurrent: usize) -> Self {
        Self {
            semaphore: Semaphore::new(max_concurrent),
        }
    }
    
    /// 获取信号量许可
    pub async fn acquire(&self) -> Result<tokio::sync::SemaphorePermit<'_>, String> {
        self.semaphore.acquire()
            .await
            .map_err(|e| format!("获取并发许可失败: {}", e))
    }
}
