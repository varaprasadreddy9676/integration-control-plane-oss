import { useState, useMemo } from 'react';
import {
  Card,
  Modal,
  Form,
  Input,
  Select,
  Checkbox,
  Space,
  Tooltip,
  Popconfirm,
  message,
  Row,
  Col,
  Divider,
} from '@/components/common/LegacyAntdControls';
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../components/common/Icon';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../components/common/PageHeader';
import { PageTemplate } from '../../components/common/PageTemplate';
import { FilterBar } from '../../components/common/FilterBar';
import { MetaTag } from '../../components/common/MetaTag';
import { StatusBadge } from '../../components/common/StatusBadge';
import { useDesignTokens, spacingToNumber } from '../../design-system/utils';
import { FEATURES, OPERATIONS } from '../../utils/permissions';
import { getRoles, createRole, updateRole, deleteRole, type RoleConfig } from '../../services/api';
import { ModernTable } from '../../components/common/ModernTable';
import { Button } from '../../components/common/LegacyButton';
import { InlineHint } from '../../components/common/InlineHint';
import { StatePanel } from '../../components/common/StatePanel';

const { TextArea } = Input;

interface PermissionMatrixRow {
  feature: string;
  featureName: string;
  [roleKey: string]: any;
}

export const RoleManagementRoute = () => {
  const { spacing, token } = useDesignTokens();
  const queryClient = useQueryClient();
  const [editingRole, setEditingRole] = useState<RoleConfig | null>(null);
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [scopeFilter, setScopeFilter] = useState<string>('all');
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: getRoles,
  });

  const updateMutation = useMutation({
    mutationFn: ({
      role,
      payload,
    }: {
      role: string;
      payload: { name?: string; description?: string; features?: Record<string, string[]> };
    }) => updateRole(role, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      setIsEditModalVisible(false);
      setEditingRole(null);
      message.success('Role permissions updated successfully');
    },
    onError: (error: any) => {
      message.error(error.message || 'Failed to update role');
    },
  });

  const createMutation = useMutation({
    mutationFn: createRole,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      setIsCreateModalVisible(false);
      form.resetFields();
      message.success('Role created successfully');
    },
    onError: (error: any) => {
      message.error(error.message || 'Failed to create role');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteRole,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      message.success('Role deleted successfully');
    },
    onError: (error: any) => {
      message.error(error.message || 'Failed to delete role');
    },
  });

  const handleCreate = () => {
    form.resetFields();
    form.setFieldsValue({
      scope: 'organization',
    });
    setIsCreateModalVisible(true);
  };

  const handleCreateSave = async () => {
    const values = await form.validateFields();
    createMutation.mutate({
      name: values.name,
      description: values.description,
      scope: values.scope,
      features: {},
    });
  };

  const handleEditRole = (role: RoleConfig) => {
    setEditingRole(role);

    const permissions: Record<string, string[]> = {};
    Object.entries(FEATURES).forEach(([_, featureValue]) => {
      permissions[featureValue] = role.features[featureValue] || [];
    });

    editForm.setFieldsValue(permissions);
    setIsEditModalVisible(true);
  };

  const handleEditSave = async () => {
    if (!editingRole) return;

    const values = await editForm.validateFields();

    const features: Record<string, string[]> = {};
    Object.entries(values).forEach(([feature, operations]) => {
      if (Array.isArray(operations) && operations.length > 0) {
        features[feature] = operations;
      }
    });

    updateMutation.mutate({
      role: editingRole.role,
      payload: { features },
    });
  };

  // Filter roles
  const filteredRoles = useMemo(() => {
    return roles.filter((role) => {
      const matchesSearch =
        !searchText ||
        role.name.toLowerCase().includes(searchText.toLowerCase()) ||
        role.role.toLowerCase().includes(searchText.toLowerCase()) ||
        role.description.toLowerCase().includes(searchText.toLowerCase());

      const matchesScope = scopeFilter === 'all' || role.scope === scopeFilter;

      return matchesSearch && matchesScope;
    });
  }, [roles, searchText, scopeFilter]);

  // Build permission matrix data
  const matrixData: PermissionMatrixRow[] = useMemo(() => {
    return Object.entries(FEATURES).map(([key, value]) => {
      const row: PermissionMatrixRow = {
        feature: value,
        featureName: key.replace(/_/g, ' '),
      };

      filteredRoles.forEach((role) => {
        row[role.role] = role.features[value] || [];
      });

      return row;
    });
  }, [filteredRoles]);

  // Build table columns
  const columns = useMemo(
    () => [
      {
        title: 'Feature',
        dataIndex: 'featureName',
        key: 'feature',
        fixed: 'left' as const,
        width: 200,
        render: (text: string) => (
          <Text as="span" weight="semibold" className="ui-extracted-058475f4e6">
            {text}
          </Text>
        ),
      },
      ...filteredRoles.map((role) => ({
        title: (
          <Space direction="vertical" size={0} align="center" className="console-width-full">
            <Space size={4}>
              <Text as="span" weight="semibold">
                {role.name}
              </Text>
              {role.isCustom && (
                <MetaTag variant="category" size="small">
                  CUSTOM
                </MetaTag>
              )}
            </Space>
            <MetaTag size="small">{role.scope}</MetaTag>
          </Space>
        ),
        dataIndex: role.role,
        key: role.role,
        width: 150,
        align: 'center' as const,
        render: (operations: string[] = []) => {
          const allOps = Object.values(OPERATIONS);
          const hasAll = allOps.length > 0 && allOps.every((op) => operations.includes(op));

          if (hasAll) {
            return (
              <Tooltip title="Has all operations">
                <StatusBadge label="Full access" variant="success" size="small" />
              </Tooltip>
            );
          }

          if (operations.length === 0) {
            return <StatusBadge label="No access" variant="neutral" showIcon={false} size="small" />;
          }

          return (
            <Tooltip title={operations.map((op) => op.toUpperCase()).join(', ')}>
              <Space wrap size={2}>
                {operations.map((op) => (
                  <MetaTag key={op} variant="method" size="small">
                    {op.charAt(0).toUpperCase()}
                  </MetaTag>
                ))}
              </Space>
            </Tooltip>
          );
        },
      })),
    ],
    [filteredRoles]
  );

  return (
    <PageTemplate
      header={
        <PageHeader
          title="Role & Permission Management"
          description="Define roles and assign feature permissions"
          actions={
            <Button type="primary" icon={<GatewayIcon name="PlusOutlined" />} onClick={handleCreate}>
              Create Role
            </Button>
          }
        />
      }
    >
      <div className="role-workspace">
        <FilterBar
          rightSlot={
            searchText || scopeFilter !== 'all' ? (
              <Button
                size="small"
                onClick={() => {
                  setSearchText('');
                  setScopeFilter('all');
                }}
              >
                Clear filters
              </Button>
            ) : null
          }
        >
          <div className="role-filter-grid">
            <label className="role-filter-field">
              <span>Search roles</span>
              <Input
                aria-label="Search roles"
                placeholder="Name, description, or role key"
                prefix={<GatewayIcon name="SearchOutlined" />}
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                allowClear
              />
            </label>
            <label className="role-filter-field">
              <span>Scope</span>
              <Select aria-label="Filter roles by scope" value={scopeFilter} onChange={setScopeFilter}>
                <Select.Option value="all">All scopes</Select.Option>
                <Select.Option value="global">Global</Select.Option>
                <Select.Option value="organization">Organization</Select.Option>
                <Select.Option value="api">API</Select.Option>
              </Select>
            </label>
          </div>
        </FilterBar>

        <section className="role-section" aria-label="Roles">
          <div className="role-section-heading">
            <Text as="span" weight="semibold">
              Roles
            </Text>
            <Text as="span" color="secondary">
              Showing {filteredRoles.length} of {roles.length}
            </Text>
          </div>
          {filteredRoles.length === 0 ? (
            <StatePanel
              title="No roles found"
              description={
                searchText || scopeFilter !== 'all'
                  ? 'Try adjusting your filters'
                  : 'No roles available. Create a new role to get started.'
              }
              size="compact"
              actions={
                !searchText && scopeFilter === 'all' ? (
                  <Button type="primary" onClick={handleCreate}>
                    Create Role
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="role-card-list">
              {filteredRoles.map((role) => (
                <Card
                  key={role.role}
                  className="role-item-card"
                  size="small"
                  style={{
                    borderRadius: token.borderRadius,
                    borderLeft: `4px solid ${
                      role.scope === 'global'
                        ? token.colorError
                        : role.scope === 'organization'
                          ? token.colorPrimary
                          : token.colorTextSecondary
                    }`,
                  }}
                  hoverable
                >
                  <Row justify="space-between" align="top" gutter={[12, 12]}>
                    <Col flex="auto">
                      <Space direction="vertical" size={2}>
                        <Space size={8}>
                          <Text as="span" weight="semibold">
                            {role.name}
                          </Text>
                          {role.isCustom && (
                            <MetaTag variant="category" size="small">
                              Custom
                            </MetaTag>
                          )}
                          <MetaTag size="small">{role.scope.toUpperCase()}</MetaTag>
                        </Space>
                        <Text color="secondary">{role.description}</Text>
                        <Text as="span" color="secondary">
                          <GatewayIcon name="InfoCircleOutlined" /> {Object.keys(role.features).length} features
                          configured
                        </Text>
                      </Space>
                    </Col>
                    <Col>
                      <Space wrap>
                        <Button
                          type="primary"
                          size="small"
                          onClick={() => handleEditRole(role)}
                          disabled={role.role === 'SUPER_ADMIN'}
                        >
                          Edit Permissions
                        </Button>
                        {role.isCustom && (
                          <Popconfirm
                            title="Delete Role"
                            description={`Delete "${role.name}"? This cannot be undone.`}
                            onConfirm={() => deleteMutation.mutate(role.role)}
                            okText="Delete"
                            cancelText="Cancel"
                            okButtonProps={{ danger: true }}
                          >
                            <Button
                              danger
                              size="small"
                              icon={<GatewayIcon name="DeleteOutlined" />}
                              loading={deleteMutation.isPending}
                            >
                              Delete
                            </Button>
                          </Popconfirm>
                        )}
                      </Space>
                    </Col>
                  </Row>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Permission Matrix */}
        {filteredRoles.length > 0 && (
          <Card
            title={
              <Space>
                <span>Permission Matrix</span>
                <Tooltip title="Each cell shows which operations a role has for that feature. First letter of each operation is shown.">
                  <GatewayIcon name="InfoCircleOutlined" className="console-text-secondary" />
                </Tooltip>
              </Space>
            }
            className="console-card-radius"
          >
            <ModernTable
              columns={columns}
              dataSource={matrixData}
              rowKey="feature"
              loading={isLoading}
              pagination={false}
              scroll={{ x: 'max-content' }}
              size="small"
              bordered
            />
          </Card>
        )}
      </div>

      {/* Create Role Modal */}
      <Modal
        title="Create New Role"
        open={isCreateModalVisible}
        onCancel={() => setIsCreateModalVisible(false)}
        onOk={handleCreateSave}
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Role Name" rules={[{ required: true, message: 'Please enter a role name' }]}>
            <Input placeholder="e.g., Content Editor" />
          </Form.Item>

          <Form.Item
            name="description"
            label="Description"
            rules={[{ required: true, message: 'Please enter a description' }]}
          >
            <TextArea rows={2} placeholder="Describe what this role can do" />
          </Form.Item>

          <Form.Item name="scope" label="Scope" rules={[{ required: true, message: 'Please select a scope' }]}>
            <Select>
              <Select.Option value="global">Global - Access all organizations</Select.Option>
              <Select.Option value="organization">Organization - Scoped to user's org</Select.Option>
              <Select.Option value="api">API - Service account access</Select.Option>
            </Select>
          </Form.Item>

          <InlineHint>Permissions can be assigned after creating the role.</InlineHint>
        </Form>
      </Modal>

      {/* Edit Permissions Modal */}
      <Modal
        title={
          <Space>
            <span>Edit Permissions: {editingRole?.name}</span>
            {editingRole?.isCustom && (
              <MetaTag variant="category" size="small">
                Custom
              </MetaTag>
            )}
          </Space>
        }
        open={isEditModalVisible}
        onCancel={() => {
          setIsEditModalVisible(false);
          setEditingRole(null);
        }}
        onOk={handleEditSave}
        confirmLoading={updateMutation.isPending}
        width={800}
      >
        <div className="role-edit-summary" style={{ marginBottom: spacing[3] }}>
          <Space split={<Divider type="vertical" />}>
            <Text as="span" color="secondary">
              Role:{' '}
              <Text as="span" weight="semibold">
                {editingRole?.role}
              </Text>
            </Text>
            <Text as="span" color="secondary">
              Scope:{' '}
              <Text as="span" weight="semibold">
                {editingRole?.scope?.toUpperCase()}
              </Text>
            </Text>
          </Space>
          {editingRole?.description && <Text color="secondary">{editingRole.description}</Text>}
        </div>

        <Form form={editForm} layout="vertical">
          <div className="ui-extracted-c2c34aac68">
            <Space direction="vertical" size={spacingToNumber(spacing[2])} className="console-width-full">
              {Object.entries(FEATURES).map(([key, value]) => (
                <Card
                  key={value}
                  size="small"
                  style={{
                    borderRadius: token.borderRadius,
                    backgroundColor: token.colorBgContainer,
                  }}
                >
                  <Form.Item
                    name={value}
                    label={
                      <Text as="span" weight="semibold" className="ui-extracted-058475f4e6">
                        {key.replace(/_/g, ' ')}
                      </Text>
                    }
                    className="console-margin-bottom-none"
                  >
                    <Checkbox.Group className="console-width-full">
                      <Row gutter={[8, 8]}>
                        {Object.entries(OPERATIONS).map(([opKey, opValue]) => (
                          <Col span={8} key={opValue}>
                            <Checkbox value={opValue}>{opKey.replace(/_/g, ' ')}</Checkbox>
                          </Col>
                        ))}
                      </Row>
                    </Checkbox.Group>
                  </Form.Item>
                </Card>
              ))}
            </Space>
          </div>
        </Form>
      </Modal>
    </PageTemplate>
  );
};
