import { useEffect, useMemo, useState } from 'react';
import { Drawer, Space, message, Grid, Divider } from '@/components/common/LegacyAntdControls';
import { Text as AstryxText } from '@astryxdesign/core/Text';
import { Heading } from '@astryxdesign/core/Heading';
import { Tab, TabList } from '@astryxdesign/core';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { EventType, FieldSchema } from '../../../services/api';
import { useDesignTokens, spacingToNumber } from '../../../design-system/utils';
import { ModernTable } from '../../../components/common/ModernTable';
import { StatePanel } from '../../../components/common/StatePanel';
import { copyTextToClipboard } from '../../../utils/clipboard';
import { Button } from '../../../components/common/LegacyButton';

interface EventDetailDrawerProps {
  event: EventType | null;
  open: boolean;
  onClose: () => void;
  onCreateIntegration: (eventType: string) => void;
}

export const EventDetailDrawer = ({ event, open, onClose, onCreateIntegration }: EventDetailDrawerProps) => {
  const [activeTab, setActiveTab] = useState<'schema' | 'sample' | 'usage'>('schema');
  useEffect(() => setActiveTab('schema'), [event?.eventType, open]);
  const { spacing } = useDesignTokens();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const handleCopySample = async () => {
    if (event?.samplePayload) {
      const copied = await copyTextToClipboard(JSON.stringify(event.samplePayload, null, 2));
      if (copied) {
        message.success('Sample payload copied to clipboard');
      } else {
        message.error('Failed to copy to clipboard');
      }
    }
  };

  const handleCopyEventType = async () => {
    if (event?.eventType) {
      const copied = await copyTextToClipboard(event.eventType);
      if (copied) {
        message.success('Event type copied to clipboard');
      } else {
        message.error('Failed to copy to clipboard');
      }
    }
  };

  const handleCreateIntegration = () => {
    if (event?.eventType) {
      onCreateIntegration(event.eventType);
      onClose();
    }
  };

  const schemaRows = useMemo(() => {
    const buildRows = (fields: FieldSchema[], depth = 0): any[] =>
      fields.flatMap((field) => {
        const base = { ...field, depth, key: field.path || `${field.name}-${depth}` };
        const nestedItems = field.itemSchema ? buildRows(field.itemSchema, depth + 1) : [];
        const nestedProps = field.properties ? buildRows(field.properties, depth + 1) : [];
        return [base, ...nestedItems, ...nestedProps];
      });

    return event?.fields ? buildRows(event.fields) : [];
  }, [event?.fields]);

  if (!open) return null;
  if (!event) {
    return (
      <Drawer
        title={
          <div className="console-flex-center-gap-2">
            <GatewayIcon name="FileTextOutlined" className="console-text-accent" />
            <span>Loading event...</span>
          </div>
        }
        placement="right"
        width={isMobile ? '100%' : 720}
        open={open}
        onClose={onClose}
        extra={
          <Space>
            <Button type="primary" icon={<GatewayIcon name="ThunderboltOutlined" />} disabled>
              Create Integration
            </Button>
          </Space>
        }
      >
        <StatePanel title="Loading event" size="compact" />
      </Drawer>
    );
  }

  return (
    <Drawer
      title={
        <div className="console-flex-center-gap-2">
          <GatewayIcon name="FileTextOutlined" className="console-text-accent" />
          <span>{event?.label || 'Loading event...'}</span>
        </div>
      }
      placement="right"
      width={isMobile ? '100%' : 720}
      open={open}
      onClose={onClose}
      extra={
        <Space>
          <Button type="primary" icon={<GatewayIcon name="ThunderboltOutlined" />} onClick={handleCreateIntegration}>
            Create Integration
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={spacingToNumber(spacing[5])} className="console-width-full">
        {/* Event Info */}
        <div>
          <Space direction="vertical" size={spacingToNumber(spacing[3])} className="console-width-full">
            <div>
              <AstryxText type="supporting" color="secondary" className="console-block-margin-bottom-1" size="sm">
                Event Type
              </AstryxText>
              <div className="console-flex-center-gap-2">
                <AstryxText type="code" size="base">
                  {event.eventType}
                </AstryxText>
                <Button
                  type="text"
                  size="small"
                  icon={<GatewayIcon name="CopyOutlined" />}
                  onClick={handleCopyEventType}
                  aria-label="Copy event type"
                />
              </div>
            </div>

            <div>
              <AstryxText type="supporting" color="secondary" className="console-block-margin-bottom-1" size="sm">
                Category
              </AstryxText>
              <AstryxText>{event.category}</AstryxText>
            </div>

            <div>
              <AstryxText type="supporting" color="secondary" className="console-block-margin-bottom-1" size="sm">
                Description
              </AstryxText>
              <AstryxText as="p" display="block" className="console-margin-none" size="base">
                {event.description}
              </AstryxText>
            </div>

            <div>
              <AstryxText type="supporting" color="secondary" className="console-block-margin-bottom-1" size="sm">
                Implementation
              </AstryxText>
              <AstryxText type="code" className="event-detail-implementation-code" size="sm">
                {event.implementationClass}
              </AstryxText>
            </div>
          </Space>
        </div>

        <Divider className="console-margin-none" />

        <TabList
          role="tablist"
          aria-label="Event detail sections"
          value={activeTab}
          onChange={(value) => setActiveTab(value as typeof activeTab)}
          hasDivider
        >
          <Tab
            id="event-detail-schema-tab"
            value="schema"
            label={`Field Schema (${event.fields?.length || 0})`}
            icon={<GatewayIcon name="DatabaseOutlined" aria-hidden="true" />}
            panelId="event-detail-schema-panel"
          />
          <Tab
            id="event-detail-sample-tab"
            value="sample"
            label="Sample Payload"
            icon={<GatewayIcon name="CodeOutlined" aria-hidden="true" />}
            panelId="event-detail-sample-panel"
          />
          <Tab
            id="event-detail-usage-tab"
            value="usage"
            label="Usage Guide"
            icon={<GatewayIcon name="InfoCircleOutlined" aria-hidden="true" />}
            panelId="event-detail-usage-panel"
          />
        </TabList>
        <div
          id="event-detail-schema-panel"
          role="tabpanel"
          aria-labelledby="event-detail-schema-tab"
          hidden={activeTab !== 'schema'}
          tabIndex={0}
        >
          <div className="event-detail-schema-scroll">
            {event.fields && event.fields.length > 0 ? (
              <ModernTable
                dataSource={schemaRows}
                pagination={false}
                size="small"
                className="console-margin-top-2"
                columns={[
                  {
                    title: 'Field',
                    dataIndex: 'name',
                    key: 'name',
                    render: (text: string, record: any) => (
                      <div style={{ paddingLeft: record.depth * 16 }}>
                        <div className="event-detail-field-name">
                          <AstryxText type="code" size="sm">
                            {text}
                          </AstryxText>
                          {record.required && (
                            <AstryxText type="supporting" color="secondary">
                              Required
                            </AstryxText>
                          )}
                        </div>
                        <AstryxText type="supporting" color="secondary" size="sm">
                          {record.path}
                        </AstryxText>
                      </div>
                    ),
                  },
                  {
                    title: 'Type',
                    dataIndex: 'type',
                    key: 'type',
                    render: (type: string, record: any) => (
                      <Space size={spacingToNumber(spacing[1])}>
                        <AstryxText type="code">{type}</AstryxText>
                        {record.itemType && (
                          <AstryxText type="supporting" color="secondary">
                            items: {record.itemType}
                          </AstryxText>
                        )}
                      </Space>
                    ),
                    width: 220,
                  },
                  {
                    title: 'Description',
                    dataIndex: 'description',
                    key: 'description',
                    render: (desc: string) =>
                      desc ? (
                        <AstryxText size="base">{desc}</AstryxText>
                      ) : (
                        <AstryxText type="supporting" color="secondary" size="sm">
                          —
                        </AstryxText>
                      ),
                  },
                ]}
              />
            ) : (
              <AstryxText type="supporting" color="secondary">
                No field schema available
              </AstryxText>
            )}
          </div>
        </div>
        <div
          id="event-detail-sample-panel"
          role="tabpanel"
          aria-labelledby="event-detail-sample-tab"
          hidden={activeTab !== 'sample'}
          tabIndex={0}
        >
          {event.samplePayload ? (
            <div>
              <div className="event-detail-copy-action">
                <Button
                  size="small"
                  icon={<GatewayIcon name="CopyOutlined" />}
                  onClick={handleCopySample}
                  aria-label="Copy sample payload"
                >
                  Copy Sample
                </Button>
              </div>
              <pre
                tabIndex={0}
                aria-label="Sample payload"
                className="clamped-code-block console-type-caption event-detail-sample-code"
              >
                {JSON.stringify(event.samplePayload, null, 2)}
              </pre>
            </div>
          ) : (
            <AstryxText type="supporting" color="secondary">
              No sample payload available
            </AstryxText>
          )}
        </div>
        <div
          id="event-detail-usage-panel"
          role="tabpanel"
          aria-labelledby="event-detail-usage-tab"
          hidden={activeTab !== 'usage'}
          tabIndex={0}
        >
          <div>
            <Space direction="vertical" size={spacingToNumber(spacing[4])} className="console-width-full">
              <div>
                <Heading level={5}>When This Event Triggers</Heading>
                <AstryxText as="p" display="block" type="supporting" color="secondary">
                  {event.description}
                </AstryxText>
              </div>
              <div>
                <Heading level={5}>Common Use Cases</Heading>
                <ul className="event-detail-usage-list">
                  <li className="console-margin-bottom-2">
                    <AstryxText>Send real-time notifications to external systems</AstryxText>
                  </li>
                  <li className="console-margin-bottom-2">
                    <AstryxText>Sync data to CRM or ERP platforms</AstryxText>
                  </li>
                  <li className="console-margin-bottom-2">
                    <AstryxText>Trigger automated workflows</AstryxText>
                  </li>
                  <li className="console-margin-bottom-2">
                    <AstryxText>Update data warehouses or analytics platforms</AstryxText>
                  </li>
                </ul>
              </div>
              <div>
                <Heading level={5}>Creating a Integration</Heading>
                <AstryxText as="p" display="block" type="supporting" color="secondary">
                  Click the "Create Integration" button to configure a integration for this event type. You'll be able
                  to:
                </AstryxText>
                <ul className="event-detail-usage-list">
                  <li className="console-margin-bottom-2">
                    <AstryxText>Set the target URL to receive events</AstryxText>
                  </li>
                  <li className="console-margin-bottom-2">
                    <AstryxText>Configure authentication (API Key, OAuth, Basic)</AstryxText>
                  </li>
                  <li className="console-margin-bottom-2">
                    <AstryxText>Transform the payload with a script</AstryxText>
                  </li>
                  <li className="console-margin-bottom-2">
                    <AstryxText>Set scope (include children entities or exclude specific entities)</AstryxText>
                  </li>
                </ul>
              </div>
              <div className="event-detail-pro-tip">
                <Space direction="vertical" size={spacingToNumber(spacing[2])}>
                  <AstryxText weight="semibold" className="console-text-info">
                    💡 Pro Tip
                  </AstryxText>
                  <AstryxText type="supporting" color="secondary">
                    Use the Field Schema tab to understand available fields, then use the Sample Payload tab to see the
                    actual data structure. This helps you write accurate transformations.
                  </AstryxText>
                </Space>
              </div>
            </Space>
          </div>
        </div>
      </Space>
    </Drawer>
  );
};
