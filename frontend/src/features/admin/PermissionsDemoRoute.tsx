import { Space, Descriptions } from '@/components/common/LegacyAntdControls';
import { Banner } from '@astryxdesign/core/Banner';
import { Heading } from '@astryxdesign/core';
import { Text } from '../../components/common/LegacyTypography';
import { Icon as GatewayIcon } from '../../components/common/Icon';
import { PageTemplate } from '../../components/common/PageTemplate';
import { ConfigSection } from '../../components/common/ConfigSection';
import { cssVar, useDesignTokens } from '../../design-system/utils';
import { useAuth } from '../../app/auth-context';
import { usePermissions } from '../../hooks/usePermissions';
import { FEATURES, OPERATIONS, getRoleFeatures } from '../../utils/permissions';
import { ModernTable } from '../../components/common/ModernTable';

interface PermissionRow {
  feature: string;
  read: boolean;
  write: boolean;
  delete: boolean;
  execute: boolean;
  configure: boolean;
  export: boolean;
}

export const PermissionsDemoRoute = () => {
  const { spacing } = useDesignTokens();
  const { user } = useAuth();
  const { can, role } = usePermissions();

  const roleFeatures = getRoleFeatures(user?.role);

  // Build permission matrix
  const permissionMatrix: PermissionRow[] = Object.keys(FEATURES).map((featureKey) => {
    const feature = FEATURES[featureKey as keyof typeof FEATURES];
    return {
      feature,
      read: can(feature, OPERATIONS.READ),
      write: can(feature, OPERATIONS.WRITE),
      delete: can(feature, OPERATIONS.DELETE),
      execute: can(feature, OPERATIONS.EXECUTE),
      configure: can(feature, OPERATIONS.CONFIGURE),
      export: can(feature, OPERATIONS.EXPORT),
    };
  });

  const columns = [
    {
      title: 'Feature',
      dataIndex: 'feature',
      key: 'feature',
      width: 200,
      render: (text: string) => <Text strong>{text.replace(/_/g, ' ')}</Text>,
    },
    {
      title: 'Read',
      dataIndex: 'read',
      key: 'read',
      width: 80,
      align: 'center' as const,
      render: (hasAccess: boolean) =>
        hasAccess ? (
          <GatewayIcon name="CheckCircleOutlined" className="console-text-success-control" />
        ) : (
          <GatewayIcon name="CloseCircleOutlined" className="console-text-disabled-control" />
        ),
    },
    {
      title: 'Write',
      dataIndex: 'write',
      key: 'write',
      width: 80,
      align: 'center' as const,
      render: (hasAccess: boolean) =>
        hasAccess ? (
          <GatewayIcon name="CheckCircleOutlined" className="console-text-success-control" />
        ) : (
          <GatewayIcon name="CloseCircleOutlined" className="console-text-disabled-control" />
        ),
    },
    {
      title: 'Delete',
      dataIndex: 'delete',
      key: 'delete',
      width: 80,
      align: 'center' as const,
      render: (hasAccess: boolean) =>
        hasAccess ? (
          <GatewayIcon name="CheckCircleOutlined" className="console-text-success-control" />
        ) : (
          <GatewayIcon name="CloseCircleOutlined" className="console-text-disabled-control" />
        ),
    },
    {
      title: 'Execute',
      dataIndex: 'execute',
      key: 'execute',
      width: 80,
      align: 'center' as const,
      render: (hasAccess: boolean) =>
        hasAccess ? (
          <GatewayIcon name="CheckCircleOutlined" className="console-text-success-control" />
        ) : (
          <GatewayIcon name="CloseCircleOutlined" className="console-text-disabled-control" />
        ),
    },
    {
      title: 'Configure',
      dataIndex: 'configure',
      key: 'configure',
      width: 90,
      align: 'center' as const,
      render: (hasAccess: boolean) =>
        hasAccess ? (
          <GatewayIcon name="CheckCircleOutlined" className="console-text-success-control" />
        ) : (
          <GatewayIcon name="CloseCircleOutlined" className="console-text-disabled-control" />
        ),
    },
    {
      title: 'Export',
      dataIndex: 'export',
      key: 'export',
      width: 80,
      align: 'center' as const,
      render: (hasAccess: boolean) =>
        hasAccess ? (
          <GatewayIcon name="CheckCircleOutlined" className="console-text-success-control" />
        ) : (
          <GatewayIcon name="CloseCircleOutlined" className="console-text-disabled-control" />
        ),
    },
  ];

  return (
    <PageTemplate title="Permissions & RBAC" description="View your role-based access control permissions">
      <Space direction="vertical" size={spacingToNumber(spacing[4])} className="console-width-full">
        {/* Current User Info */}
        <ConfigSection title="Your account" icon={<GatewayIcon name="SafetyOutlined" />}>
          <Descriptions column={2}>
            <Descriptions.Item label="Email">{user?.email}</Descriptions.Item>
            <Descriptions.Item label="User ID">{user?.id}</Descriptions.Item>
            <Descriptions.Item label="Role">
              <Text weight="semibold">{user?.role}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="Organization ID">
              {user?.orgId || <Text type="secondary">Global Access</Text>}
            </Descriptions.Item>
            {user?.impersonated && (
              <Descriptions.Item label="Impersonation Status" span={2}>
                <Banner
                  status="warning"
                  title={`You are being impersonated by: ${user.impersonatedBy}`}
                  collapsible={false}
                />
              </Descriptions.Item>
            )}
          </Descriptions>
        </ConfigSection>

        {/* Permission Matrix */}
        <ConfigSection
          title="Permission matrix"
          actions={
            <Text type="supporting" color="secondary">
              {user?.role === 'SUPER_ADMIN' ? (
                <Text color="success">Full Access to All Features</Text>
              ) : (
                `${permissionMatrix.filter((p) => p.read || p.write || p.delete || p.execute || p.configure || p.export).length} / ${permissionMatrix.length} features accessible`
              )}
            </Text>
          }
        >
          <ModernTable
            columns={columns}
            dataSource={permissionMatrix}
            rowKey="feature"
            pagination={false}
            size="small"
            scroll={{ x: 800 }}
            rowClassName={(record) => {
              const hasAnyAccess =
                record.read || record.write || record.delete || record.execute || record.configure || record.export;
              return hasAnyAccess ? '' : 'disabled-row';
            }}
          />
        </ConfigSection>

        {/* RBAC System Info */}
        <ConfigSection title="About role-based access">
          <Space direction="vertical" size={spacingToNumber(spacing[3])}>
            <div>
              <Heading level={5}>Feature-Based Permissions</Heading>
              <Text as="p" display="block">
                This application uses a simple, feature-based RBAC (Role-Based Access Control) system. Each feature has
                standard operations (read, write, delete, execute, configure, export), and roles are mapped to these
                features.
              </Text>
            </div>

            <div>
              <Heading level={5}>Available Roles</Heading>
              <Text as="p" display="block">
                SUPER_ADMIN - Global Access
              </Text>
              <Text as="p" display="block">
                ADMIN - Organization Admin
              </Text>
              <Text as="p" display="block">
                ORG_ADMIN - Organization Admin
              </Text>
              <Text as="p" display="block">
                INTEGRATION_EDITOR - Can Edit Integrations
              </Text>
              <Text as="p" display="block">
                VIEWER - Read-Only Access
              </Text>
              <Text as="p" display="block">
                ORG_USER - Basic User
              </Text>
            </div>

            <div>
              <Heading level={5}>Standard Operations</Heading>
              <ul>
                <li>
                  <Text weight="semibold">READ:</Text> View and list items
                </li>
                <li>
                  <Text weight="semibold">WRITE:</Text> Create and edit items
                </li>
                <li>
                  <Text weight="semibold">DELETE:</Text> Remove items
                </li>
                <li>
                  <Text weight="semibold">EXECUTE:</Text> Run operations (test, retry, etc.)
                </li>
                <li>
                  <Text weight="semibold">CONFIGURE:</Text> Modify settings and configurations
                </li>
                <li>
                  <Text weight="semibold">EXPORT:</Text> Export data to files
                </li>
              </ul>
            </div>
          </Space>
        </ConfigSection>
      </Space>
    </PageTemplate>
  );
};

const spacingToNumber = (spacing: string): number => {
  return parseInt(spacing.replace('px', ''), 10);
};
