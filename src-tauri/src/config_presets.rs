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

/// 校验配置方案名称，防止路径穿越
fn validate_preset_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 64 {
        return Err("方案名称长度需在1-64之间".to_string());
    }
    if name.contains('/') || name.contains('\\') || name.contains("..")
        || name.contains('\0') || name.chars().any(|c| c.is_control())
    {
        return Err("方案名称包含非法字符".to_string());
    }
    Ok(())
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
    validate_preset_name(&preset.name)?;
    let presets_dir = get_presets_dir()?;
    let file_name = format!("config_{}.json", preset.name.replace(" ", "_"));
    let file_path = presets_dir.join(&file_name);

    let json = serde_json::to_string_pretty(preset)
        .map_err(|e| format!("序列化配置失败: {}", e))?;

    fs::write(&file_path, json)
        .map_err(|e| format!("写入配置文件失败: {}", e))?;

    Ok(())
}

/// 加载配置方案
pub fn load_preset(name: &str) -> Result<ConfigPreset, String> {
    validate_preset_name(name)?;
    let presets_dir = get_presets_dir()?;
    let file_name = format!("config_{}.json", name.replace(" ", "_"));
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
            if let Some(stem) = file_name.strip_prefix("config_").and_then(|s| s.strip_suffix(".json")) {
                names.push(stem.replace("_", " ").to_string());
            }
        }
    }

    names.sort();
    Ok(names)
}

/// 删除配置方案
pub fn delete_preset(name: &str) -> Result<(), String> {
    validate_preset_name(name)?;
    let presets_dir = get_presets_dir()?;
    let file_name = format!("config_{}.json", name.replace(" ", "_"));
    let file_path = presets_dir.join(&file_name);

    if !file_path.exists() {
        return Err(format!("配置方案 '{}' 不存在", name));
    }

    fs::remove_file(&file_path)
        .map_err(|e| format!("删除配置文件失败: {}", e))?;

    Ok(())
}
