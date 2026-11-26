import { useState, useCallback } from 'react';
import { Input, Select } from '@/components/common/LegacyAntdControls';
import { Icon as GatewayIcon } from './common/Icon';
import { Button as AstryxButton } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Section } from '@astryxdesign/core/Section';
import { Text } from '@astryxdesign/core/Text';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../app/auth-context';
import { useTenant } from '../app/tenant-context';
import { StatePanel } from './common/StatePanel';
import { useQuery } from '@tanstack/react-query';
import { listAdminOrgSummaries } from '../services/api';

export const OrgContextGuard = ({
  children,
  requireOrgSelectionOnAdminRoute = false,
}: {
  children: React.ReactNode;
  requireOrgSelectionOnAdminRoute?: boolean;
}) => {
  const { orgId, setManualOrgId } = useTenant();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState('');

  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const isAdminRoute = location.pathname.startsWith('/admin');
  const isPortalLaunchRoute = location.pathname.startsWith('/portal/launch');

  const {
    data: adminOrgs = [],
    isLoading: isLoadingOrgs,
    isError: isAdminOrgsError,
    refetch: refetchAdminOrgs,
  } = useQuery({
    queryKey: ['adminOrgsSummary'],
    queryFn: listAdminOrgSummaries,
    enabled: isAdmin && !isPortalLaunchRoute,
    staleTime: 30 * 1000,
  });

  const handleSetOrgId = useCallback(() => {
    const orgIdValue = Number(inputValue);
    if (!Number.isSafeInteger(orgIdValue) || orgIdValue <= 0) {
      setInputError('Enter a positive whole-number organization ID.');
      return;
    }

    setInputError('');
    try {
      setManualOrgId(orgIdValue);
    } catch {
      setInputError('Could not set the organization context. Try again.');
    }
  }, [inputValue, setManualOrgId]);

  const handleReload = useCallback(() => window.location.reload(), []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && inputValue.trim()) void handleSetOrgId();
    },
    [inputValue, handleSetOrgId]
  );

  if (orgId > 0 || isPortalLaunchRoute || (isAdminRoute && isAdmin && !requireOrgSelectionOnAdminRoute)) {
    return <>{children}</>;
  }

  if (isAdmin) {
    return (
      <main className="org-context-screen">
        <section className="org-context-content" aria-labelledby="org-select-title">
          <Section variant="section" padding={4}>
            <div className="org-context-heading">
              <span aria-hidden="true" className="org-context-heading-icon">
                <GatewayIcon name="ApartmentOutlined" />
              </span>
              <div>
                <Heading id="org-select-title" level={4} className="console-margin-0 console-type-title">
                  Select an organization
                </Heading>
                <Text as="div" type="supporting" className="console-type-body console-margin-top-1">
                  This view needs an organization context. Your admin access is unchanged.
                </Text>
              </div>
            </div>

            {isLoadingOrgs ? (
              <StatePanel glyph="connecting" tone="busy" size="compact" title="Loading organizations" />
            ) : isAdminOrgsError ? (
              <StatePanel
                glyph="disrupted"
                tone="critical"
                size="compact"
                title="Could not load organizations"
                actions={<AstryxButton label="Retry" variant="secondary" onClick={() => void refetchAdminOrgs()} />}
              />
            ) : adminOrgs.length === 0 ? (
              <StatePanel
                glyph="searching"
                size="compact"
                title="No organizations available"
                description="Check your admin access or use the organization directory."
              />
            ) : (
              <Select
                aria-label="Choose an organization"
                placeholder="Search organizations"
                className="console-width-full"
                options={adminOrgs.map((org) => ({
                  label: org.name ? `${org.name} · ${org.orgId}` : `Organization ${org.orgId}`,
                  value: org.orgId,
                }))}
                onChange={(value) => setManualOrgId(Number(value))}
                showSearch
                optionFilterProp="label"
              />
            )}

            <div className="org-context-footer">
              <AstryxButton
                label="Open organization directory"
                variant="secondary"
                icon={<GatewayIcon name="ApartmentOutlined" aria-hidden="true" />}
                onClick={() => navigate('/admin/orgs')}
              />
            </div>
          </Section>
        </section>
      </main>
    );
  }

  return (
    <main className="org-context-screen">
      <section className="org-context-content" aria-labelledby="org-context-title">
        <Section variant="section" padding={4}>
          <Heading id="org-context-title" level={4} className="console-margin-0 console-type-title">
            Organization context required
          </Heading>
          <Text as="div" type="supporting" className="console-type-body console-margin-top-1">
            Open this console from the host application with an organization ID, or enter one for this session.
          </Text>

          <div className="org-context-required-param">
            <Text as="div" type="supporting" className="console-type-caption console-margin-bottom-1">
              Required URL parameter
            </Text>
            <code className="console-text-primary">?orgId=&lt;number&gt;</code>
          </div>

          <div className="console-margin-top-4">
            <label
              htmlFor="org-context-id"
              className="console-type-body console-text-secondary console-margin-bottom-1 console-display-block"
            >
              Organization ID
            </label>
            <div className="org-context-input-row">
              <Input
                id="org-context-id"
                aria-label="Organization ID"
                aria-invalid={!!inputError}
                aria-describedby={inputError ? 'org-id-error' : undefined}
                placeholder="Enter a positive whole number"
                value={inputValue}
                onChange={(event) => {
                  setInputValue(event.target.value);
                  setInputError('');
                }}
                onKeyDown={handleKeyDown}
                status={inputError ? 'error' : undefined}
                inputMode="numeric"
                className="org-context-input"
              />
              <AstryxButton
                label="Continue"
                variant="primary"
                isDisabled={!inputValue.trim()}
                onClick={handleSetOrgId}
              />
            </div>
            {inputError && (
              <Text
                id="org-id-error"
                as="div"
                role="alert"
                className="console-text-error console-type-caption console-margin-top-1"
              >
                {inputError}
              </Text>
            )}
          </div>

          <div className="org-context-footer">
            <Text as="div" type="supporting" className="console-type-caption console-margin-bottom-2">
              If you arrived from the host application, reload it to restore the organization context.
            </Text>
            <AstryxButton
              label="Reload page"
              variant="secondary"
              icon={<GatewayIcon name="ReloadOutlined" aria-hidden="true" />}
              onClick={handleReload}
            />
          </div>
        </Section>
      </section>
    </main>
  );
};
