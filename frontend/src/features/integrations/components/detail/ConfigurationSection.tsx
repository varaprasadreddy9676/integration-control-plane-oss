import { Row, Col, Form, Input, Select, AutoComplete, Space, Divider, Collapse } from "@/components/common/LegacyAntdControls";
import { Text } from '@astryxdesign/core/Text';
import { StatusBadge } from '../../../../components/common/StatusBadge';
import { Icon as GatewayIcon } from '../../../../components/common/Icon';
import type { FormInstance } from "@/components/common/LegacyAntdControls";
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { cssVar, withAlpha } from '../../../../design-system/utils';
import { HelpPopover, UrlRequirementsHelp, DataSecurityHelp } from './shared';
import { listProviders } from '../../../../services/api';
import { buildUrlWithOrgId } from '../../../../utils/navigation';

interface ConfigurationSectionProps {
  form: FormInstance;
  eventTypes: any[];
  uiConfig?: any;
  tenant?: any;
  isMultiAction: boolean;
  eventTypesLoading: boolean;
  scopeValue?: string;
  excludedOrgUnits?: number[];
  spacing: any;
  token: any;
  colors: any;
}

const spacingToNumber = (value: any): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value, 10) || 0;
  return 0;
};

/**
 * ConfigurationSection - Basic integration configuration fields
 *
 * Compact enterprise design with help popovers for progressive disclosure.
 * Removes verbose alerts in favor of inline help icons.
 */
