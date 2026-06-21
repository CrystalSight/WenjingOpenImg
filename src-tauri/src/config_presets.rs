use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// 配置方案
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigPreset {
    pub name: String,
    pub api_url: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub concurrency: u32,
    pub timeout_secs: u64,
    pub max_retries: u32,
    pub common_params: String,
}

/// 获取配置方案存储目录
fn get_presets_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "无法获取用户主目录".to_string())?;
    let presets_dir = home.join(".wenjing-plugin").join("presets");
    fs::create_dir_all(&presets_dir)
        .map_err(|e| format!("创建配置目录失败: {}", e))?;
    Ok(presets_dir)
}

/// 保存配置方案
pub fn save_preset(preset: &ConfigPreset) -> Result<(), String> {
    let presets_dir = get_presets_dir()?;
    let file_name = format!("{}.json", preset.name.replace(" ", "_"));
    let file_path = presets_dir.join(&file_name);

    let json = serde_json::to_string_pretty(preset)
        .map_err(|e| format!("序列化配置失败: {}", e))?;

    fs::write(&file_path, json)
        .map_err(|e| format!("写入配置文件失败: {}", e))?;

    Ok(())
}

/// 加载配置方案
pub fn load_preset(name: &str) -> Result<ConfigPreset, String> {
    let presets_dir = get_presets_dir()?;
    let file_name = format!("{}.json", name.replace(" ", "_"));
    let file_path = presets_dir.join(&file_name);

    if !file_path.exists() {
        return Err(format!("配置方案 '{}' 不存在", name));
    }

    let json = fs::read_to_string(&file_path)
        .map_err(|e| format!("读取配置文件失败: {}", e))?;

    serde_json::from_str(&json)
        .map_err(|e| format!("解析配置文件失败: {}", e))
}

/// 列出所有配置方案
pub fn list_presets() -> Result<Vec<String>, String> {
    let presets_dir = get_presets_dir()?;

    let entries = fs::read_dir(&presets_dir)
        .map_err(|e| format!("读取配置目录失败: {}", e))?;

    let mut names = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        if let Some(file_name) = entry.file_name().to_str() {
            if file_name.ends_with(".json") {
                names.push(file_name[..file_name.len() - 5].replace("_", " ").to_string());
            }
        }
    }

    names.sort();
    Ok(names)
}
