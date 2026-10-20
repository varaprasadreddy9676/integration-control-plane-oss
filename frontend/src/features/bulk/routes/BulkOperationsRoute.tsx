import { useEffect, useMemo, useRef, useState } from 'react';
import {
  App,
  Alert,
  Button,
  Card,
  Modal,
  Space,
  Tag,
  Typography,
  Upload,
  message as staticMessage,
} from 'antd';
import {
  DeleteOutlined,
  DownloadOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TableColumnsType } from 'antd';
import { PageHeader } from '../../../components/common/PageHeader';
import { ModernTable } from '../../../components/common/ModernTable';
import {
  bulkDeleteIntegrations,
  bulkDisableIntegrations,
  bulkEnableIntegrations,
  downloadIntegrationExport,
  getIntegrations,
  importIntegrations,
  validateBulkImport,
} from '../../../services/api';
import type { IntegrationConfig } from '../../../mocks/types';
import { useTenant } from '../../../app/tenant-context';
import { celebrateActivation } from '../../../design-system/delight';

const { Title, Text } = Typography;
const { Dragger } = Upload;

type BulkOperation = 'delete' | 'activate' | 'deactivate';
type ImportStep = 'upload' | 'preview';

interface ImportData {
  integrations: Partial<IntegrationConfig>[];
  metadata?: Record<string, unknown>;
}

const operationLabel: Record<BulkOperation, string> = {
  activate: 'Activate',
  deactivate: 'Deactivate',
  delete: 'Delete',
};

