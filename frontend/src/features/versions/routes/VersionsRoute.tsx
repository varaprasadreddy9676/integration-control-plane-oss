import { useMemo, useState } from 'react';
import { App, Card, Space, Select, Input, Modal, Progress, Timeline, Badge } from "@/components/common/LegacyAntdControls";
import { Text as AstryxText } from '@astryxdesign/core/Text';
import { Heading } from '@astryxdesign/core/Heading';
import { Tab, TabList } from '@astryxdesign/core';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigateWithParams } from '../../../utils/navigation';
import { PageHeader } from '../../../components/common/PageHeader';
import { PageTemplate } from '../../../components/common/PageTemplate';
import { StatePanel } from '../../../components/common/StatePanel';
import { Button as AstryxButton } from '@astryxdesign/core/Button';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { cssVar, useDesignTokens, withAlpha, spacingToNumber } from '../../../design-system/utils';
import './versions-route.css';
import {
  getIntegrationVersions,
  createIntegrationVersion,
  updateIntegrationVersion,
  deleteIntegrationVersion,
  setDefaultIntegrationVersion,
  activateIntegrationVersion,
  rollbackIntegrationVersion,
  compareIntegrationVersions,
  getIntegrationCompatibilityMatrix,
} from '../../../services/api';
import type { IntegrationConfig } from '../../../mocks/types';
import { formatDateTime } from '../../../utils/format';
import { ModernTable } from '../../../components/common/ModernTable';
import { Button } from '../../../components/common/LegacyButton';
import { InlineNotice as Notice } from '../../../components/common';

const { TextArea } = Input;

interface IntegrationVersion {
  id: string;
  name: string;
  version: string;
  versionNotes?: string;
  isDefault: boolean;
  isPrerelease: boolean;
  isActive: boolean;
  compatibilityMode: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, any>;
}

interface CompatibilityMatrix {
  __KEEP_integrationName__: string;
  versions: Array<{
    id: string;
    version: string;
    parsedVersion: {
      major: number;
      minor: number;
      patch: number;
      prerelease: string | null;
    };
    isPrerelease: boolean;
    isActive: boolean;
    isDefault: boolean;
    compatibilityMode: string;
    createdAt: string;
    updatedAt: string;
    isCompatible: boolean;
  }>;
  compatibleVersions: Array<{
    id: string;
    version: string;
    parsedVersion: any;
    isPrerelease: boolean;
    isActive: boolean;
    isDefault: boolean;
    compatibilityMode: string;
    createdAt: string;
    updatedAt: string;
  }>;
  incompatibleVersions: any[];
  summary: {
    totalVersions: number;
    activeVersions: number;
    defaultVersion: any;
    latestVersion?: string;
    defaultCompatibilityMode: string;
  };
}

