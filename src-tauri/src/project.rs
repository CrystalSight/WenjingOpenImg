use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::fs;
use tracing;
use crate::database;

/// 项目详细信息(包含文件系统信息)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectDetail {
    pub id: i64,
    pub name: String,
    pub created_at: String,
    pub shot_count: i64,
    pub image_count: i64,  // 已有图片数量
    pub project_folder: String,  // 项目文件夹路径
}

/// 分镜状态
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ShotStatus {
    Pending,      // 待处理
    Exists,       // 已存在(跳过)
    Success,      // 成功
    Failed,       // 失败
}

/// 分镜处理信息
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShotProcessInfo {
    pub shot_id: i64,
    pub prompt: String,
    pub full_prompt: String,  // 拼接后的完整提示词
    pub status: ShotStatus,
    pub image_path: Option<String>,
}

/// 扫描项目文件夹,统计已有图片数量
pub fn scan_project_images(wenjing_root: &PathBuf, project_id: i64, project_name: &str) -> Result<i64, String> {
    // 构建项目文件夹路径
    let project_dir = wenjing_root.join("zuopin");
    
    // 检查目录是否存在
    if !project_dir.exists() {
        return Err(format!("项目目录不存在: {:?}", project_dir));
    }
    
    // 查找匹配的项目文件夹(格式: 日期_项目ID)
    let entries = fs::read_dir(&project_dir)
        .map_err(|e| format!("读取项目目录失败: {}", e))?;
    
    let mut image_count = 0i64;
    let mut found_project = false;
    
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let path = entry.path();
        
        if !path.is_dir() {
            continue;
        }
        
        // 检查文件夹名称是否包含项目ID或项目名称
        if let Some(folder_name) = path.file_name().and_then(|n| n.to_str()) {
            // 文镜的项目文件夹格式可能是: 2026-06-13_15_22_02_4
            // 我们需要通过数据库找到对应的文件夹
            // 这里简化处理,假设能通过某种方式映射
            // 实际实现可能需要更复杂的逻辑
            
            // 尝试匹配项目名称或ID
            let folder_lower = folder_name.to_lowercase();
            let name_lower = project_name.to_lowercase();
            
            // 如果文件夹名称包含项目名称或ID,则认为是目标项目
            if folder_lower.contains(&name_lower) || folder_lower.contains(&project_id.to_string()) {
                found_project = true;
                
                let base_dir = path.join("base");
                if base_dir.exists() && base_dir.is_dir() {
                    // 统计base目录下的png文件数量
                    let images = fs::read_dir(&base_dir)
                        .map_err(|e| format!("读取base目录失败: {}", e))?;
                    
                    for img_entry in images {
                        let img_entry = img_entry.map_err(|e| format!("读取图片目录项失败: {}", e))?;
                        let img_path = img_entry.path();
                        
                        if let Some(ext) = img_path.extension().and_then(|e| e.to_str()) {
                            if ext.to_lowercase() == "png" || ext.to_lowercase() == "jpg" {
                                image_count += 1;
                            }
                        }
                    }
                }
            }
        }
    }
    
    // 如果没有找到匹配的项目文件夹,返回0
    if !found_project {
        tracing::warn!("未找到项目 {} (ID: {}) 的文件夹", project_name, project_id);
    }
    
    Ok(image_count)
}

/// 扫描指定文件夹的图片数量
fn scan_project_images_by_folder(project_folder: &PathBuf) -> Result<i64, String> {
    let base_dir = project_folder.join("base");
    
    if !base_dir.exists() || !base_dir.is_dir() {
        return Ok(0);
    }
    
    let mut image_count = 0i64;
    let entries = fs::read_dir(&base_dir)
        .map_err(|e| format!("读取base目录失败: {}", e))?;
    
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let img_path = entry.path();
        
        if let Some(ext) = img_path.extension().and_then(|e| e.to_str()) {
            if ext.to_lowercase() == "png" || ext.to_lowercase() == "jpg" {
                image_count += 1;
            }
        }
    }
    
    Ok(image_count)
}

/// 从Path字段提取项目文件夹路径
fn extract_project_folder_from_path(path: &str) -> String {
    // Path格式可能是: D:\APP\wenjing\zuopin/2026-06-13_21_17_07_5/base/...
    // 需要提取到base目录的父目录
    if let Some(base_pos) = path.find("/base/") {
        path[..base_pos].to_string()
    } else if let Some(base_pos) = path.find("\\base\\") {
        path[..base_pos].to_string()
    } else {
        // 如果没有base,尝试提取zuopin下的文件夹
        path.to_string()
    }
}

