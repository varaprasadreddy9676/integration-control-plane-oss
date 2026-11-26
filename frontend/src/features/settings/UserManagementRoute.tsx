import { useEffect, useMemo, useState } from 'react';
import { Form, Input, InputNumber, Modal, Select, Space, Switch, message } from "@/components/common/LegacyAntdControls";
import { Icon as GatewayIcon } from '../../components/common/Icon';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../app/auth-context';
import { PageHeader } from '../../components/common/PageHeader';
import { PageTemplate } from '../../components/common/PageTemplate';
import { FilterBar } from '../../components/common/FilterBar';
import { StatusBadge } from '../../components/common/StatusBadge';
import {
  createAdminUser,
  listAdminUsers,
  resetAdminUserPassword,
  setAdminUserActive,
  updateAdminUser,
} from '../../services/api';
import { ModernTable } from '../../components/common/ModernTable';
import { StatePanel } from '../../components/common/StatePanel';
import { Button } from '../../components/common/LegacyButton';
import { InlineNotice as Notice } from '../../components/common';

export const UserManagementRoute = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const [messageApi, contextHolder] = message.useMessage();
  const [searchDraft, setSearchDraft] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [adminUserModalOpen, setAdminUserModalOpen] = useState(false);
  const [adminEditUser, setAdminEditUser] = useState<any | null>(null);
  const [adminResetPasswordUser, setAdminResetPasswordUser] = useState<any | null>(null);
  const [adminUsersFilterOrg, setAdminUsersFilterOrg] = useState<number | undefined>(undefined);
  const [adminUsersFilterRole, setAdminUsersFilterRole] = useState<string | undefined>(undefined);
  const [adminUsersFilterStatus, setAdminUsersFilterStatus] = useState<'active' | 'disabled' | 'all'>('active');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [adminUserForm] = Form.useForm();
  const [adminResetForm] = Form.useForm();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchDraft.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const filterPayload = useMemo(
    () => ({
      orgId: adminUsersFilterOrg,
      role: adminUsersFilterRole,
      search: debouncedSearch || undefined,
      isActive: adminUsersFilterStatus === 'all' ? undefined : adminUsersFilterStatus === 'active',
      page,
      limit: pageSize,
    }),
    [adminUsersFilterOrg, adminUsersFilterRole, adminUsersFilterStatus, debouncedSearch, page, pageSize]
  );

  const {
    data: adminUsersResponse,
    isLoading,
    error,
    refetch: refetchAdminUsers,
  } = useQuery({
    queryKey: ['adminUsers', filterPayload],
    queryFn: () => listAdminUsers(filterPayload),
    enabled: isAdmin,
    staleTime: 5 * 1000,
  });

  const adminUsers = adminUsersResponse?.users || [];
  const adminUsersTotal = adminUsersResponse?.total || 0;

  const adminUserColumns = [
    { title: 'Email', dataIndex: 'email', key: 'email' },
    { title: 'Role', dataIndex: 'role', key: 'role' },
    { title: 'Org ID', dataIndex: 'orgId', key: 'orgId', render: (value: number) => value ?? '—' },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      render: (value: boolean) => (
        <StatusBadge
          label={value ? 'Active' : 'Disabled'}
          variant={value ? 'success' : 'neutral'}
          showIcon={false}
          size="small"
        />
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: any) => (
        <Space size="small">
          <Button
            size="small"
            onClick={() => {
              setAdminEditUser(record);
              adminUserForm.setFieldsValue({
                email: record.email,
                role: record.role,
                orgId: record.orgId ?? null,
                isActive: record.isActive,
              });
              setAdminUserModalOpen(true);
            }}
          >
            Edit
          </Button>
          <Button
            size="small"
            onClick={() => {
              setAdminResetPasswordUser(record);
              adminResetForm.resetFields();
            }}
          >
            Reset Password
          </Button>
          <Button
            size="small"
            danger={record.isActive}
            onClick={async () => {
              const nextActive = !record.isActive;
              if (!nextActive) {
                Modal.confirm({
                  title: 'Disable user?',
                  content: 'This user will no longer be able to access the system.',
                  okText: 'Disable',
                  okButtonProps: { danger: true },
                  cancelText: 'Cancel',
                  async onOk() {
                    try {
                      const updated = await setAdminUserActive(record.id, nextActive);
                      messageApi.success(updated.isActive ? 'User enabled' : 'User disabled');
                      await refetchAdminUsers();
                    } catch (error: any) {
                      messageApi.error(error?.message || 'Failed to update user');
                    }
                  },
                });
                return;
              }

              try {
                const updated = await setAdminUserActive(record.id, nextActive);
                messageApi.success(updated.isActive ? 'User enabled' : 'User disabled');
                await refetchAdminUsers();
              } catch (error: any) {
                messageApi.error(error?.message || 'Failed to update user');
              }
            }}
          >
            {record.isActive ? 'Disable' : 'Enable'}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <PageTemplate
      as="main"
      className="user-management-page"
      contentClassName="user-management-page__content"
      header={
        <PageHeader
          title="User Management"
          description="Create and manage admins and org-scoped users."
          actions={
            isAdmin ? (
              <Button
                type="primary"
                icon={<GatewayIcon name="PlusOutlined" />}
                onClick={() => {
                  setAdminEditUser(null);
                  adminUserForm.resetFields();
                  adminUserForm.setFieldsValue({ role: 'ORG_ADMIN', isActive: true });
                  setAdminUserModalOpen(true);
                }}
              >
                Create user
              </Button>
            ) : null
          }
        />
      }
    >
      {contextHolder}

      {!isAdmin ? (
        <StatePanel
          glyph="searching"
          tone="neutral"
          title="User management is restricted"
          description="You need an administrator account to manage users."
        />
      ) : (
        <div className="user-management-workspace">
          <FilterBar
            rightSlot={
              searchDraft || adminUsersFilterOrg || adminUsersFilterRole || adminUsersFilterStatus !== 'active' ? (
                <Button
                  size="small"
                  onClick={() => {
                    setSearchDraft('');
                    setAdminUsersFilterOrg(undefined);
                    setAdminUsersFilterRole(undefined);
                    setAdminUsersFilterStatus('active');
                    setPage(1);
                  }}
                >
                  Clear filters
                </Button>
              ) : null
            }
          >
            <div className="user-management-filter-grid">
              <label className="user-management-filter-field">
                <span>Search</span>
                <Input
                  aria-label="Search users"
                  placeholder="Email address"
                  allowClear
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                />
              </label>
              <label className="user-management-filter-field">
                <span>Organization ID</span>
                <InputNumber
                  aria-label="Filter by organization ID"
                  placeholder="Any organization"
                  controls={false}
                  value={adminUsersFilterOrg} className="console-width-full"
                  onChange={(value) => {
                    setAdminUsersFilterOrg(value ? Number(value) : undefined);
                    setPage(1);
                  }}
                />
              </label>
              <label className="user-management-filter-field">
                <span>Role</span>
                <Select
                  aria-label="Filter users by role"
                  placeholder="All roles"
                  allowClear
                  value={adminUsersFilterRole}
                  onChange={(value) => {
                    setAdminUsersFilterRole(value);
                    setPage(1);
                  }}
                  options={[
                    { label: 'Admin', value: 'ADMIN' },
                    { label: 'Organization admin', value: 'ORG_ADMIN' },
                    { label: 'Organization user', value: 'ORG_USER' },
                  ]}
                />
              </label>
              <label className="user-management-filter-field">
                <span>Status</span>
                <Select
                  aria-label="Filter users by status"
                  value={adminUsersFilterStatus}
                  onChange={(value) => {
                    setAdminUsersFilterStatus(value);
                    setPage(1);
                  }}
                  options={[
                    { label: 'Active', value: 'active' },
                    { label: 'Disabled', value: 'disabled' },
                    { label: 'All', value: 'all' },
                  ]}
                  className="ui-extracted-09c64cc592"
                />
              </label>
              <Button
                aria-label="Refresh users"
                icon={<GatewayIcon name="ReloadOutlined" />}
                onClick={() => refetchAdminUsers()}
                loading={isLoading}
              >
                Refresh
              </Button>
            </div>
          </FilterBar>

          {error && (
            <Notice
              type="error"
              message="Could not load users"
              description={error instanceof Error ? error.message : 'An unexpected error occurred.'}
              action={
                <Button size="small" onClick={() => refetchAdminUsers()}>
                  Retry
                </Button>
              }
            />
          )}

          <section className="user-management-table-section" aria-label="User directory">
            <div className="user-management-table-heading">
              <span>Users</span>
              <span>{adminUsersTotal.toLocaleString()} total</span>
            </div>
            <ModernTable
              dataSource={adminUsers}
              rowKey={(row) => row.id}
              size="small"
              loading={isLoading}
              pagination={{
                current: page,
                pageSize,
                total: adminUsersTotal,
                showSizeChanger: true,
                onChange: (nextPage, nextPageSize) => {
                  setPage(nextPage);
                  setPageSize(nextPageSize);
                },
              }}
              columns={adminUserColumns}
              emptyState={{
                title: 'No users found',
                description: 'Adjust the filters or create a user for this organization.',
              }}
            />
          </section>

          <Modal
            title={adminEditUser ? 'Edit User' : 'Create User'}
            open={adminUserModalOpen}
            onCancel={() => setAdminUserModalOpen(false)}
            onOk={() => adminUserForm.submit()}
            okText={adminEditUser ? 'Save' : 'Create'}
          >
            <Form
              form={adminUserForm}
              layout="vertical"
              onValuesChange={(changedValues) => {
                if (changedValues.role === 'ADMIN') {
                  adminUserForm.setFieldsValue({ orgId: null });
                }
              }}
              onFinish={async (values) => {
                try {
                  if (adminEditUser) {
                    await updateAdminUser(adminEditUser.id, {
                      email: values.email,
                      role: values.role,
                      orgId: values.orgId,
                      isActive: values.isActive,
                    });
                    messageApi.success('User updated');
                  } else {
                    await createAdminUser({
                      email: values.email,
                      password: values.password,
                      role: values.role,
                      orgId: values.orgId,
                    });
                    messageApi.success('User created');
                  }
                  setAdminUserModalOpen(false);
                  await refetchAdminUsers();
                } catch (error: any) {
                  messageApi.error(error?.message || 'Failed to save user');
                }
              }}
            >
              <Form.Item name="email" label="Email" rules={[{ required: true }]}>
                <Input placeholder="user@example.com" />
              </Form.Item>
              {!adminEditUser && (
                <Form.Item name="password" label="Password" rules={[{ required: true }]}>
                  <Input.Password />
                </Form.Item>
              )}
              <Form.Item name="role" label="Role" rules={[{ required: true }]}>
                <Select options={[{ value: 'ADMIN' }, { value: 'ORG_ADMIN' }, { value: 'ORG_USER' }]} />
              </Form.Item>
              <Form.Item
                name="orgId"
                label="Org ID"
                dependencies={['role']}
                rules={[
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      const role = getFieldValue('role');
                      if (role === 'ADMIN') {
                        return Promise.resolve();
                      }
                      if (value === null || value === undefined || value === '') {
                        return Promise.reject(new Error('Org ID is required for non-admin users'));
                      }
                      return Promise.resolve();
                    },
                  }),
                ]}
              >
                <InputNumber className="console-width-full" />
              </Form.Item>
              <Form.Item name="isActive" label="Active" valuePropName="checked" initialValue={true}>
                <Switch />
              </Form.Item>
            </Form>
          </Modal>

          <Modal
            title="Reset Password"
            open={!!adminResetPasswordUser}
            onCancel={() => setAdminResetPasswordUser(null)}
            onOk={() => adminResetForm.submit()}
            okText="Reset"
          >
            <Form
              form={adminResetForm}
              layout="vertical"
              onFinish={async (values) => {
                try {
                  if (!adminResetPasswordUser) return;
                  await resetAdminUserPassword(adminResetPasswordUser.id, values.password);
                  messageApi.success('Password reset');
                  setAdminResetPasswordUser(null);
                } catch (error: any) {
                  messageApi.error(error?.message || 'Failed to reset password');
                }
              }}
            >
              <Form.Item name="password" label="New Password" rules={[{ required: true }]}>
                <Input.Password />
              </Form.Item>
            </Form>
          </Modal>
        </div>
      )}
    </PageTemplate>
  );
};
