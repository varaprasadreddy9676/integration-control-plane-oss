import { useState, useCallback } from 'react';
import { Card, Alert, Input, Button, Space, Typography, Select, Spin } from 'antd';
import { InfoCircleOutlined, ReloadOutlined, ApartmentOutlined, LoadingOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../app/auth-context';
import { useTenant } from '../app/tenant-context';
import { useDesignTokens } from '../design-system/utils';
import { useQuery } from '@tanstack/react-query';
import { listAdminOrgSummaries } from '../services/api';

const { Title, Text, Paragraph } = Typography;

/**
 * Guard component that displays a friendly UI when orgId is missing.
 * Allows manual input for development/recovery scenarios.
 *
 * SUPER_ADMIN can access admin routes without orgId, but needs to select an org for org-specific routes.
 *
 * Accessibility:
 * - Proper heading hierarchy
 * - Keyboard-accessible inputs and buttons
 * - Clear error messages with recovery actions
 * - Focus management for modal-like experience
 * - ARIA labels for screen readers
 *
 * UX Improvements:
 * - Loading states during data fetching
 * - Clear visual hierarchy with icon indicators
 * - Action-oriented layout with primary actions emphasized
 * - Helpful context for different user roles
 */
export const OrgContextGuard = ({
  children,
  requireOrgSelectionOnAdminRoute = false,
}: {
  children: React.ReactNode;
  requireOrgSelectionOnAdminRoute?: boolean;
}) => {
  const { shadows, spacing } = useDesignTokens();
  const { orgId, setManualOrgId } = useTenant();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const isAdmin = user?.role === 'ADMIN';
  const isAdminRoute = location.pathname.startsWith('/admin');
  const isPortalLaunchRoute = location.pathname.startsWith('/portal/launch');

  // Fetch admin orgs for SUPER_ADMIN/ADMIN users
  const { data: adminOrgs = [], isLoading: isLoadingOrgs } = useQuery({
    queryKey: ['adminOrgsSummary'],
    queryFn: listAdminOrgSummaries,
    enabled: (isSuperAdmin || isAdmin) && !isPortalLaunchRoute,
    staleTime: 30 * 1000,
  });

  // Handle manual orgId input
  const handleSetOrgId = useCallback(async () => {
    const orgIdValue = Number(inputValue);
    if (!Number.isFinite(orgIdValue) || orgIdValue <= 0) {
      setInputError('Please enter a valid positive number');
      return;
    }

    setInputError('');
    setIsSubmitting(true);

    // Simulate async validation (could be extended to verify org exists)
    try {
      await new Promise(resolve => setTimeout(resolve, 100));
      setManualOrgId(orgIdValue);
    } catch {
      setInputError('Failed to set organization context');
    } finally {
      setIsSubmitting(false);
    }
  }, [inputValue, setManualOrgId]);

  // Handle page reload
  const handleReload = useCallback(() => {
    window.location.reload();
  }, []);

  // Handle keyboard submission
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      handleSetOrgId();
    }
  }, [inputValue, handleSetOrgId]);

  // If orgId exists, render children immediately
  if (orgId > 0) {
    return <>{children}</>;
  }

  // Portal launch route should bypass orgId check entirely
  if (isPortalLaunchRoute) {
    return <>{children}</>;
  }

  // If on admin route and user is SUPER_ADMIN/ADMIN, allow access without orgId
  if (isAdminRoute && (isSuperAdmin || isAdmin) && !requireOrgSelectionOnAdminRoute) {
    return <>{children}</>;
  }

  // SUPER_ADMIN/ADMIN view
  if (isSuperAdmin || isAdmin) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          padding: '24px'
        }}
        role="dialog"
        aria-labelledby="org-select-title"
        aria-modal="false"
      >
        <Card
          style={{
            maxWidth: 600,
            width: '100%',
            boxShadow: shadows['2xl']
          }}
        >
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            {/* Header */}
            <div style={{ textAlign: 'center' }}>
              <ApartmentOutlined style={{ fontSize: 64, color: '#667eea', marginBottom: 16 }} aria-hidden="true" />
              <Title id="org-select-title" level={3} style={{ marginBottom: 8 }}>
                Select Organization
              </Title>
              <Text type="secondary">
                This page requires an organization context
              </Text>
            </div>

            <Alert
              message="Admin Access"
              description="As a super admin, you can view any organization's data. Please select an organization to continue."
              type="info"
              showIcon
            />

            {/* Org Selector */}
            {isLoadingOrgs ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
                <Text type="secondary" style={{ display: 'block', marginTop: 16 }}>
                  Loading organizations...
                </Text>
              </div>
            ) : (
              <div>
                <Paragraph strong style={{ marginBottom: 8 }}>Select Organization:</Paragraph>
                <Select
                  size="large"
                  placeholder="Choose an organization"
                  style={{ width: '100%' }}
                  options={adminOrgs.map((org) => ({
                    label: org.name ? `${org.name} (Org ${org.orgId})` : `Org ${org.orgId}`,
                    value: org.orgId,
                  }))}
                  onChange={(value) => {
                    if (value) {
                      setManualOrgId(Number(value));
                    }
                  }}
                  showSearch
                  filterOption={(input, option) =>
                    (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                  loading={isLoadingOrgs}
                />
              </div>
            )}

            {/* Alternative Action */}
            <div>
              <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
                Or go to admin dashboard:
              </Text>
              <Button
                type="default"
                size="large"
                block
                onClick={() => navigate('/admin/orgs')}
              >
                Go to Admin Dashboard
              </Button>
            </div>
          </Space>
        </Card>
      </div>
    );
  }

  // Regular user view (development/recovery)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: '24px'
      }}
      role="dialog"
      aria-labelledby="org-context-title"
      aria-modal="false"
    >
      <Card
        style={{
          maxWidth: 600,
          width: '100%',
          boxShadow: shadows['2xl']
        }}
      >
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {/* Header */}
          <div style={{ textAlign: 'center' }}>
            <InfoCircleOutlined style={{ fontSize: 64, color: '#667eea', marginBottom: 16 }} aria-hidden="true" />
            <Title id="org-context-title" level={3} style={{ marginBottom: 8 }}>
              Missing Organization Context
            </Title>
            <Text type="secondary">
              This application requires an organization identifier to function
            </Text>
          </div>

          {/* Explanation */}
          <Alert
            message="Expected Usage"
            description={
              <Paragraph style={{ marginBottom: 0 }}>
                This application is designed to be embedded as an iframe within your source system.
                The parent application should pass the <code style={{ background: 'rgba(0,0,0,0.06)', padding: '2px 6px', borderRadius: '4px' }}>orgId</code> parameter:
                <br /><br />
                <code style={{ background: 'rgba(0,0,0,0.06)', padding: '4px 8px', borderRadius: '4px', display: 'inline-block' }}>
                  ?orgId=&lt;number&gt;
                </code>
              </Paragraph>
            }
            type="info"
            showIcon
          />

          {/* What Happened */}
          <div>
            <Paragraph strong>What happened?</Paragraph>
            <Paragraph type="secondary" style={{ fontSize: 14, marginBottom: 0 }}>
              The <code>orgId</code> parameter was not found in the URL, session storage, or local storage.
              This usually means:
            </Paragraph>
            <ul style={{ fontSize: 14, color: 'rgba(0,0,0,0.65)', paddingLeft: 20, marginBottom: 16 }}>
              <li>The iframe URL doesn't include the required parameter</li>
              <li>You're accessing the app directly instead of through client app</li>
              <li>Storage was cleared or is unavailable</li>
            </ul>
            <Alert
              type="info"
              message="Note: SUPER_ADMIN and ADMIN users have global access and don't need an orgId"
              showIcon
              style={{ fontSize: 13 }}
            />
          </div>

          {/* Recovery Options */}
          <div>
            <Paragraph strong>Recovery Options:</Paragraph>
            <Space direction="vertical" style={{ width: '100%' }} size="middle">

              {/* Option 1: Manual Input */}
              <div>
                <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
                  Option 1: Enter Org ID manually (for development/testing)
                </Text>
                <Space.Compact style={{ width: '100%' }}>
                  <Input
                    placeholder="Enter org ID (e.g., 33)"
                    value={inputValue}
                    onChange={(e) => {
                      setInputValue(e.target.value);
                      setInputError('');
                    }}
                    onKeyDown={handleKeyDown}
                    onPressEnter={handleSetOrgId}
                    status={inputError ? 'error' : ''}
                    type="number"
                    size="large"
                    aria-invalid={!!inputError}
                    aria-describedby={inputError ? 'org-id-error' : undefined}
                    disabled={isSubmitting}
                  />
                  <Button
                    type="primary"
                    size="large"
                    onClick={handleSetOrgId}
                    loading={isSubmitting}
                    disabled={!inputValue.trim()}
                  >
                    Continue
                  </Button>
                </Space.Compact>
                {inputError && (
                  <Text type="danger" style={{ fontSize: 12, display: 'block', marginTop: 4 }} id="org-id-error" role="alert">
                    {inputError}
                  </Text>
                )}
              </div>

              {/* Option 2: Reload */}
              <div>
                <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
                  Option 2: Reload the parent client application
                </Text>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={handleReload}
                  block
                  size="large"
                >
                  Reload Page
                </Button>
              </div>

            </Space>
          </div>

          {/* Help Footer */}
          <Alert
            message="Need Help?"
            description="Contact your system administrator if this issue persists. The client app integration may need to be reconfigured."
            type="warning"
            showIcon
          />
        </Space>
      </Card>
    </div>
  );
};
