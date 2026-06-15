use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// 项目信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub id: i64,
    pub name: String,
    pub created_at: String,
    pub shot_count: i64,
    pub image_count: i64,
}

/// 分镜信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShotInfo {
    pub id: i64,
    pub project_id: i64,
    pub prompt: String,
    pub order: i64,
}

/// 提示词信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptInfo {
    pub style: String,      // 风格(动漫/写实)
    pub era: String,        // 时代(现代/古代)
    pub custom: String,     // 自定义提示词
}

/// 数据库表结构信息(用于探索)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfo {
    pub table_name: String,
    pub columns: Vec<ColumnInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub column_type: String,
}

/// 将Style ID转换为文本
fn style_id_to_text(style_id: i64) -> String {
    match style_id {
        1 => "动漫".to_string(),
        2 => "写实".to_string(),
        // 可以根据实际测试添加更多映射
        _ => String::new(),
    }
}

/// 将TimeEra ID转换为文本
fn era_id_to_text(era_id: i64) -> String {
    match era_id {
        1 => "现代".to_string(),
        2 => "古代".to_string(),
        // 可以根据实际测试添加更多映射
        _ => String::new(),
    }
}

/// 拼接完整提示词
/// 格式: 风格 + "," + 时代 + "\n" + 分镜提示词 + "\n" + 自定义提示词
pub fn build_prompt(style: &str, era: &str, shot_prompt: &str, custom: &str) -> String {
    let mut parts = Vec::new();
    
    // 风格和时代用逗号连接
    let style_era = match (style.is_empty(), era.is_empty()) {
        (false, false) => format!("{},{}", style, era),
        (false, true) => style.to_string(),
        (true, false) => era.to_string(),
        (true, true) => String::new(),
    };
    
    if !style_era.is_empty() {
        parts.push(style_era);
    }
    
    // 分镜提示词
    if !shot_prompt.is_empty() {
        parts.push(shot_prompt.to_string());
    }
    
    // 自定义提示词
    if !custom.is_empty() {
        parts.push(custom.to_string());
    }
    
    parts.join("\n")
}

/// 打开数据库连接
pub fn open_database(db_path: &PathBuf) -> Result<Connection, String> {
    if !db_path.exists() {
        return Err(format!("数据库文件不存在: {:?}", db_path));
    }
    
    Connection::open(db_path)
        .map_err(|e| format!("打开数据库失败: {}", e))
}

/// 探索数据库结构 - 列出所有表和字段
pub fn explore_database(db_path: &PathBuf) -> Result<Vec<TableInfo>, String> {
    let conn = open_database(db_path)?;
    
    // 获取所有表名
    let mut tables = Vec::new();
    
    let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .map_err(|e| format!("查询表列表失败: {}", e))?;
    
    let table_names = stmt.query_map([], |row| {
        row.get::<_, String>(0)
    })
    .map_err(|e| format!("读取表名失败: {}", e))?;
    
    for table_name_result in table_names {
        let table_name = table_name_result.map_err(|e| format!("读取表名失败: {}", e))?;
        
        // 跳过SQLite内部表
        if table_name.starts_with("sqlite_") {
            continue;
        }
        
        // 获取表的列信息
        let columns = get_table_columns(&conn, &table_name)?;
        tables.push(TableInfo {
            table_name,
            columns,
        });
    }
    
    Ok(tables)
}

/// 获取指定表的列信息
fn get_table_columns(conn: &Connection, table_name: &str) -> Result<Vec<ColumnInfo>, String> {
    let query = format!("PRAGMA table_info({})", table_name);
    let mut stmt = conn.prepare(&query)
        .map_err(|e| format!("查询表结构失败: {}", e))?;
    
    let columns = stmt.query_map([], |row| {
        Ok(ColumnInfo {
            name: row.get::<_, String>(1)?,
            column_type: row.get::<_, String>(2)?,
        })
    })
    .map_err(|e| format!("读取列信息失败: {}", e))?;
    
    let mut result = Vec::new();
    for col_result in columns {
        result.push(col_result.map_err(|e| format!("读取列信息失败: {}", e))?);
    }
    
    Ok(result)
}

/// 获取所有项目列表
pub fn list_projects(db_path: &PathBuf) -> Result<Vec<ProjectInfo>, String> {
    let conn = open_database(db_path)?;
    
    let mut stmt = conn.prepare(
        "SELECT v.ID, v.Name, v.CreateTime, 
         COUNT(DISTINCT a.ID) as shot_count,
         0 as image_count
         FROM Videos v
         LEFT JOIN Articles a ON v.ID = a.IDVideo
         GROUP BY v.ID
         ORDER BY v.CreateTime DESC"
    ).map_err(|e| format!("查询项目列表失败: {}", e))?;
    
    let projects = stmt.query_map([], |row| {
        Ok(ProjectInfo {
            id: row.get(0)?,
            name: row.get(1)?,
            created_at: row.get(2)?,
            shot_count: row.get(3)?,
            image_count: row.get(4)?, // 暂时设为0,后续需要扫描文件系统
        })
    })
    .map_err(|e| format!("读取项目数据失败: {}", e))?;
    
    let mut result = Vec::new();
    for project_result in projects {
        result.push(project_result.map_err(|e| format!("读取项目数据失败: {}", e))?);
    }
    
    Ok(result)
}