export const ConfigurationSection = ({
  form,
  eventTypes,
  uiConfig,
  tenant,
  isMultiAction,
  eventTypesLoading,
  scopeValue,
  excludedOrgUnits,
  spacing,
  token,
  colors,
}: ConfigurationSectionProps) => {
  // Add wildcard option at the beginning and extract eventType property
  const eventOptions = ['*', ...(eventTypes?.map((et: any) => et.eventType) || [])];

  // Fetch the managed providers list from the API
  const { data: providerList = [] } = useQuery({
    queryKey: ['providers'],
    queryFn: () => listProviders(true), // activeOnly
    staleTime: 60_000,
  });
  const providerOptions = providerList.map((p) => ({ value: p.name, label: p.name }));

  return (
    <div>
      <Row gutter={[spacingToNumber(spacing[4]), 0]}>
        <Col xs={24} lg={12}>
          <Form.Item name="name" label="Event Rule Name" rules={[{ required: true, message: 'Name is required' }]}>
            <Input placeholder="e.g., New order to CRM" size="middle" />
          </Form.Item>
        </Col>
        <Col xs={24} lg={12}>
          <Form.Item
            name="eventType"
            label="Event Type"
            rules={[{ required: true, message: 'Event type is required' }]}
            extra={
              !eventTypesLoading && !eventTypes?.length ? (
                <>
                  No event types yet.{' '}
                  <Link to={buildUrlWithOrgId('/events/catalog')}>Add one in the Event Catalog</Link>, or pick * to
                  match every event.
                </>
              ) : undefined
            }
          >
            <Select
              options={eventOptions.map((value) => ({
                label: value === '*' ? '* (All Events)' : value,
                value,
              }))}
              placeholder="Select event to trigger this event rule"
              loading={eventTypesLoading}
              showSearch
              size="middle"
            />
          </Form.Item>
        </Col>
        {isMultiAction ? (
          <Col xs={24}>
            <Space size="small" style={{ color: colors.info[600], marginBottom: spacing[3] }}>
              <Text type="supporting" size="base" color="secondary">
                Target URLs are configured in each action below. Expand the <strong>"Actions"</strong> section to edit.
              </Text>
            </Space>
          </Col>
        ) : (
          <Col xs={24}>
            <Form.Item
              name="targetUrl"
              validateTrigger="onBlur"
              label={
                <Space size={4}>
                  Target URL
                  <HelpPopover title="URL Requirements" content={<UrlRequirementsHelp />} />
                </Space>
              }
              rules={[
                { required: !isMultiAction, message: 'Target URL is required' },
                { pattern: /^https?:\/\/.+/i, message: 'Must be a valid HTTP or HTTPS URL' },
              ]}
            >
              <Input placeholder="https://api.example.com/integrations/receive" size="middle" />
            </Form.Item>
          </Col>
        )}
        <Col xs={24} sm={8}>
          <Form.Item name="httpMethod" label="HTTP Method" rules={[{ required: true }]}>
            <Select options={uiConfig?.httpMethods || []} size="middle" />
          </Form.Item>
        </Col>
        <Col xs={24} sm={8}>
          <Form.Item
            name="scope"
            label={
              <Space size={4}>
                Entity Scope
                {scopeValue === 'INCLUDE_CHILDREN' &&
                  tenant &&
                  tenant.childEntities &&
                  tenant.childEntities.length > 0 && (
                    <HelpPopover
                      title="Multi-Entity Compliance"
                      content={<DataSecurityHelp entityCount={tenant.childEntities.length + 1} />}
                    />
                  )}
              </Space>
            }
            rules={[{ required: true }]}
          >
            <Select options={uiConfig?.scopeTypes || []} size="middle" />
          </Form.Item>
          <Text type="supporting" size="sm" color="secondary">
            Entity only applies to this entity. Include children applies to all child entities of the parent.
          </Text>
        </Col>
        <Col xs={24} sm={8}>
          <Form.Item
            name="provider"
            label="Provider"
            tooltip="Tag this integration with a provider name (e.g. QikChat WhatsApp, ClevrTap). Used to filter integrations in the list."
          >
            <AutoComplete
              options={providerOptions}
              placeholder="e.g. QikChat WhatsApp"
              filterOption={(input, option) => (option?.value as string)?.toLowerCase().includes(input.toLowerCase())}
              size="middle"
              allowClear
            />
          </Form.Item>
        </Col>
      </Row>

      {/* Child Entities Display - Only show when scope is INCLUDE_CHILDREN */}
      {scopeValue === 'INCLUDE_CHILDREN' && tenant && tenant.childEntities && tenant.childEntities.length > 0 && (
        <Row gutter={[spacingToNumber(spacing[4]), spacingToNumber(spacing[4])]} className="console-margin-top-4">
          <Col xs={24}>
            <Divider style={{ margin: `${spacing[3]} 0` }} />

            {/* Compact Summary Status */}
            {(excludedOrgUnits?.length || 0) === tenant.childEntities.length ? (
              <Space size="small" className="console-margin-bottom-4">
                <GatewayIcon name="WarningFilled" className="console-text-error" />
                <Text weight="semibold" style={{ color: colors.error[700] }}>
                  All child entities excluded - integration will only process parent events
                </Text>
              </Space>
            ) : (
              <Space size="small" className="console-margin-bottom-4">
                <GatewayIcon name="CheckCircleFilled" className="console-text-success" />
                <Text weight="semibold" style={{ color: colors.success[700] }}>
                  Processing events from {tenant.childEntities.length + 1 - (excludedOrgUnits?.length || 0)} entities
                </Text>
                {excludedOrgUnits && excludedOrgUnits.length > 0 && (
                  <Text type="supporting" size="base" color="secondary">
                    ({excludedOrgUnits.length} excluded)
                  </Text>
                )}
              </Space>
            )}

            {/* Exclusion Field */}
            <Form.Item
              name="excludedOrgUnits"
              label={
                <Space>
                  <span>Excluded Child Entities (Optional)</span>
                  <Text type="supporting" color="secondary">{tenant.childEntities.length} available</Text>
                </Space>
              }
              tooltip="Exclude specific child entities"
            >
              <Select
                mode="multiple"
                placeholder="All child entities included by default - select to exclude"
                size="middle"
                allowClear
                showSearch
                filterOption={(input, option) =>
                  String(option?.label ?? '')
                    .toLowerCase()
                    .includes(input.toLowerCase())
                }
                options={tenant.childEntities.map((child: any) => ({
                  label: `${child.name} (RID: ${child.rid})`,
                  value: child.rid,
                }))}
                maxTagCount="responsive"
              />
            </Form.Item>

            {/* Visual Display of All Entities */}
            <Collapse
              style={{
                background: cssVar.bg.surface,
                border: `1px solid ${cssVar.border.default}`,
                borderRadius: token.borderRadius,
              }}
              items={[
                {
                  key: 'entities',
                  label: (
                    <Space>
                      <Text size="base" weight="semibold">
                        View all entities ({tenant.childEntities.length + 1})
                      </Text>
                      <Text type="supporting" size="sm" color="secondary">
                        Click to see which entities will receive this integration
                      </Text>
                    </Space>
                  ),
                  children: (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[2] }}>
                      {/* Parent Entity */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: spacing[3],
                          background: cssVar.bg.elevated,
                          border: `1px solid ${cssVar.border.default}`,
                          borderRadius: token.borderRadius,
                        }}
                      >
                        <Space>
                          <Text size="base" weight="semibold">
                            {tenant.tenantName}
                          </Text>
                          <Text type="supporting" color="secondary">Parent</Text>
                          <Text type="code">RID: {tenant.orgId}</Text>
                        </Space>
                        <StatusBadge status="SUCCESS" label="Included" />
                      </div>

                      {/* Child Entities */}
                      <Divider className="console-margin-y-2">
                        <Text type="supporting" size="sm" color="secondary">
                          Child Entities ({tenant.childEntities.length})
                        </Text>
                      </Divider>

                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                          gap: spacing[2],
                          maxHeight: '400px',
                          overflowY: 'auto',
                          padding: spacing[1],
                        }}
                      >
                        {tenant.childEntities.map((child: any) => {
                          const isExcluded = excludedOrgUnits?.includes(child.rid);
                          return (
                            <div
                              key={child.rid}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: spacing[2],
                                background: isExcluded ? cssVar.bg.subtle : withAlpha(cssVar.success.bg, 0.35),
                                border: `1px solid ${isExcluded ? cssVar.border.default : cssVar.success.border}`,
                                borderRadius: token.borderRadius,
                                opacity: isExcluded ? 0.75 : 1,
                              }}
                            >
                              <Space direction="vertical" size={0}>
                                <Text
                                  weight={isExcluded ? 'normal' : 'semibold'}
                                  style={{
                                    color: isExcluded ? cssVar.text.muted : cssVar.text.primary,
                                  }}
                                >
                                  {child.name}
                                </Text>
                                <Text type="code" color="secondary">
                                  RID: {child.rid} • {child.code}
                                </Text>
                              </Space>
                              <StatusBadge
                                status={isExcluded ? 'SKIPPED' : 'SUCCESS'}
                                label={isExcluded ? 'Excluded' : 'Included'}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ),
                },
              ]}
            />
          </Col>
        </Row>
      )}
    </div>
  );
};
