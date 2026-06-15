use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// 应用配置结构体
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// 文镜软件根目录(用户选择)
    pub wenjing_root: Option<PathBuf>,
    
    /// OpenAI兼容API服务商URL
    pub api_url: Option<String>,
    
    /// 选择的模型名称
    pub model: Option<String>,
    
    /// 通用参数(JSON字符串)
    pub common_params: Option<String>,
    
    /// 并发数量(默认3)
    pub concurrency: u32,
    
    /// 超时时间(秒,默认60)
    pub timeout_secs: u64,
    
    /// 最大重试次数(默认3)
    pub max_retries: u32,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            wenjing_root: None,
            api_url: None,
            model: None,
            common_params: Some("{}".to_string()),
            concurrency: 3,
            timeout_secs: 60,
            max_retries: 3,
        }
    }
}

use dirs;
use std::fs;
use tracing;

/// 获取配置目录路径 (%APPDATA%\WenjingImagePlugin)
fn get_config_dir() -> PathBuf {
    let path = dirs::config_dir()
        .expect("无法获取系统配置目录")
        .join("WenjingImagePlugin");
    fs::create_dir_all(&path).expect("无法创建配置目录");
    path
}

/// 获取配置文件路径
fn get_config_path() -> PathBuf {
    get_config_dir().join("config.json")
}

/// 加载配置
pub fn load_config() -> AppConfig {
    let config_path = get_config_path();
    
    if !config_path.exists() {
        tracing::info!("配置文件不存在,使用默认配置");
        return AppConfig::default();
    }
    
    match fs::read_to_string(&config_path) {
        Ok(content) => {
            match serde_json::from_str::<AppConfig>(&content) {
                Ok(config) => {
                    tracing::info!("配置加载成功");
                    config
                }
                Err(e) => {
                    tracing::error!("配置解析失败: {}, 使用默认配置", e);
                    AppConfig::default()
                }
            }
        }
        Err(e) => {
            tracing::error!("读取配置文件失败: {}, 使用默认配置", e);
            AppConfig::default()
        }
    }
}

/// 保存配置
pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let config_path = get_config_path();
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("序列化配置失败: {}", e))?;
    
    fs::write(&config_path, content)
        .map_err(|e| format!("写入配置文件失败: {}", e))?;
    
    tracing::info!("配置保存成功: {:?}", config_path);
    Ok(())
}

/// 验证文镜根目录是否有效
pub fn validate_wenjing_root(path: &PathBuf) -> bool {
    path.exists() 
        && path.join("aigc.sqlite").exists() 
        && path.join("zuopin").exists()
}