/// 获取指定项目的分镜列表
pub fn list_shots(db_path: &PathBuf, project_id: i64) -> Result<Vec<ShotInfo>, String> {
    let conn = open_database(db_path)?;
    
    let mut stmt = conn.prepare(
        "SELECT ID, IDVideo, Prompt, OrderNum 
         FROM Articles 
         WHERE IDVideo = ? 
         ORDER BY OrderNum ASC"
    ).map_err(|e| format!("查询分镜列表失败: {}", e))?;
    
    let shots = stmt.query_map([project_id], |row| {
        Ok(ShotInfo {
            id: row.get(0)?,
            project_id: row.get(1)?,
            prompt: row.get(2)?,
            order: row.get(3)?,
        })
    })
    .map_err(|e| format!("读取分镜数据失败: {}", e))?;
    
    let mut result = Vec::new();
    for shot_result in shots {
        result.push(shot_result.map_err(|e| format!("读取分镜数据失败: {}", e))?);
    }
    
    Ok(result)
}

/// 获取项目的公用提示词(风格、时代、自定义)
pub fn get_project_prompts(db_path: &PathBuf, project_id: i64) -> Result<PromptInfo, String> {
    let conn = open_database(db_path)?;
    
    let mut stmt = conn.prepare(
        "SELECT Style, TimeEra, Base 
         FROM Videos 
         WHERE ID = ?"
    ).map_err(|e| format!("查询项目提示词失败: {}", e))?;
    
    let prompts = stmt.query_map([project_id], |row| {
        let style_id: i64 = row.get(0)?;
        let era_id: i64 = row.get(1)?;
        let custom: String = row.get(2)?;
        
        Ok(PromptInfo {
            style: style_id_to_text(style_id),
            era: era_id_to_text(era_id),
            custom: if custom.is_empty() { String::new() } else { custom },
        })
    })
    .map_err(|e| format!("读取提示词数据失败: {}", e))?;
    
    // 取第一条结果
    for prompt_result in prompts {
        return prompt_result.map_err(|e| format!("读取提示词数据失败: {}", e));
    }
    
    Err(format!("未找到项目ID为 {} 的提示词", project_id))
}

/// 从Settings表读取工作区路径
pub fn get_workspace_path(db_path: &PathBuf) -> Result<PathBuf, String> {
    let conn = open_database(db_path)?;
    
    // 查询"设置-工作区"配置项
    let mut stmt = conn.prepare(
        "SELECT Data FROM Settings WHERE Name = ?"
    ).map_err(|e| format!("查询工作区配置失败: {}", e))?;
    
    let workspace_opt: Option<String> = stmt.query_row(["设置-工作区"], |row| {
        row.get::<_, Option<String>>(0)
    }).optional()
    .map_err(|e| format!("读取工作区数据失败: {}", e))?
    .flatten();
    
    if let Some(workspace) = workspace_opt {
        Ok(PathBuf::from(workspace))
    } else {
        Err("未找到工作区配置,请在文镜软件中设置工作区".to_string())
    }
}

/// 获取分镜的完整提示词(拼接后的)
pub fn get_shot_full_prompt(db_path: &PathBuf, shot_id: i64) -> Result<String, String> {
    let conn = open_database(db_path)?;
    
    // 首先获取分镜信息
    let mut stmt = conn.prepare(
        "SELECT a.Prompt, a.IDVideo, v.Style, v.TimeEra, v.Base
         FROM Articles a
         JOIN Videos v ON a.IDVideo = v.ID
         WHERE a.ID = ?"
    ).map_err(|e| format!("查询分镜完整提示词失败: {}", e))?;
    
    let prompts = stmt.query_map([shot_id], |row| {
        let shot_prompt: String = row.get(0)?;
        let _project_id: i64 = row.get(1)?;
        let style_id: i64 = row.get(2)?;
        let era_id: i64 = row.get(3)?;
        let custom: String = row.get(4)?;
        
        let style = style_id_to_text(style_id);
        let era = era_id_to_text(era_id);
        
        Ok(build_prompt(&style, &era, &shot_prompt, &custom))
    })
    .map_err(|e| format!("读取完整提示词失败: {}", e))?;
    
    // 取第一条结果
    for prompt_result in prompts {
        return prompt_result.map_err(|e| format!("读取完整提示词失败: {}", e));
    }
    
    Err(format!("未找到分镜ID为 {} 的提示词", shot_id))
}
