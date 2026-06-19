import { useState, useEffect } from 'react';
import { Button, message, Space, Card, Typography, ConfigProvider, Table, Input, Select, InputNumber, Modal, Layout, Menu } from 'antd';
import { SettingOutlined, PlayCircleOutlined, ToolOutlined } from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';
import { open } from '@tauri-apps/api/dialog';
import { listen } from '@tauri-apps/api/event';
import { getConfig, selectWenjingRoot } from './api/config';
import { exploreDatabase, getProjects, getShots, getShotFullPrompt } from './api/database';
import { getProjectDetail, backupProject } from './api/project';
import { fetchModels, testApiConnection, type TestConnectionResult } from './api/api_client';
import { startBatchGeneration } from './api/batch';
import type { AppConfig, TableInfo, ProjectInfo, ShotInfo } from './types';

const { Title, Text } = Typography;
const { Sider, Content } = Layout;

function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [shots, setShots] = useState<ShotInfo[]>([]);

  // API配置状态
  const [apiUrl, setApiUrl] = useState<string>('');
  const [apiKey, setApiKey] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [modelList, setModelList] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(false);
  const [isTestingConnection, setIsTestingConnection] = useState<boolean>(false);

  // 批量生图配置状态
  const [concurrency, setConcurrency] = useState<number>(1);
  const [timeoutSecs, setTimeoutSecs] = useState<number>(180);
  const [maxRetries, setMaxRetries] = useState<number>(3);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  // 任务进度状态
  interface TaskProgress {
    currentShot?: number;
    totalShots?: number;
    successCount: number;
    failedCount: number;
    skippedCount: number;
    status: 'idle' | 'running' | 'completed';
  }

  const [taskProgress, setTaskProgress] = useState<TaskProgress>({
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    status: 'idle'
  });

  // 侧边栏导航状态
  const [selectedMenuKey, setSelectedMenuKey] = useState<string>('config');

  // 自定义模型参数状态
  const [customParams, setCustomParams] = useState<string>('{}');
  const [paramsError, setParamsError] = useState<string>('');

  useEffect(() => {
    loadConfig();
  }, []);

  // 验证自定义参数的JSON格式
  useEffect(() => {
    if (!customParams.trim()) {
      setParamsError('');
      return;
    }
    
    try {
      JSON.parse(customParams);
      setParamsError('');
    } catch (e) {
      setParamsError(`JSON格式错误: ${e instanceof Error ? e.message : '未知错误'}`);
    }
  }, [customParams]);

  const loadConfig = async () => {
    try {
      const cfg = await getConfig();
      setConfig(cfg);
    } catch (error) {
      message.error('加载配置失败');
    }
  };

  const handleSelectWenjingRoot = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择文镜软件根目录'
      });
      
      if (selected && typeof selected === 'string') {
        const isValid = await selectWenjingRoot(selected);
        if (isValid) {
          message.success('文镜根目录设置成功');
          loadConfig();
        } else {
          message.error('请选择包含 aigc.sqlite 和 zuopin 文件夹的文镜根目录');
        }
      }
    } catch (error) {
      message.error('选择目录失败');
    }
  };

  const handleExploreDatabase = async () => {
    if (!config?.wenjing_root) {
      message.warning('请先选择文镜根目录');
      return;
    }

    try {
      const tables = await exploreDatabase(config.wenjing_root);
      setTables(tables);
      message.success(`发现 ${tables.length} 个表`);
    } catch (error) {
      message.error(`探索数据库失败: ${error}`);
    }
  };

  const handleLoadProjects = async () => {
    if (!config?.wenjing_root) {
      message.warning('请先选择文镜根目录');
      return;
    }

    try {
      const projects = await getProjects(config.wenjing_root);
      setProjects(projects);
      message.success(`加载了 ${projects.length} 个项目`);
    } catch (error) {
      message.error(`加载项目列表失败: ${error}`);
    }
  };

  const handleTestPrompt = async () => {
    if (!config?.wenjing_root || projects.length === 0) {
      message.warning('请先加载项目列表');
      return;
    }

    try {
      // 获取第一个项目的分镜
      const shots = await getShots(config.wenjing_root, projects[0].id);
      if (shots.length > 0) {
        // 获取第一个分镜的完整提示词
        const fullPrompt = await getShotFullPrompt(config.wenjing_root, shots[0].id);
        message.info(`完整提示词:\n${fullPrompt}`);
        console.log('完整提示词:', fullPrompt);
      } else {
        message.warning('该项目没有分镜');
      }
    } catch (error) {
      message.error(`获取提示词失败: ${error}`);
    }
  };

  const handleGetProjectDetail = async () => {
    if (!config?.wenjing_root || projects.length === 0) {
      message.warning('请先加载项目列表');
      return;
    }

    try {
      const firstProject = projects[0];
      const detail = await getProjectDetail(
        config.wenjing_root,
        firstProject.id
      );
      
      // 显示更详细的信息
      const info = `项目详情:
名称: ${detail.name}
分镜数: ${detail.shot_count}
已有图片: ${detail.image_count}
项目文件夹: ${detail.project_folder}`;
      
      message.info(info);
      console.log('项目详情:', detail);
    } catch (error) {
      message.error(`获取项目详情失败: ${error}`);
    }
  };

  const handleBackupProject = async () => {
    if (!config?.wenjing_root || projects.length === 0) {
      message.warning('请先加载项目列表');
      return;
    }

    try {
      const firstProject = projects[0];
      const backupPath = await backupProject(
        config.wenjing_root,
        firstProject.id
      );
      
      message.success(`备份成功: ${backupPath}`);
    } catch (error) {
      message.error(`备份失败: ${error}`);
    }
  };

  // 加载分镜列表
  const handleLoadShots = async () => {
    if (!config?.wenjing_root || projects.length === 0) {
      message.warning('请先加载项目列表');
      return;
    }

    try {
      const firstProject = projects[0];
      const shotList = await getShots(config.wenjing_root, firstProject.id);
      setShots(shotList);
      message.success(`加载了 ${shotList.length} 个分镜`);
    } catch (error) {
      message.error(`加载分镜列表失败: ${error}`);
    }
  };

  const handleFetchModels = async () => {
    if (!apiUrl) {
      message.warning('请先输入API URL');
      return;
    }

    setIsLoadingModels(true);
    try {
      const fetchedModels = await fetchModels(apiUrl, apiKey || undefined);
      setModelList(fetchedModels);
      message.success(`成功获取 ${fetchedModels.length} 个模型`);
      
      // 自动选择第一个包含"image"的模型
      const imageModel = fetchedModels.find(m => m.toLowerCase().includes('image'));
      if (imageModel) {
        setSelectedModel(imageModel);
        message.info(`已自动选择模型: ${imageModel}`);
      }
    } catch (error) {
      message.error(`获取模型列表失败: ${error}`);
      console.error('获取模型列表错误:', error);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleTestConnection = async () => {
    if (!apiUrl || !selectedModel) {
      message.warning('请先配置API URL并选择模型');
      return;
    }

    setIsTestingConnection(true);
    try {
      const result: TestConnectionResult = await testApiConnection(
        apiUrl,
        apiKey || undefined,
        selectedModel
      );
      
      if (result.success) {
        message.success(`连接成功(${result.mode}模式)`);
        console.log('API连接测试结果:', result);
      } else {
        message.error(`连接失败: ${result.error}`);
      }
    } catch (error) {
      message.error(`测试连接失败: ${error}`);
      console.error('测试连接错误:', error);
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleStartBatchGeneration = async () => {
    if (!config?.wenjing_root || projects.length === 0) {
      message.warning('请先加载项目列表');
      return;
    }

    if (!apiUrl || !selectedModel) {
      message.warning('请先配置API URL和选择模型');
      return;
    }

    const firstProject = projects[0];
    
    // 确认操作
    const confirmed = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: '确认开始批量生图?',
        content: `项目: ${firstProject.name}\n分镜数: ${firstProject.shot_count}\n并发数: ${concurrency}\n超时: ${timeoutSecs}秒\n最大重试: ${maxRetries}次`,
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });

    if (!confirmed) return;

    setIsGenerating(true);
    setTaskProgress({
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      status: 'running'
    });

    let unlisten: (() => void) | undefined;

    try {
      // ✅ 第一步: 先注册事件监听器
      unlisten = await listen('task-update', (event: any) => {
        const update = event.payload;
        
        switch (update.type) {
          case 'Started':
            setTaskProgress(prev => ({
              ...prev,
              totalShots: update.total
            }));
            break;
            
          case 'Success':
            setTaskProgress(prev => ({
              ...prev,
              successCount: prev.successCount + 1
            }));
            break;
            
          case 'Failed':
            setTaskProgress(prev => ({
              ...prev,
              failedCount: prev.failedCount + 1
            }));
            break;
            
          case 'Skipped':
            setTaskProgress(prev => ({
              ...prev,
              skippedCount: prev.skippedCount + 1
            }));
            break;
            
          case 'Completed':
            setTaskProgress(prev => ({
              ...prev,
              status: 'completed'
            }));
            
            // 显示最终结果,延长显示时间到5秒
            if (update.failed_count === 0) {
              message.success({
                content: `批量生图完成! 成功:${update.success_count}, 跳过:${update.skipped_count}`,
                duration: 5
              });
            } else {
              message.warning({
                content: `批量生图完成! 成功:${update.success_count}, 失败:${update.failed_count}, 跳过:${update.skipped_count}`,
                duration: 5
              });
            }
            
            setIsGenerating(false);
            unlisten?.();  // 取消监听
            break;
        }
      });
      
      // ✅ 第二步: 再启动批量生图任务
      const taskId = await startBatchGeneration(
        config.wenjing_root,
        firstProject.id,
        apiUrl,
        apiKey || undefined,
        selectedModel,
        customParams || '{}',  // 使用用户输入的自定义参数
        concurrency,
        timeoutSecs,
        maxRetries
      );

      message.success(`批量生图任务已启动,任务ID: ${taskId}`);
      console.log('批量生图任务已启动:', taskId);
      
    } catch (error) {
      message.error(`启动批量生图失败: ${error}`);
      console.error('批量生图错误:', error);
      setIsGenerating(false);
      setTaskProgress(prev => ({ ...prev, status: 'idle' }));
      // 如果启动失败,也要取消监听
      if (unlisten) {
        unlisten();
      }
    }
  };

  // 渲染配置区域
  const renderConfigSection = () => (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {/* 文镜根目录配置 */}
      <Card title="文镜根目录">
        <Space>
          <Text>{config?.wenjing_root || '未设置'}</Text>
          <Button onClick={handleSelectWenjingRoot}>
            选择目录
          </Button>
        </Space>
      </Card>
      
      {/* API配置 */}
      <Card title="API配置">
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <label style={{ display: 'block', marginBottom: 8 }}>API地址:</label>
            <Input
              placeholder="例如: https://api.example.com/v1/images/generations"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
            />
          </div>
          
          <div>
            <label style={{ display: 'block', marginBottom: 8 }}>API密钥:</label>
            <Input.Password
              placeholder="请输入API密钥"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          
          <Button
            onClick={handleFetchModels}
            loading={isLoadingModels}
            disabled={!apiUrl}
          >
            获取模型列表
          </Button>
          
          {modelList.length > 0 && (
            <div>
              <label style={{ display: 'block', marginBottom: 8 }}>选择模型:</label>
              <Select
                placeholder="请选择文生图模型"
                value={selectedModel}
                onChange={(value) => setSelectedModel(value)}
                style={{ width: '100%' }}
                options={modelList.map(model => ({ label: model, value: model }))}
              />
            </div>
          )}
          
          <Button
            onClick={handleTestConnection}
            loading={isTestingConnection}
            disabled={!apiUrl || !selectedModel}
          >
            测试API连接
          </Button>
        </Space>
      </Card>
    </Space>
  );

  // 渲染生图区域
  const renderGenerationSection = () => (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {/* 批量生图配置 */}
      <Card title="批量生图配置">
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <label style={{ display: 'block', marginBottom: 8 }}>并发数:</label>
            <InputNumber
              min={1}
              max={10}
              value={concurrency}
              onChange={(value) => setConcurrency(value || 1)}
              style={{ width: '100%' }}
            />
          </div>
          
          <div>
            <label style={{ display: 'block', marginBottom: 8 }}>超时时间(秒):</label>
            <InputNumber
              min={30}
              max={600}
              value={timeoutSecs}
              onChange={(value) => setTimeoutSecs(value || 180)}
              style={{ width: '100%' }}
            />
          </div>
          
          <div>
            <label style={{ display: 'block', marginBottom: 8 }}>最大重试次数:</label>
            <InputNumber
              min={0}
              max={10}
              value={maxRetries}
              onChange={(value) => setMaxRetries(value || 3)}
              style={{ width: '100%' }}
            />
          </div>
          
          {/* 自定义模型参数 */}
          <div>
            <label style={{ display: 'block', marginBottom: 8 }}>
              自定义模型参数 (JSON格式):
            </label>
            <Input.TextArea
              rows={6}
              placeholder='例如: {"width": 512, "height": 512, "steps": 20}'
              value={customParams}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setCustomParams(e.target.value)}
              style={{ fontFamily: 'monospace' }}
            />
            {paramsError && (
              <Text type="danger" style={{ fontSize: 12 }}>
                {paramsError}
              </Text>
            )}
          </div>
          
          <Button
            type="primary"
            danger
            onClick={handleStartBatchGeneration}
            loading={isGenerating}
            disabled={!apiUrl || !selectedModel || projects.length === 0 || !!paramsError}
          >
            开始批量生图
          </Button>
        </Space>
      </Card>
      
      {/* 任务进度 */}
      {isGenerating && (
        <Card title="任务进度">
          <div style={{ marginBottom: 10 }}>
            <span style={{ marginRight: 15 }}>成功: {taskProgress.successCount}</span>
            <span style={{ marginRight: 15, color: taskProgress.failedCount > 0 ? 'red' : 'inherit' }}>
              失败: {taskProgress.failedCount}
            </span>
            <span>跳过: {taskProgress.skippedCount}</span>
          </div>
        </Card>
      )}
    </Space>
  );

  // 渲染工具区域
  const renderToolsSection = () => (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {/* 数据库探索工具 */}
      <Card title="数据库探索">
        <Space wrap>
          <Button onClick={handleExploreDatabase}>
            探索数据库结构
          </Button>
          <Button onClick={handleLoadProjects}>
            加载项目列表
          </Button>
          <Button onClick={handleTestPrompt}>
            测试提示词拼接
          </Button>
          <Button onClick={handleGetProjectDetail}>
            获取项目详情
          </Button>
          <Button onClick={handleBackupProject}>
            备份项目
          </Button>
          <Button onClick={handleLoadShots}>
            加载分镜列表
          </Button>
        </Space>
      </Card>
      
      {/* 数据库表结构 */}
      {tables.length > 0 && (
        <Card title="数据库表结构">
          <Table 
            columns={tableColumns} 
            dataSource={tables}
            rowKey="table_name"
            expandable={{
              expandedRowRender: (record) => (
                <div>
                  <Text strong>字段列表:</Text>
                  <ul>
                    {record.columns.map((col, idx) => (
                      <li key={idx}>
                        {col.name} ({col.column_type})
                      </li>
                    ))}
                  </ul>
                </div>
              ),
            }}
          />
        </Card>
      )}
    </Space>
  );

  const tableColumns = [
    {
      title: '表名',
      dataIndex: 'table_name',
      key: 'table_name',
    },
    {
      title: '字段数量',
      dataIndex: 'columns',
      key: 'column_count',
      render: (columns: any[]) => columns.length,
    },
  ];

  return (
    <ConfigProvider locale={zhCN}>
      <Layout style={{ minHeight: '100vh' }}>
        {/* 顶部标题栏 */}
        <Layout.Header style={{ 
          background: '#fff', 
          padding: '0 24px',
          borderBottom: '1px solid #f0f0f0'
        }}>
          <Title level={3} style={{ margin: 0, lineHeight: '64px' }}>
            文镜生图插件
          </Title>
        </Layout.Header>
        
        <Layout>
          {/* 侧边栏导航 */}
          <Sider width={200} theme="light" style={{ borderRight: '1px solid #f0f0f0' }}>
            <Menu
              mode="inline"
              selectedKeys={[selectedMenuKey]}
              onClick={({ key }) => setSelectedMenuKey(key)}
              items={[
                { key: 'config', label: '基础配置', icon: <SettingOutlined /> },
                { key: 'generation', label: '批量生图', icon: <PlayCircleOutlined /> },
                { key: 'tools', label: '开发工具', icon: <ToolOutlined /> }
              ]}
            />
          </Sider>
          
          {/* 主内容区 */}
          <Content style={{ padding: 24, background: '#f5f5f5' }}>
            {selectedMenuKey === 'config' && renderConfigSection()}
            {selectedMenuKey === 'generation' && renderGenerationSection()}
            {selectedMenuKey === 'tools' && renderToolsSection()}
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}

export default App;
