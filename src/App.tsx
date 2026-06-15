import { useState, useEffect } from 'react';
import { Button, message, Space, Card, Typography, ConfigProvider, Table, Input, Select, InputNumber, Modal } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { open } from '@tauri-apps/api/dialog';
import { getConfig, selectWenjingRoot } from './api/config';
import { exploreDatabase, getProjects, getShots, getShotFullPrompt } from './api/database';
import { getProjectDetail, backupProject } from './api/project';
import { fetchModels, testApiConnection, type TestConnectionResult } from './api/api_client';
import { startBatchGeneration } from './api/batch';
import type { AppConfig, TableInfo, ProjectInfo, ShotInfo } from './types';

const { Title, Text } = Typography;

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

  useEffect(() => {
    loadConfig();
  }, []);

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
    try {
      // 调用后端批量生图命令
      const taskId = await startBatchGeneration(
        config.wenjing_root,
        firstProject.id,
        apiUrl,
        apiKey || undefined,
        selectedModel,
        '{}',  // 通用参数为空JSON对象
        concurrency,
        timeoutSecs,
        maxRetries
      );

      message.success(`批量生图任务已启动,任务ID: ${taskId}`);
      console.log('批量生图任务已启动:', taskId);
      
      // TODO: 后续可以添加实时进度监听
    } catch (error) {
      message.error(`启动批量生图失败: ${error}`);
      console.error('批量生图错误:', error);
    } finally {
      setIsGenerating(false);
    }
  };

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
      <div style={{ padding: '40px' }}>
        <Title level={2}>文镜生图插件</Title>
        
        <Card title="配置信息" style={{ marginTop: 20 }}>
          <Space direction="vertical" size="large">
            <div>
              <Text strong>文镜根目录: </Text>
              <Text>{config?.wenjing_root || '未设置'}</Text>
            </div>
            
            <div>
              <Text strong>并发数: </Text>
              <Text>{config?.concurrency}</Text>
            </div>
            
            <div>
              <Text strong>超时时间: </Text>
              <Text>{config?.timeout_secs} 秒</Text>
            </div>
            
            <Space wrap>
              <Button type="primary" onClick={handleSelectWenjingRoot}>
                选择文镜根目录
              </Button>
            </Space>
          </Space>
        </Card>

        <Card title="API配置" style={{ marginTop: 20 }}>
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            {/* API URL输入 */}
            <div>
              <label style={{ display: 'block', marginBottom: 8 }}>API Base URL:</label>
              <Input
                placeholder="例如: https://api.openai.com/v1"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            {/* API Key输入 */}
            <div>
              <label style={{ display: 'block', marginBottom: 8 }}>API Key:</label>
              <Input.Password
                placeholder="请输入API密钥"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            {/* 获取模型列表按钮 */}
            <Button
              type="primary"
              onClick={handleFetchModels}
              loading={isLoadingModels}
              disabled={!apiUrl}
            >
              获取模型列表
            </Button>

            {/* 模型选择下拉框 */}
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

            {/* 测试API连接按钮 */}
            <Button
              onClick={handleTestConnection}
              loading={isTestingConnection}
              disabled={!apiUrl || !selectedModel}
            >
              测试API连接
            </Button>
          </Space>
        </Card>

        <Card title="批量生图" style={{ marginTop: 20 }}>
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            {/* 项目选择提示 */}
            <div style={{ color: '#666' }}>
              当前将使用第一个项目进行测试: {projects.length > 0 ? projects[0].name : '未加载项目'}
            </div>

            {/* 并发数设置 */}
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

            {/* 超时时间设置 */}
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

            {/* 最大重试次数 */}
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

            {/* 开始批量生图按钮 */}
            <Button
              type="primary"
              danger
              onClick={handleStartBatchGeneration}
              loading={isGenerating}
              disabled={!apiUrl || !selectedModel || projects.length === 0}
            >
              开始批量生图
            </Button>

            {/* 进度显示区域(可选) */}
            {isGenerating && (
              <div style={{ padding: 10, background: '#f5f5f5', borderRadius: 4 }}>
                <p>任务进行中...</p>
                <p>请查看控制台日志获取详细信息</p>
              </div>
            )}
          </Space>
        </Card>

        {config?.wenjing_root && (
          <>
            <Card title="数据库探索" style={{ marginTop: 20 }}>
              <Space>
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

            {tables.length > 0 && (
              <Card title="数据库表结构" style={{ marginTop: 20 }}>
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

            {projects.length > 0 && (
              <Card title="项目列表" style={{ marginTop: 20 }}>
                <Table
                  dataSource={projects}
                  rowKey="id"
                  columns={[
                    { title: 'ID', dataIndex: 'id', key: 'id' },
                    { title: '名称', dataIndex: 'name', key: 'name' },
                    { title: '创建时间', dataIndex: 'created_at', key: 'created_at' },
                    { title: '分镜数', dataIndex: 'shot_count', key: 'shot_count' },
                    { title: '图片数', dataIndex: 'image_count', key: 'image_count' },
                  ]}
                />
              </Card>
            )}

            {shots.length > 0 && (
              <Card title="分镜列表" style={{ marginTop: 20 }}>
                <Table
                  dataSource={shots}
                  rowKey="id"
                  columns={[
                    { title: '分镜ID', dataIndex: 'id', key: 'id', width: 100 },
                    { title: '排序号', dataIndex: 'order', key: 'order', width: 100 },
                    { 
                      title: '提示词', 
                      dataIndex: 'prompt', 
                      key: 'prompt',
                      ellipsis: true,
                    },
                  ]}
                />
              </Card>
            )}
          </>
        )}
      </div>
    </ConfigProvider>
  );
}

export default App;
