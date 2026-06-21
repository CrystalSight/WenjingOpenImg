# 文镜生图插件

基于 OpenAI 兼容 API 的文镜外部批量图片生成工具。通过读取文镜软件的项目数据库，自动拼接提示词并调用 API 批量生成分镜图片。

## 功能

- 批量生图：自动读取文镜项目的分镜提示词，调用 OpenAI 兼容 API 批量生成图片
- 配置方案：支持保存和加载多套 API 配置方案，便于切换不同服务商
- API 预览：随机选取分镜预览完整的 API 请求内容，便于调试
- 项目预检：生图前检查分镜提示词完整性，跳过已有图片
- 自动备份：生图前自动备份项目文件夹

## 技术栈

- 前端：React 18 + TypeScript + Ant Design
- 后端：Rust + Tauri + reqwest
- 数据库：SQLite（读取文镜软件的 aigc.sqlite）

## 项目结构

```
.
├── src/                    # 前端源码（React）
│   ├── api/                # Tauri invoke 封装，对接后端各命令
│   │   ├── api_client.ts   # 模型列表、API 连接测试
│   │   ├── batch.ts        # 批量生图启动
│   │   ├── config.ts       # 主配置读写
│   │   ├── database.ts     # 数据库查询（项目/分镜/提示词）
│   │   ├── inspection.ts   # 项目预检
│   │   ├── preset.ts       # 配置方案 CRUD
│   │   └── project.ts      # 项目详情、备份
│   ├── App.tsx             # 主界面组件
│   ├── types.ts            # TypeScript 类型定义
│   └── main.tsx            # 入口文件
├── src-tauri/              # 后端源码（Rust）
│   ├── src/
│   │   ├── main.rs         # Tauri 命令注册，应用入口
│   │   ├── api_client.rs   # HTTP 客户端，API 调用与重试
│   │   ├── batch_generator.rs  # 批量生图并发调度
│   │   ├── config.rs       # 主配置持久化
│   │   ├── config_presets.rs   # 配置方案文件读写
│   │   ├── database.rs     # SQLite 数据库查询
│   │   └── project.rs      # 项目目录扫描与备份
│   ├── Cargo.toml
│   └── tauri.conf.json     # Tauri 应用配置
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 前置依赖

本插件依赖文镜软件，需在本机安装并至少运行过一次文镜。插件通过读取文镜的本地数据工作：

- `aigc.sqlite`：项目数据库，包含项目列表、分镜信息、提示词等
- `zuopin/`：作品目录，存放各项目的生成图片
- `zuopin/<项目文件夹>/base/`：分镜图片存储目录，文件名为分镜 ID（如 `1078.png`）

插件通过文镜根目录下的 `aigc.sqlite` 和 `zuopin` 文件夹验证目录有效性。

## 构建

```bash
# 安装前端依赖
npm install

# 开发模式
npm run tauri dev

# 构建发布版本
npm run tauri build
```

需要 Rust 工具链和 Node.js 环境。Tauri 构建时会自动编译 Rust 后端。

## 安全提示

API 密钥以明文形式存储在以下本地配置文件中：

- 主配置：`%APPDATA%\WenjingImagePlugin\config.json`
- 配置方案：`~/.wenjing-plugin/presets/config_<名称>.json`

请勿将上述配置文件分享、上传或同步至云端。在共享计算机上使用时请注意密钥安全。

## 许可证

本项目采用 MIT 许可证，详见 [LICENSE](LICENSE) 文件。