/// 通过工作区配置和CreateTime定位项目文件夹
fn locate_project_by_workspace(db_path: &PathBuf, create_time: &str) -> Result<String, String> {
    // 1. 读取工作区路径
    let workspace = database::get_workspace_path(db_path)?;
    
    // 2. 将CreateTime转换为文件夹命名格式
    // CreateTime格式: "2026-06-13 21:17:07"
    // 文件夹格式: "2026-06-13_21_17_07_X"
    let folder_prefix = create_time.replace(" ", "_").replace(":", "_");
    
    // 3. 扫描工作区目录下匹配的文件夹
    if !workspace.exists() || !workspace.is_dir() {
        return Err(format!("工作区目录不存在: {}", workspace.display()));
    }
    
    let entries = fs::read_dir(&workspace)
        .map_err(|e| format!("读取工作区目录失败: {}", e))?;
    
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let folder_name = entry.file_name()
            .to_string_lossy()
            .to_string();
        
        // 检查是否以CreateTime转换的前缀开头
        if folder_name.starts_with(&folder_prefix) && entry.path().is_dir() {
            return Ok(entry.path().to_string_lossy().to_string());
        }
    }
    
    // 如果没找到精确匹配,返回错误提示
    Err(format!(
        "未找到对应的项目文件夹。\n期望前缀: {}\n工作区: {}\n\n可能原因:\n1. 项目尚未生成文件夹(需在文镜中保存一次)\n2. 工作区配置不正确",
        folder_prefix,
        workspace.display()
    ))
}

/// 获取项目的详细信(包含图片统计)
pub fn get_project_detail(wenjing_root: &PathBuf, project_id: i64) -> Result<ProjectDetail, String> {
    let db_path = wenjing_root.join("aigc.sqlite");
    let conn = database::open_database(&db_path)?;
    
    // 从数据库读取项目信息
    let mut stmt = conn.prepare(
        "SELECT Name, CreateTime, Path FROM Videos WHERE ID = ?"
    ).map_err(|e| format!("查询项目信息失败: {}", e))?;
    
    let mut projects = stmt.query_map([project_id], |row| {
        Ok((
            row.get::<_, String>(0)?,  // Name
            row.get::<_, String>(1)?,  // CreateTime
            row.get::<_, Option<String>>(2)?,  // Path
        ))
    })
    .map_err(|e| format!("读取项目数据失败: {}", e))?;
    
    let (name, created_at, path_opt) = projects
        .next()
        .ok_or_else(|| format!("未找到项目ID为 {} 的信息", project_id))?
        .map_err(|e| format!("读取项目数据失败: {}", e))?;
    
    // 获取分镜数量
    let shot_count = database::list_shots(&db_path, project_id)
        .map(|shots| shots.len() as i64)
        .unwrap_or(0);
    
    // 确定项目文件夹路径
    let project_folder = if let Some(path) = path_opt {
        // 如果数据库中有Path字段且不为空,优先使用它
        if !path.is_empty() {
            extract_project_folder_from_path(&path)
        } else {
            // Path为空,需要通过工作区配置和CreateTime来定位
            locate_project_by_workspace(&db_path, &created_at)?
        }
    } else {
        // Path字段不存在,通过工作区配置和CreateTime来定位
        locate_project_by_workspace(&db_path, &created_at)?
    };
    
    // 扫描图片数量
    let image_count = scan_project_images_by_folder(&PathBuf::from(&project_folder))?;
    
    Ok(ProjectDetail {
        id: project_id,
        name,
        created_at,
        shot_count,
        image_count,
        project_folder,
    })
}

/// 检查分镜是否已有图片
pub fn check_shot_exists(_wenjing_root: &PathBuf, project_folder: &str, shot_id: i64) -> bool {
    let base_dir = PathBuf::from(project_folder).join("base");
    
    if !base_dir.exists() {
        return false;
    }
    
    // 检查是否存在以shot_id命名的图片文件
    // 文镜可能使用分镜ID作为文件名,如: 1078.png
    let possible_paths = vec![
        base_dir.join(format!("{}.png", shot_id)),
        base_dir.join(format!("{}.jpg", shot_id)),
    ];
    
    for path in possible_paths {
        if path.exists() {
            return true;
        }
    }
    
    false
}

/// 备份项目文件夹
pub fn backup_project(workspace: &PathBuf, project_folder: &str, project_name: &str) -> Result<String, String> {
    // 获取工作区的父目录作为备份根目录
    let workspace_parent = workspace.parent()
        .ok_or_else(|| format!("无法获取工作区父目录: {}", workspace.display()))?;
    
    let backup_dir = workspace_parent.join("zuopin_backup");
    
    // 创建备份目录
    fs::create_dir_all(&backup_dir)
        .map_err(|e| format!("创建备份目录失败: {}", e))?;
    
    // 生成备份文件夹名称(项目名_时间戳)
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let backup_folder_name = format!("{}_{}", project_name, timestamp);
    let backup_path = backup_dir.join(&backup_folder_name);
    
    // 复制项目文件夹到备份目录
    if PathBuf::from(project_folder).exists() {
        copy_dir_all(PathBuf::from(project_folder), &backup_path)
            .map_err(|e| format!("备份项目失败: {}", e))?;
        
        tracing::info!("项目备份成功: {:?}", backup_path);
        Ok(backup_path.to_string_lossy().to_string())
    } else {
        Err(format!("项目文件夹不存在: {}", project_folder))
    }
}

/// 递归复制目录
fn copy_dir_all(src: PathBuf, dst: &PathBuf) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        
        if ty.is_dir() {
            copy_dir_all(entry.path(), &dst.join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), dst.join(entry.file_name()))?;
        }
    }
    
    Ok(())
}