export const VersionsRoute = () => {
  const navigate = useNavigateWithParams();
  const { __KEEP_integrationName__ } = useParams<{ __KEEP_integrationName__: string }>();
  const queryClient = useQueryClient();
  const { message: msgApi } = App.useApp();
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;

  // State for version management
  const [selectedVersion, setSelectedVersion] = useState<IntegrationVersion | null>(null);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [compatibilityModalVisible, setCompatibilityModalVisible] = useState(false);
  const [rollbackModalVisible, setRollbackModalVisible] = useState(false);
  const [activeTab, setActiveTab] = useState('versions');
  const [compareVersions, setCompareVersions] = useState<[string?, string?]>([]);
  const [formData, setFormData] = useState<Partial<IntegrationVersion>>({});
  const [loading, setLoading] = useState(false);

  // Queries
  const {
    data: versions = [],
    isLoading: versionsLoading,
    isError: versionsError,
    refetch: refetchVersions,
  } = useQuery({
    queryKey: ['integration-versions', __KEEP_integrationName__],
    queryFn: () => getIntegrationVersions(__KEEP_integrationName__!),
    enabled: !!__KEEP_integrationName__,
    staleTime: 60_000,
  });

  const {
    data: compatibility,
    isLoading: compatibilityLoading,
    isError: compatibilityError,
    refetch: refetchCompatibility,
  } = useQuery({
    queryKey: ['integration-compatibility', __KEEP_integrationName__],
    queryFn: () => getIntegrationCompatibilityMatrix(__KEEP_integrationName__!),
    enabled: !!__KEEP_integrationName__,
    staleTime: 60_000,
  });

  // Mutations
  const createVersionMutation = useMutation({
    mutationFn: (data: any) => createIntegrationVersion(__KEEP_integrationName__!, data),
    onSuccess: () => {
      msgApi.success('Version created successfully');
      setCreateModalVisible(false);
      setFormData({});
      queryClient.invalidateQueries({ queryKey: ['integration-versions'] });
    },
    onError: (error) => {
      msgApi.error(`Failed to create version: ${error.message}`);
    },
  });

  const updateVersionMutation = useMutation({
    mutationFn: ({ versionId, data }: { versionId: string; data: any }) =>
      updateIntegrationVersion(__KEEP_integrationName__!, versionId, data),
    onSuccess: () => {
      msgApi.success('Version updated successfully');
      setEditModalVisible(false);
      setSelectedVersion(null);
      setFormData({});
      queryClient.invalidateQueries({ queryKey: ['integration-versions'] });
    },
    onError: (error) => {
      msgApi.error(`Failed to update version: ${error.message}`);
    },
  });

  const deleteVersionMutation = useMutation({
    mutationFn: (versionId: string) => deleteIntegrationVersion(__KEEP_integrationName__!, versionId),
    onSuccess: () => {
      msgApi.success('Version deleted successfully');
      setSelectedVersion(null);
      queryClient.invalidateQueries({ queryKey: ['integration-versions'] });
    },
    onError: (error) => {
      msgApi.error(`Failed to delete version: ${error.message}`);
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: (versionId: string) => setDefaultIntegrationVersion(__KEEP_integrationName__!, versionId),
    onSuccess: () => {
      msgApi.success('Default version updated successfully');
      queryClient.invalidateQueries({ queryKey: ['integration-versions'] });
    },
    onError: (error) => {
      msgApi.error(`Failed to set default version: ${error.message}`);
    },
  });

  const activateVersionMutation = useMutation({
    mutationFn: ({ versionId, activate }: { versionId: string; activate: boolean }) =>
      activateIntegrationVersion(__KEEP_integrationName__!, versionId, { activate }),
    onSuccess: (_, variables) => {
      const action = variables.activate ? 'activated' : 'deactivated';
      msgApi.success(`Version ${action} successfully`);
      queryClient.invalidateQueries({ queryKey: ['integration-versions'] });
    },
    onError: (error) => {
      msgApi.error(`Failed to change version status: ${error.message}`);
    },
  });

  const rollbackMutation = useMutation({
    mutationFn: ({ versionId, reason }: { versionId: string; reason: string }) =>
      rollbackIntegrationVersion(__KEEP_integrationName__!, versionId, { reason }),
    onSuccess: () => {
      msgApi.success('Rollback completed successfully');
      setRollbackModalVisible(false);
      setSelectedVersion(null);
      queryClient.invalidateQueries({ queryKey: ['integration-versions'] });
      queryClient.invalidateQueries({ queryKey: ['integration-compatibility'] });
    },
    onError: (error) => {
      msgApi.error(`Rollback failed: ${error.message}`);
    },
  });

  // Derived state
  const currentActiveVersion = useMemo(
    () => versions.find((v) => v.isActive) ?? versions.find((v) => v.isDefault) ?? null,
    [versions]
  );

  // Helper functions
  const parseVersion = (version: string) => {
    const parts = version.split('.');
    const prereleaseMatch = version.match(/^(.*)-(.+)$/);
    return {
      major: parseInt(parts[0]) || 0,
      minor: parseInt(parts[1]) || 0,
      patch: parseInt(parts[2]) || 0,
      prerelease: prereleaseMatch ? prereleaseMatch[2] : null,
    };
  };

  const getVersionIcon = (version: IntegrationVersion) => {
    if (version.isDefault) return <GatewayIcon name="CheckCircleOutlined" className="console-text-success" />;
    if (version.isActive) return <GatewayIcon name="RocketOutlined" className="console-text-accent" />;
    if (version.isPrerelease) return <GatewayIcon name="WarningOutlined" className="console-text-warning" />;
    return <GatewayIcon name="ClockCircleOutlined" className="console-text-muted" />;
  };

  const getStatusBadge = (version: IntegrationVersion) => {
    if (version.isDefault) return <StatusBadge label="Default" variant="info" size="small" />;
    if (version.isActive) return <StatusBadge label="Active" variant="success" size="small" />;
    return <StatusBadge label="Inactive" variant="neutral" size="small" />;
  };

  const formatCompatibilityMode = (mode: string) =>
    mode
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/^\w/, (letter) => letter.toUpperCase());

  const getCompatibilityColor = (isCompatible: boolean) => {
    return isCompatible ? colors.success[600] : colors.error[600];
  };

  const handleCreateVersion = () => {
    setFormData({
      versionNotes: '',
      isPrerelease: false,
      compatibilityMode: 'BACKWARD_COMPATIBLE',
      isDefault: false,
    });
    setCreateModalVisible(true);
  };

  const handleEditVersion = (version: IntegrationVersion) => {
    setSelectedVersion(version);
    setFormData({
      versionNotes: version.versionNotes,
      isPrerelease: version.isPrerelease,
      compatibilityMode: version.compatibilityMode,
    });
    setEditModalVisible(true);
  };

  const handleDeleteVersion = (version: IntegrationVersion) => {
    Modal.confirm({
      title: `Delete version ${version.version}?`,
      content: 'This action cannot be undone. If this is the default version, another version will be set as default.',
      okButtonProps: { danger: true },
      onOk: () => deleteVersionMutation.mutate(version.id),
    });
  };

  const handleSetDefault = (version: IntegrationVersion) => {
    setDefaultMutation.mutate(version.id);
  };

  const handleActivateToggle = (version: IntegrationVersion) => {
    activateVersionMutation.mutate({
      versionId: version.id,
      activate: !version.isActive,
    });
  };

  const handleRollback = (version: IntegrationVersion) => {
    setSelectedVersion(version);
    setRollbackModalVisible(true);
  };

  const handleCompareVersions = () => {
    if (compareVersions.length === 2) {
      // Navigate to comparison view
      navigate(`/versions/${__KEEP_integrationName__}/compare/${compareVersions[0]}/${compareVersions[1]}`);
    }
  };

  const versionColumns = [
    {
      title: 'Version',
      key: 'version',
      render: (_: any, record: IntegrationVersion) => (
        <Space>
          {getVersionIcon(record)}
          <Space direction="vertical" size={2}>
            <Space>
              <AstryxText weight="semibold">{record.version}</AstryxText>
              {getStatusBadge(record)}
            </Space>
            <Space size={4}>
              {record.isPrerelease && (
                <AstryxText type="supporting" color="secondary">
                  Pre-release
                </AstryxText>
              )}
              <AstryxText type="supporting" color="secondary">
                {formatCompatibilityMode(record.compatibilityMode)}
              </AstryxText>
            </Space>
          </Space>
        </Space>
      ),
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: formatDateTime,
    },
    {
      title: 'Notes',
      dataIndex: 'versionNotes',
      key: 'versionNotes',
      ellipsis: true,
      render: (notes: string) => (
        <AstryxText
          type="supporting"
          color="secondary"
          className="ui-extracted-888b85c032"
          maxLines={1}
          hasTruncateTooltip="above"
        >
          {notes || 'No notes provided'}
        </AstryxText>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: IntegrationVersion) => (
        <Space>
          {!record.isDefault && (
            <Button type="text" size="small" onClick={() => handleSetDefault(record)}>
              Set Default
            </Button>
          )}
          <Button type="text" size="small" onClick={() => handleActivateToggle(record)}>
            {record.isActive ? 'Deactivate' : 'Activate'}
          </Button>
          <Button type="text" size="small" onClick={() => handleEditVersion(record)}>
            Edit
          </Button>
          <Button type="text" size="small" onClick={() => handleRollback(record)}>
            Rollback
          </Button>
          {!record.isDefault && (
            <Button type="text" size="small" danger onClick={() => handleDeleteVersion(record)}>
              Delete
            </Button>
          )}
        </Space>
      ),
    },
  ];

  if (versionsError && versions.length === 0) {
    return (
      <PageTemplate
        as="main"
        className="version-management-workspace"
        contentClassName="version-management-workspace__content"
        header={
          <PageHeader
            title={`Versions: ${__KEEP_integrationName__}`}
            breadcrumb={[{ label: 'Integrations', path: '/integrations' }, { label: 'Versions' }]}
            compact
          />
        }
      >
        <StatePanel
          glyph="disrupted"
          tone="critical"
          title="Could not load versions"
          description="Version data is unavailable. No changes were made."
          actions={<AstryxButton label="Retry" variant="secondary" onClick={() => void refetchVersions()} />}
        />
      </PageTemplate>
    );
  }

  return (
    <PageTemplate
      as="main"
      className="version-management-workspace"
      contentClassName="version-management-workspace__content"
      header={
        <PageHeader
          title={`Version Management: ${__KEEP_integrationName__}`}
          description={`Manage event rule versions and compatibility. ${versions.length.toLocaleString()} ${versions.length === 1 ? 'version' : 'versions'}, ${versions.filter((v) => v.isActive).length} active, ${versions.filter((v) => v.isPrerelease).length} pre-release.`}
          compact
          actions={
            <Space>
              <Button
                size="middle"
                icon={<GatewayIcon name="HistoryOutlined" />}
                onClick={() => setCompatibilityModalVisible(true)}
              >
                Compatibility Matrix
              </Button>
              <Button
                type="primary"
                size="middle"
                icon={<GatewayIcon name="PlusOutlined" />}
                onClick={handleCreateVersion}
              >
                Create Version
              </Button>
            </Space>
          }
        />
      }
    >
      <TabList
        role="tablist"
        aria-label="Version views"
        value={activeTab}
        onChange={setActiveTab}
        hasDivider
        className="versions-tabs"
      >
        <Tab id="versions-panel-tab" value="versions" label="Versions" panelId="versions-panel" />
        <Tab id="timeline-panel-tab" value="timeline" label="Timeline" panelId="timeline-panel" />
      </TabList>
      <div
        id="versions-panel"
        role="tabpanel"
        aria-labelledby="versions-panel-tab"
        hidden={activeTab !== 'versions'}
        tabIndex={0}
      >
        <div className="versions-panel-content">
          <Card
            title="Version History"
            size="small"
            extra={
              <Space>
                <Select
                  placeholder="Select versions to compare"
                  mode="multiple"
                  maxCount={2}
                  className="ui-extracted-477d222495"
                  value={compareVersions}
                  onChange={setCompareVersions}
                  options={versions.map((v) => ({
                    value: v.id,
                    label: v.version,
                    disabled: v.id === compareVersions[0] || v.id === compareVersions[1],
                  }))}
                />
                <Button
                  type="primary"
                  size="middle"
                  disabled={compareVersions.length !== 2}
                  onClick={handleCompareVersions}
                >
                  Compare
                </Button>
              </Space>
            }
          >
            <ModernTable
              columns={versionColumns}
              dataSource={versions}
              rowKey="id"
              loading={versionsLoading}
              pagination={{ pageSize: 10 }}
              rowClassName={(record: IntegrationVersion) => (record.isDefault ? 'default-version-row' : '')}
            />
          </Card>
        </div>
      </div>
      <div
        id="timeline-panel"
        role="tabpanel"
        aria-labelledby="timeline-panel-tab"
        hidden={activeTab !== 'timeline'}
        tabIndex={0}
      >
        <Card title="Version Timeline" size="small">
          <Timeline
            mode="left"
            items={versions.map((version) => ({
              dot: getVersionIcon(version),
              children: (
                <Space direction="vertical" size={4}>
                  <Space>
                    <AstryxText weight="semibold">{version.version}</AstryxText>
                    {getStatusBadge(version)}
                  </Space>
                  <AstryxText type="supporting" color="secondary">
                    {formatDateTime(version.createdAt)}
                  </AstryxText>
                  {version.versionNotes && (
                    <AstryxText
                      as="p"
                      display="block"
                      type="supporting"
                      color="secondary" className="console-margin-none"
                    >
                      {version.versionNotes}
                    </AstryxText>
                  )}
                </Space>
              ),
            }))}
          />
        </Card>
      </div>

      {/* Create Version Modal */}
      <Modal
        title="Create New Version"
        open={createModalVisible}
        onOk={() => createVersionMutation.mutate(formData)}
        onCancel={() => {
          setCreateModalVisible(false);
          setFormData({});
        }}
        confirmLoading={createVersionMutation.isPending}
        width={600}
      >
        <Space direction="vertical" size="middle" className="console-width-full">
          <div>
            <AstryxText weight="semibold">Version Information</AstryxText>
            <Space direction="vertical" size="small" className="console-width-full-margin-top-2">
              <div>
                <AstryxText>Version Notes *</AstryxText>
                <TextArea
                  rows={3}
                  placeholder="Describe what's new in this version..."
                  value={formData.versionNotes}
                  onChange={(e) => setFormData((prev) => ({ ...prev, versionNotes: e.target.value }))}
                />
              </div>
              <div>
                <Space className="console-width-full">
                  <div className="console-flex-fill">
                    <AstryxText>Compatibility Mode</AstryxText>
                    <Select
                      value={formData.compatibilityMode}
                      onChange={(value) => setFormData((prev) => ({ ...prev, compatibilityMode: value }))}
                      style={{ width: '100%', marginTop: spacingToNumber(spacing[1]) }}
                      options={[
                        { value: 'BACKWARD_COMPATIBLE', label: 'Backward Compatible' },
                        { value: 'FORWARD_COMPATIBLE', label: 'Forward Compatible' },
                        { value: 'NONE', label: 'No Compatibility' },
                      ]}
                    />
                  </div>
                  <div className="console-flex-fill">
                    <AstryxText>Type</AstryxText>
                    <Select
                      value={formData.isPrerelease}
                      onChange={(value) => setFormData((prev) => ({ ...prev, isPrerelease: value }))}
                      style={{ width: '100%', marginTop: spacingToNumber(spacing[1]) }}
                      options={[
                        { value: false, label: 'Stable Release' },
                        { value: true, label: 'Pre-release' },
                      ]}
                    />
                  </div>
                </Space>
              </div>
            </Space>
          </div>
        </Space>
      </Modal>

      {/* Edit Version Modal */}
      <Modal
        title={`Edit Version: ${selectedVersion?.version}`}
        open={editModalVisible}
        onOk={() =>
          updateVersionMutation.mutate({
            versionId: selectedVersion!.id,
            data: formData,
          })
        }
        onCancel={() => {
          setEditModalVisible(false);
          setSelectedVersion(null);
          setFormData({});
        }}
        confirmLoading={updateVersionMutation.isPending}
        width={600}
      >
        <Space direction="vertical" size="middle" className="console-width-full">
          <div>
            <AstryxText>Current Version: {selectedVersion?.version}</AstryxText>
            <Space direction="vertical" size="small" className="console-width-full-margin-top-2">
              <div>
                <AstryxText>Version Notes</AstryxText>
                <TextArea
                  rows={3}
                  placeholder="Update version notes..."
                  value={formData.versionNotes}
                  onChange={(e) => setFormData((prev) => ({ ...prev, versionNotes: e.target.value }))}
                />
              </div>
              <div>
                <AstryxText>Compatibility Mode</AstryxText>
                <Select
                  value={formData.compatibilityMode}
                  onChange={(value) => setFormData((prev) => ({ ...prev, compatibilityMode: value }))}
                  style={{ width: '100%', marginTop: spacingToNumber(spacing[1]) }}
                  options={[
                    { value: 'BACKWARD_COMPATIBLE', label: 'Backward Compatible' },
                    { value: 'FORWARD_COMPATIBLE', label: 'Forward Compatible' },
                    { value: 'NONE', label: 'No Compatibility' },
                  ]}
                />
              </div>
            </Space>
          </div>
        </Space>
      </Modal>

      {/* Compatibility Matrix Modal */}
      <Modal
        title="Compatibility Matrix"
        open={compatibilityModalVisible}
        onCancel={() => setCompatibilityModalVisible(false)}
        width={1000}
        footer={[
          <Button key="close" onClick={() => setCompatibilityModalVisible(false)}>
            Close
          </Button>,
        ]}
      >
        {compatibility ? (
          <Space direction="vertical" size="large" className="console-width-full">
            <div>
              <Heading level={4}>Compatibility Summary</Heading>
              <Space size="large">
                <Space direction="vertical">
                  <Badge color={getCompatibilityColor(true)} text="Compatible" />
                  <AstryxText>{compatibility.compatibleVersions.length} versions</AstryxText>
                </Space>
                <Space direction="vertical">
                  <Badge color={getCompatibilityColor(false)} text="Incompatible" />
                  <AstryxText>{compatibility.incompatibleVersions.length} versions</AstryxText>
                </Space>
                <Space direction="vertical">
                  <AstryxText weight="semibold">Total Versions</AstryxText>
                  <AstryxText>{compatibility.summary.totalVersions}</AstryxText>
                </Space>
                <Space direction="vertical">
                  <AstryxText weight="semibold">Default Version</AstryxText>
                  <AstryxText>{compatibility.summary.defaultVersion?.version || 'None'}</AstryxText>
                </Space>
              </Space>
            </div>

            <div>
              <Heading level={4}>Version Compatibility Details</Heading>
              <ModernTable
                columns={[
                  { title: 'Version', dataIndex: 'version', key: 'version' },
                  {
                    title: 'Status',
                    dataIndex: 'isCompatible',
                    key: 'isCompatible',
                    render: (compatible: boolean) => (
                      <Badge
                        color={getCompatibilityColor(compatible)}
                        text={compatible ? 'Compatible' : 'Incompatible'}
                      />
                    ),
                  },
                  {
                    title: 'Type',
                    dataIndex: 'isPrerelease',
                    key: 'isPrerelease',
                    render: (prerelease: boolean) => (
                      <AstryxText type="supporting" color="secondary">
                        {prerelease ? 'Pre-release' : 'Stable'}
                      </AstryxText>
                    ),
                  },
                  {
                    title: 'Default',
                    dataIndex: 'isDefault',
                    key: 'isDefault',
                    render: (isDefault: boolean) =>
                      isDefault ? (
                        <GatewayIcon
                          name="CheckCircleOutlined"
                          className="console-text-success"
                          aria-label="Default version"
                        />
                      ) : (
                        '-'
                      ),
                  },
                  { title: 'Created', dataIndex: 'createdAt', key: 'createdAt', render: formatDateTime },
                ]}
                dataSource={compatibility.versions}
                rowKey="id"
                pagination={false}
                scroll={{ y: 300 }}
              />
            </div>
          </Space>
        ) : compatibilityLoading ? (
          <StatePanel glyph="connecting" tone="busy" title="Loading compatibility matrix" size="compact" />
        ) : (
          <StatePanel
            glyph="disrupted"
            tone="critical"
            title="Could not load compatibility data"
            actions={<AstryxButton label="Retry" variant="secondary" onClick={() => void refetchCompatibility()} />}
          />
        )}
      </Modal>

      {/* Rollback Confirmation Modal */}
      <Modal
        title={`Rollback to Version ${selectedVersion?.version}`}
        open={rollbackModalVisible}
        onOk={() =>
          rollbackMutation.mutate({
            versionId: selectedVersion!.id,
            reason: (formData as any).rollbackReason || 'Manual rollback',
          })
        }
        onCancel={() => {
          setRollbackModalVisible(false);
          setSelectedVersion(null);
          setFormData({});
        }}
        confirmLoading={rollbackMutation.isPending}
        okText="Rollback"
        okButtonProps={{ danger: true }}
      >
        <Space direction="vertical" size="middle" className="console-width-full">
          <Notice
            message="Warning: This will rollback the event rule configuration"
            description="Rolling back will change the active event rule version. This may affect downstream systems if they are not compatible with the selected version."
            type="warning"
            className="console-margin-bottom-4"
          />

          <div>
            <Space direction="vertical" size={4}>
              {currentActiveVersion && currentActiveVersion.id !== selectedVersion?.id && (
                <AstryxText>
                  <AstryxText type="supporting" color="secondary">
                    Currently active:{' '}
                  </AstryxText>
                  <AstryxText weight="semibold">{currentActiveVersion.version}</AstryxText>
                  {currentActiveVersion.isDefault && (
                    <AstryxText type="supporting" color="secondary">
                      (default)
                    </AstryxText>
                  )}
                </AstryxText>
              )}
              <AstryxText>
                <AstryxText type="supporting" color="secondary">
                  Rolling back to:{' '}
                </AstryxText>
                <AstryxText weight="semibold">{selectedVersion?.version}</AstryxText>
              </AstryxText>
              {currentActiveVersion && currentActiveVersion.id !== selectedVersion?.id && (
                <AstryxText type="supporting" color="secondary" className="console-type-caption">
                  This will make version <AstryxText weight="semibold">{selectedVersion?.version}</AstryxText> the
                  active version, replacing <AstryxText weight="semibold">{currentActiveVersion.version}</AstryxText>.
                </AstryxText>
              )}
            </Space>
            {selectedVersion?.versionNotes && (
              <AstryxText as="p" display="block" type="supporting" color="secondary" className="console-margin-top-2">
                Notes: {selectedVersion.versionNotes}
              </AstryxText>
            )}
          </div>

          <div>
            <AstryxText weight="semibold">Rollback Reason *</AstryxText>
            <TextArea
              rows={3}
              placeholder="Explain why this rollback is necessary..."
              value={(formData as any).rollbackReason}
              onChange={(e) => setFormData((prev) => ({ ...prev, rollbackReason: e.target.value }) as any)}
            />
          </div>
        </Space>
      </Modal>

      <style>{`
        .default-version-row {
          background-color: ${cssVar.bg.subtle};
          border-left: 3px solid ${cssVar.success.border};
        }
      `}</style>
    </PageTemplate>
  );
};
