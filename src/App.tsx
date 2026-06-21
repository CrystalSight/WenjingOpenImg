import { useState, useEffect, useRef } from 'react';
import { Button, message, Space, Card, Typography, ConfigProvider, Input, Select, Modal, Layout, Menu, InputNumber } from 'antd';
import { SettingOutlined, PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';
import { open } from '@tauri-apps/api/dialog';
import { listen } from '@tauri-apps/api/event';
import { getConfig, updateConfig, selectWenjingRoot } from './api/config';
import { getProjects, getShots, getShotFullPrompt } from './api/database';
import { backupProject } from './api/project';
import { fetchModels, testApiConnection, type TestConnectionResult } from './api/api_client';
import { startBatchGeneration } from './api/batch';
import { saveConfigPreset, loadConfigPreset, listConfigPresets, deleteConfigPreset } from './api/preset';
import { inspectProject } from './api/inspection';
import type { AppConfig, ProjectInfo } from './types';

const { Title, Text } = Typography;
const { Sider, Content } = Layout;


function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);

  // API配置状态
  const [apiUrl, setApiUrl] = useState<string>('');
  const [apiKey, setApiKey] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [modelList, setModelList] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(false);
  const [isTestingConnection, setIsTestingConnection] = useState<boolean>(false);

  // 批量生图配置状态(通过配置方案管理)
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
  const [selectedMenuKey, setSelectedMenuKey] = useState<string>('generation');

  // 自定义模型参数状态
  const [customParams, setCustomParams] = useState<string>('{}');
  const [paramsError, setParamsError] = useState<string>('');

  // 选中的项目ID
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

  // 项目预检结果
  interface InspectionResult {
    project_id: number;
    project_name: string;
    total_shots: number;
    existing_images: number;
    missing_prompt_shots: Array<{
      shot_id: number;
      order: number;
      prompt: string;
    }>;
  }
  const [inspectionResult, setInspectionResult] = useState<InspectionResult | null>(null);

  // 备份状态
  const [isBackingUp, setIsBackingUp] = useState<boolean>(false);

  // 配置方案列表
  const [configPresets, setConfigPresets] = useState<string[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>('');

  const hasLoadedProjects = useRef(false);
  const isInitialLoad = useRef(true);

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    if (config?.wenjing_root && !hasLoadedProjects.current) {
      autoLoadProjects();
      hasLoadedProjects.current = true;
    }
  }, [config]);

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

      // 加载保存的API配置
      if (cfg.api_url) {
        setApiUrl(cfg.api_url);
      }
      if (cfg.api_key) {
        setApiKey(cfg.api_key);
      }
      if (cfg.model) {
        setSelectedModel(cfg.model);
      }
      if (cfg.common_params) {
        setCustomParams(cfg.common_params);
      }
      setConcurrency(cfg.concurrency);
      setTimeoutSecs(cfg.timeout_secs);
      setMaxRetries(cfg.max_retries);

      // 加载配置方案列表
      loadConfigPresets();

      // 标记初始加载完成
      setTimeout(() => {
        isInitialLoad.current = false;
      }, 100);
    } catch {
      message.error('加载配置失败');
    }
  };

  // 自动保存配置(使用防抖)
  useEffect(() => {
    // 初始加载时不触发保存
    if (isInitialLoad.current) {
      return;
    }

    // 防抖:延迟500ms执行保存
    const timer = setTimeout(async () => {
      if (!config) return;

      try {
        const updatedConfig: AppConfig = {
          ...config,
          api_url: apiUrl || undefined,
          api_key: apiKey || undefined,
          model: selectedModel || undefined,
          common_params: customParams || '{}',
          concurrency,
          timeout_secs: timeoutSecs,
          max_retries: maxRetries,
        };

        await updateConfig(updatedConfig);
        setConfig(updatedConfig);
        console.log('配置已自动保存');
      } catch (error) {
        console.error('自动保存配置失败:', error);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [apiUrl, apiKey, selectedModel, customParams, concurrency, timeoutSecs, maxRetries]);

  // 加载项目列表(通过文件系统扫描 + 数据库联合查询)
  const autoLoadProjects = async () => {
    if (!config?.wenjing_root) return;
    
    try {
      const loaded = await getProjects(config.wenjing_root);
      setProjects(loaded);
      if (loaded.length > 0) {
        message.info(`已加载 ${loaded.length} 个项目`);
      } else {
        message.info('未找到匹配的项目，请确认工作区配置正确');
      }
    } catch (error) {
      message.error(`加载项目失败: ${error}`);
      console.error('自动加载项目失败:', error);
    }
  };

  // 处理项目选择
  const handleProjectSelect = async (projectId: number) => {
    setSelectedProjectId(projectId);
    setInspectionResult(null);
    
    if (!config?.wenjing_root) return;
    
    try {
      const result = await inspectProject(config.wenjing_root, projectId);
      setInspectionResult(result);
      
      if (result.missing_prompt_shots.length > 0) {
        Modal.warning({
          title: '发现缺少提示词的分镜',
          content: (
            <div>
              <p>以下 {result.missing_prompt_shots.length} 个分镜缺少提示词:</p>
              <ul>
                {result.missing_prompt_shots.map(shot => (
                  <li key={shot.shot_id}>
                    分镜 #{shot.order} (ID: {shot.shot_id})
                  </li>
                ))}
              </ul>
              <p>是否继续生图?(这些分镜将被跳过)</p>
            </div>
          ),
          onOk: () => {
            message.info('已确认,可以开始生图');
          },
        });
      } else {
        message.success('项目预检通过,可以开始生图');
      }
    } catch (error) {
      message.error(`预检失败: ${error}`);
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
          await loadConfig();
          // 重新加载项目列表
          hasLoadedProjects.current = false;
          try {
            const loaded = await getProjects(selected);
            setProjects(loaded);
            if (loaded.length > 0) {
              message.info(`已加载 ${loaded.length} 个项目`);
            } else {
              message.info('未找到匹配的项目，请确认工作区配置正确');
            }
          } catch (error) {
            message.error(`加载项目失败: ${error}`);
          }
        } else {
          message.error('请选择包含 aigc.sqlite 和 zuopin 文件夹的文镜根目录');
        }
      }
    } catch {
      message.error('选择目录失败');
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

  // API请求预览
  const handlePreviewApiRequest = async () => {
    if (!selectedProjectId || !config?.wenjing_root) {
      message.warning('请先在批量生图页选择一个项目');
      return;
    }
    
    if (!apiUrl || !selectedModel) {
      message.warning('请先配置API URL和选择模型');
      return;
    }
    
    try {
      // 获取项目的所有分镜
      const shots = await getShots(config.wenjing_root, selectedProjectId);
      
      if (shots.length === 0) {
        message.warning('该项目没有分镜');
        return;
      }
      
      // 随机选择一个分镜
      const randomIndex = Math.floor(Math.random() * shots.length);
      const randomShot = shots[randomIndex];
      
      // 获取完整提示词
      const fullPrompt = await getShotFullPrompt(config.wenjing_root, randomShot.id);
      
      // 解析自定义参数
      let extraParams = {};
      try {
        if (customParams.trim()) {
          extraParams = JSON.parse(customParams);
        }
      } catch {
        // 如果解析失败,使用空对象
      }
      
      // 构建完整的API请求Payload
      const payload = {
        model: selectedModel,
        prompt: fullPrompt,
        ...extraParams
      };
      
      // 显示弹窗
      Modal.info({
        title: 'API请求预览',
        width: 600,
        content: (
          <div>
            <Text strong>选中的分镜:</Text> 第{randomIndex + 1}个 / 共{shots.length}个 (ID: {randomShot.id})<br/><br/>
            <Text strong>完整提示词:</Text><br/>
            <pre style={{ 
              background: '#f5f5f5', 
              padding: 12, 
              borderRadius: 4,
              maxHeight: 200,
              overflow: 'auto',
              fontSize: 12
            }}>
              {fullPrompt}
            </pre><br/>
            <Text strong>请求内容:</Text><br/>
            <pre style={{ 
              background: '#f5f5f5', 
              padding: 12, 
              borderRadius: 4,
              maxHeight: 300,
              overflow: 'auto',
              fontSize: 12
            }}>
              {JSON.stringify(payload, null, 2)}
            </pre>
          </div>
        ),
        okText: '关闭',
      });
      
    } catch (error) {
      message.error(`生成预览失败: ${error}`);
      console.error('API预览错误:', error);
    }
  };

  const handleBackupAndStartGeneration = async () => {
    if (!selectedProjectId || !config?.wenjing_root) {
      message.warning('请先选择项目');
      return;
    }
    
    if (!apiUrl || !selectedModel) {
      message.warning('请先配置API URL和选择模型');
      return;
    }
    
    if (!!paramsError) {
      message.warning('请修正自定义参数格式错误');
      return;
    }
    
    setIsBackingUp(true);
    try {
      const backupPath = await backupProject(config.wenjing_root, selectedProjectId);
      message.success(`项目备份成功: ${backupPath}`);
    } catch (error) {
      message.error(`备份失败: ${error}`);
      setIsBackingUp(false);
      return;
    }
    setIsBackingUp(false);
    
    setIsGenerating(true);
    setTaskProgress({
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      status: 'running'
    });

    let unlisten: (() => void) | undefined;

    try {
      unlisten = await listen('task-update', (event: { payload: { type: string; total?: number; failed_count?: number; success_count?: number; skipped_count?: number } }) => {
        const update = event.payload;
        
        switch (update.type) {
          case 'Started':
            setTaskProgress(prev => ({ ...prev, totalShots: update.total }));
            break;
          case 'Success':
            setTaskProgress(prev => ({ ...prev, successCount: prev.successCount + 1 }));
            break;
          case 'Failed':
            setTaskProgress(prev => ({ ...prev, failedCount: prev.failedCount + 1 }));
            break;
          case 'Skipped':
            setTaskProgress(prev => ({ ...prev, skippedCount: prev.skippedCount + 1 }));
            break;
          case 'Completed':
            setTaskProgress(prev => ({ ...prev, status: 'completed' }));
            
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
            unlisten?.();
            break;
        }
      });
      
      const taskId = await startBatchGeneration(
        config.wenjing_root,
        selectedProjectId,
        apiUrl,
        apiKey || undefined,
        selectedModel,
        customParams || '{}',
        concurrency,
        timeoutSecs,
        maxRetries
      );

      message.success(`批量生图任务已启动,任务ID: ${taskId}`);
      
    } catch (error) {
      message.error(`启动批量生图失败: ${error}`);
      setIsGenerating(false);
      setTaskProgress(prev => ({ ...prev, status: 'idle' }));
      if (unlisten) {
        unlisten();
      }
    }
  };

  // 加载配置方案列表
  const loadConfigPresets = async () => {
    try {
      const presets = await listConfigPresets();
      setConfigPresets(presets);
    } catch (error) {
      message.error(`加载配置方案列表失败: ${error}`);
    }
  };

  // 保存配置方案
  const handleSavePreset = async () => {
    if (!selectedPreset) {
      message.warning('请输入方案名称');
      return;
    }
    
    try {
      await saveConfigPreset({
        name: selectedPreset,
        api_url: apiUrl || undefined,
        api_key: apiKey || undefined,
        model: selectedModel || undefined,
        concurrency,
        timeout_secs: timeoutSecs,
        max_retries: maxRetries,
        common_params: customParams,
      });
      message.success(`配置方案 '${selectedPreset}' 保存成功`);
      loadConfigPresets();
    } catch (error) {
      message.error(`保存配置方案失败: ${error}`);
    }
  };

  // 加载配置方案
  const handleLoadPreset = async () => {
    if (!selectedPreset) {
      message.warning('请选择配置方案');
      return;
    }
    
    try {
      const preset = await loadConfigPreset(selectedPreset);
      setApiUrl(preset.api_url || '');
      setApiKey(preset.api_key || '');
      setSelectedModel(preset.model || '');
      setConcurrency(preset.concurrency);
      setTimeoutSecs(preset.timeout_secs);
      setMaxRetries(preset.max_retries);
      setCustomParams(preset.common_params);
      message.success(`已加载配置方案 '${selectedPreset}'`);
    } catch (error) {
      message.error(`加载配置方案失败: ${error}`);
    }
  };

  const handleDeletePreset = async () => {
    if (!selectedPreset) {
      message.warning('请选择要删除的方案');
      return;
    }
    
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除配置方案 '${selectedPreset}' 吗?`,
      onOk: async () => {
        try {
          await deleteConfigPreset(selectedPreset);
          message.success(`配置方案 '${selectedPreset}' 已删除`);
          setSelectedPreset('');
          loadConfigPresets();
        } catch (error) {
          message.error(`删除配置方案失败: ${error}`);
        }
      },
    });
  };

  // 渲染配置区域
  const renderConfigSection = () => (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card title="文镜根目录">
        <Space>
          <Text>{config?.wenjing_root || '未设置'}</Text>
          <Button onClick={handleSelectWenjingRoot}>
            选择目录
          </Button>
        </Space>
      </Card>

      <Card title="配置方案管理">
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <label style={{ display: 'block', marginBottom: 8 }}>方案名称:</label>
            <Input
              placeholder="输入新方案名称或从下拉列表选择"
              value={selectedPreset}
              onChange={(e) => setSelectedPreset(e.target.value)}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 8 }}>或从已有方案选择:</label>
            <Select
              placeholder="选择已有方案"
              value={selectedPreset || undefined}
              onChange={(value: string) => setSelectedPreset(value ?? '')}
              style={{ width: '100%' }}
              options={configPresets.map(name => ({ label: name, value: name }))}
            />
          </div>
          
          <Space>
            <Button onClick={handleSavePreset} disabled={!selectedPreset}>
              保存当前配置为方案
            </Button>
            <Button onClick={handleLoadPreset} disabled={!selectedPreset}>
              加载选中方案
            </Button>
            <Button onClick={handleDeletePreset} disabled={!selectedPreset} danger>
              删除选中方案
            </Button>
            <Button onClick={loadConfigPresets}>
              刷新方案列表
            </Button>
          </Space>
        </Space>
      </Card>
      
      <Card title="API配置">
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <label style={{ display: 'block', marginBottom: 8 }}>API地址:</label>
            <Input
              placeholder="例如: https://api.example.com/v1"
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
          
          <div>
            <label style={{ display: 'block', marginBottom: 8 }}>超时时间(秒):</label>
            <InputNumber
              min={30}
              max={600}
              value={timeoutSecs}
              onChange={(value) => {
                if (value === null || value === undefined) {
                  setTimeoutSecs(180);
                } else {
                  setTimeoutSecs(value);
                }
              }}
              style={{ width: '100%' }}
            />
          </div>

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

          <Button
            onClick={handleTestConnection}
            loading={isTestingConnection}
            disabled={!apiUrl || !selectedModel}
          >
            测试API连接
          </Button>
        </Space>
      </Card>

      {/* 自定义模型参数 */}
      <Card title="自定义模型参数">
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <label style={{ display: 'block', marginBottom: 8 }}>
              JSON格式参数(可选):
            </label>
            <Input.TextArea
              rows={6}
              placeholder='例如: {"width": 512, "height": 512, "steps": 20}'
              value={customParams}
              onChange={(e) => setCustomParams(e.target.value)}
              style={{ fontFamily: 'monospace' }}
            />
            {paramsError && (
              <Text type="danger" style={{ fontSize: 12, marginTop: 4 }}>
                {paramsError}
              </Text>
            )}
          </div>
        </Space>
      </Card>

      {/* API请求预览 */}
      <Card title="调试工具">
        <Button onClick={handlePreviewApiRequest} block>
          API请求预览
        </Button>
        <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
          随机选取一个分镜,生成完整的API请求内容供检查
        </Text>
      </Card>
    </Space>
  );

  // 渲染生图区域
  const renderGenerationSection = () => (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card title="选择项目">
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <Select
            placeholder="请选择要生图的项目"
            value={selectedProjectId}
            onChange={handleProjectSelect}
            style={{ flex: 1 }}
            options={projects.map(p => ({ label: p.name, value: p.id }))}
            disabled={projects.length === 0}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={autoLoadProjects}
            disabled={!config?.wenjing_root}
          >
            刷新项目
          </Button>
        </div>
        {projects.length === 0 && config?.wenjing_root && (
          <Text type="secondary">未找到项目，请确认工作区配置正确后点击“刷新项目”</Text>
        )}
      </Card>
      
      {inspectionResult && (
        <Card title="项目预检结果" type="inner">
          <div style={{ marginBottom: 10 }}>
            <Text strong>项目名称:</Text> {inspectionResult.project_name}<br/>
            <Text strong>分镜总数:</Text> {inspectionResult.total_shots}<br/>
            <Text strong>已有图片:</Text> {inspectionResult.existing_images}<br/>
            <Text strong>缺失提示词:</Text> {inspectionResult.missing_prompt_shots.length} 个
          </div>
          
          {inspectionResult.missing_prompt_shots.length > 0 && (
            <div>
              <Text type="warning">以下分镜缺少提示词:</Text>
              <ul>
                {inspectionResult.missing_prompt_shots.map(shot => (
                  <li key={shot.shot_id}>
                    分镜 #{shot.order} (ID: {shot.shot_id})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
      
      <Button
        type="primary"
        danger
        size="large"
        block
        onClick={handleBackupAndStartGeneration}
        loading={isGenerating || isBackingUp}
        disabled={!selectedProjectId || !apiUrl || !selectedModel || !!paramsError || inspectionResult === null}
      >
        {isBackingUp ? '正在备份...' : '开始批量生图'}
      </Button>
      
      {isGenerating && (
        <Card title="生图进度">
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

  return (
    <ConfigProvider locale={zhCN}>
      <Layout style={{ minHeight: '100vh' }}>
        <Layout.Header style={{ 
          background: '#fff', 
          padding: '0 24px',
          borderBottom: '1px solid #f0f0f0',
          position: 'sticky',
          top: 0,
          zIndex: 10
        }}>
          <Title level={3} style={{ margin: 0, lineHeight: '64px' }}>
            文镜生图插件
          </Title>
        </Layout.Header>
        
        <Layout>
          <Sider 
            width={200} 
            theme="light" 
            style={{ 
              borderRight: '1px solid #f0f0f0',
              height: 'calc(100vh - 64px)',
              overflow: 'auto',
              position: 'sticky',
              top: 64
            }}
          >
            <Menu
              mode="inline"
              selectedKeys={[selectedMenuKey]}
              onClick={({ key }) => setSelectedMenuKey(key)}
              items={[
                { key: 'generation', label: '批量生图', icon: <PlayCircleOutlined /> },
                { key: 'config', label: '基础配置', icon: <SettingOutlined /> }
              ]}
            />
          </Sider>
          
          <Layout style={{ overflow: 'auto' }}>
            <Content style={{ padding: 24, background: '#f5f5f5' }}>
              {selectedMenuKey === 'config' && renderConfigSection()}
              {selectedMenuKey === 'generation' && renderGenerationSection()}
            </Content>
          </Layout>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}

export default App;