export const BulkOperationsRoute = () => {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const { orgId } = useTenant();
  const [selectedIntegrationIds, setSelectedIntegrationIds] = useState<string[]>([]);
  const [selectedOperation, setSelectedOperation] = useState<BulkOperation | null>(null);
  const [activeTab, setActiveTab] = useState<'operations' | 'import'>('operations');
  const [importData, setImportData] = useState<ImportData | null>(null);
  const [importStep, setImportStep] = useState<ImportStep>('upload');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [exportLoading, setExportLoading] = useState(false);
  const previousOrgId = useRef(orgId);

  useEffect(() => {
    if (previousOrgId.current === orgId) return;
    previousOrgId.current = orgId;
    setSelectedIntegrationIds([]);
    setSelectedOperation(null);
    setImportData(null);
    setImportStep('upload');
    setValidationErrors([]);
  }, [orgId]);

  const { data: integrations = [], isLoading } = useQuery({
    queryKey: ['integrations', 'bulk', orgId],
    queryFn: () => getIntegrations(orgId),
    enabled: orgId > 0,
  });

  const selectedIntegrations = useMemo(
    () => integrations.filter((integration) => selectedIntegrationIds.includes(integration.id)),
    [integrations, selectedIntegrationIds]
  );

  const bulkMutation = useMutation({
    mutationFn: async ({ operation, ids }: { operation: BulkOperation; ids: string[] }) => {
      if (operation === 'delete') return bulkDeleteIntegrations(ids);
      if (operation === 'activate') return bulkEnableIntegrations(ids);
      return bulkDisableIntegrations(ids);
    },
    onSuccess: async (result: { deletedCount?: number; updatedCount?: number; failedIds: string[] }, variables) => {
      const completed = result.deletedCount ?? result.updatedCount ?? 0;
      const failed = result.failedIds?.length ?? 0;
      await queryClient.invalidateQueries({ queryKey: ['integrations'] });
      setSelectedIntegrationIds([]);
      setSelectedOperation(null);

      if (variables.operation === 'activate' && completed > 0) celebrateActivation();
      if (failed > 0) {
        message.warning(`${operationLabel[variables.operation]} completed for ${completed}; ${failed} could not be changed.`);
      } else {
        message.success(`${operationLabel[variables.operation]} completed for ${completed} integration${completed === 1 ? '' : 's'}.`);
      }
    },
    onError: (error: Error) => message.error(error.message || 'Bulk operation failed'),
  });

  const executeBulkOperation = async () => {
    if (!selectedOperation || selectedIntegrationIds.length === 0) return;
    await bulkMutation.mutateAsync({ operation: selectedOperation, ids: selectedIntegrationIds });
  };

  const handleFileUpload = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as ImportData;
      const validation = await validateBulkImport({ importData: parsed });
      if (!validation.valid) {
        setValidationErrors(validation.errors || ['The selected file is not a valid integration export.']);
        return false;
      }

      setValidationErrors([]);
      setImportData(parsed);
      setImportStep('preview');
    } catch (error) {
      setValidationErrors([error instanceof Error ? error.message : 'The selected file could not be read.']);
    }
    return false;
  };

  const importMutation = useMutation({
    mutationFn: (data: ImportData) =>
      importIntegrations({
        importData: data,
        options: {
          validateFirst: true,
          continueOnError: false,
          updateExisting: false,
          activateImported: false,
        },
      }),
    onSuccess: async (result) => {
      const successful = result?.results?.successful?.length ?? 0;
      const failed = result?.results?.failed?.length ?? 0;
      await queryClient.invalidateQueries({ queryKey: ['integrations'] });
      setImportData(null);
      setImportStep('upload');
      message.success(
        `Imported ${successful} inactive integration${successful === 1 ? '' : 's'}${failed ? `; ${failed} failed` : ''}. Review credentials before activation.`
      );
    },
    onError: (error: Error) => message.error(error.message || 'Import failed'),
  });

  const handleExport = async () => {
    if (exportLoading) return;
    setExportLoading(true);
    try {
      await downloadIntegrationExport({
        format: 'json',
        includeInactive: true,
        integrationIds: selectedIntegrationIds.length > 0 ? selectedIntegrationIds : undefined,
      });
      message.success(`Exported ${selectedIntegrationIds.length || integrations.length} integration configurations.`);
    } catch (error) {
      staticMessage.error(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setExportLoading(false);
    }
  };

  const columns: TableColumnsType<IntegrationConfig> = [
    {
      title: 'Integration',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{name}</Text>
          <Text type="secondary">{record.type || record.eventType || 'No event type'}</Text>
        </Space>
      ),
    },
    {
      title: 'Target',
      dataIndex: 'targetUrl',
      key: 'targetUrl',
      ellipsis: true,
      render: (targetUrl?: string) => targetUrl || <Text type="secondary">Not configured</Text>,
    },
    {
      title: 'Method',
      dataIndex: 'httpMethod',
      key: 'httpMethod',
      width: 110,
      render: (method?: string) => <Tag>{method || 'POST'}</Tag>,
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 120,
      render: (isActive?: boolean) => (
        <Tag color={isActive ? 'success' : 'default'}>{isActive ? 'Active' : 'Inactive'}</Tag>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Bulk Operations"
        description="Apply controlled changes to multiple outbound integrations or move configurations between environments."
        statusChips={[{ label: `${selectedIntegrationIds.length} selected` }]}
        actions={
          <Space wrap>
            <Button icon={<DownloadOutlined />} onClick={handleExport} disabled={isLoading} loading={exportLoading}>
              {selectedIntegrationIds.length > 0 ? 'Export selected' : 'Export all'}
            </Button>
            <Button type="primary" icon={<UploadOutlined />} onClick={() => setActiveTab('import')}>
              Import
            </Button>
          </Space>
        }
      />

      <Card
        tabList={[
          { key: 'operations', tab: 'Bulk changes' },
          { key: 'import', tab: 'Import / export' },
        ]}
        activeTabKey={activeTab}
        onTabChange={(key) => setActiveTab(key as 'operations' | 'import')}
      >
        {activeTab === 'operations' && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Alert
              type="info"
              showIcon
              message="Select outbound integrations, then apply one action. Changes are limited to the active organization."
            />
            <Space wrap>
              <Button
                icon={<PlayCircleOutlined />}
                disabled={selectedIntegrationIds.length === 0}
                onClick={() => setSelectedOperation('activate')}
              >
                Activate
              </Button>
              <Button
                icon={<PauseCircleOutlined />}
                disabled={selectedIntegrationIds.length === 0}
                onClick={() => setSelectedOperation('deactivate')}
              >
                Deactivate
              </Button>
              <Button
                danger
                icon={<DeleteOutlined />}
                disabled={selectedIntegrationIds.length === 0}
                onClick={() => setSelectedOperation('delete')}
              >
                Delete
              </Button>
            </Space>
            <ModernTable
              columns={columns}
              dataSource={integrations}
              rowKey="id"
              loading={isLoading}
              rowSelection={{
                selectedRowKeys: selectedIntegrationIds,
                onChange: (keys) => setSelectedIntegrationIds(keys.map(String)),
                preserveSelectedRowKeys: false,
              }}
              pagination={{ pageSize: 20, showSizeChanger: true }}
            />
          </Space>
        )}

        {activeTab === 'import' && (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            {importStep === 'upload' && (
              <div>
                <Title level={4}>Import configurations</Title>
                <Dragger accept=".json,application/json" beforeUpload={handleFileUpload} showUploadList={false}>
                  <p className="ant-upload-drag-icon"><UploadOutlined /></p>
                  <p className="ant-upload-text">Select or drop an Integration Gateway JSON export</p>
                  <p className="ant-upload-hint">Credentials and other sensitive values are never included in exports.</p>
                </Dragger>
                {validationErrors.length > 0 && (
                  <Alert
                    type="error"
                    showIcon
                    message="The file could not be imported"
                    description={validationErrors.join(' ')}
                    style={{ marginTop: 16 }}
                  />
                )}
              </div>
            )}

            {importStep === 'preview' && importData && (
              <div>
                <Title level={4}>Review import</Title>
                <Alert
                  type="warning"
                  showIcon
                  message={`${importData.integrations.length} integration${importData.integrations.length === 1 ? '' : 's'} will be created in organization ${orgId}.`}
                  description="Existing integrations are not overwritten. Imports remain inactive until credentials and environment-specific values are reviewed."
                  style={{ marginBottom: 16 }}
                />
                <ModernTable
                  columns={columns as TableColumnsType<Partial<IntegrationConfig>>}
                  dataSource={importData.integrations}
                  rowKey={(record, index) => record.id || record.name || String(index)}
                  pagination={{ pageSize: 10 }}
                />
                <Space style={{ marginTop: 16 }}>
                  <Button
                    type="primary"
                    loading={importMutation.isPending}
                    onClick={() => importMutation.mutate(importData)}
                  >
                    Import configurations
                  </Button>
                  <Button onClick={() => { setImportStep('upload'); setImportData(null); }}>
                    Choose another file
                  </Button>
                </Space>
              </div>
            )}

            <div>
              <Title level={4}>Export configurations</Title>
              <Text type="secondary">
                Export the selected integrations, or all outbound integrations when no rows are selected.
              </Text>
              <div style={{ marginTop: 12 }}>
                <Button icon={<DownloadOutlined />} onClick={handleExport} disabled={isLoading} loading={exportLoading}>
                  {selectedIntegrationIds.length > 0 ? 'Export selected' : 'Export all'}
                </Button>
              </div>
            </div>
          </Space>
        )}
      </Card>

      <Modal
        title={selectedOperation ? `${operationLabel[selectedOperation]} selected integrations?` : 'Confirm bulk action'}
        open={selectedOperation !== null}
        onOk={executeBulkOperation}
        onCancel={() => setSelectedOperation(null)}
        confirmLoading={bulkMutation.isPending}
        okText={selectedOperation ? operationLabel[selectedOperation] : 'Confirm'}
        okButtonProps={{ danger: selectedOperation === 'delete' }}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Text>
            This action affects {selectedIntegrationIds.length} integration{selectedIntegrationIds.length === 1 ? '' : 's'}
            in organization {orgId}.
          </Text>
          {selectedIntegrations.length > 0 && (
            <Text type="secondary">{selectedIntegrations.map((integration) => integration.name).join(', ')}</Text>
          )}
          {selectedOperation === 'delete' && (
            <Alert
              type="error"
              showIcon
              message="Deletion cannot be undone"
              description="Future deliveries stop immediately. Historical delivery logs are retained."
            />
          )}
        </Space>
      </Modal>
    </div>
  );
};
