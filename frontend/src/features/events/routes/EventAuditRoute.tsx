import { useEffect, useMemo, useState } from 'react';
import {
  App,
  Card,
  DatePicker,
  Input,
  Select,
  Space,
  Dropdown,
  Modal,
  Form,
  InputNumber,
  Switch,
} from '@/components/common/LegacyAntdControls';
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { Banner } from '@astryxdesign/core/Banner';
import { Button as AstryxButton } from '@astryxdesign/core/Button';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useSearchParams } from 'react-router-dom';
import { PageTemplate } from '../../../components/common/PageTemplate';
import { MetaTag } from '../../../components/common/MetaTag';
import { ModernTable } from '../../../components/common/ModernTable';
import { getStatusLabel, StatusBadge } from '../../../components/common/StatusBadge';
import { StatPillRow } from '../../../components/common/StatPillRow';
import {
  getEventAudit,
  getEventAuditById,
  getEventAuditStats,
  exportEventAuditToCsv,
  insertTestNotificationQueueEvents,
  getEventTypes,
} from '../../../services/api';
import type { EventAuditRecord } from '../../../mocks/types';
import { formatDateTimeWithSeconds, formatNumber } from '../../../utils/format';
import { createExportProgress } from '../../../utils/export-progress';
import { cssVar, useDesignTokens, spacingToNumber } from '../../../design-system/utils';
import { EventAuditDrawer } from '../components/EventAuditDrawer';
import { BulkImportModal } from '../components/BulkImportModal';
import { useTenant } from '../../../app/tenant-context';
import { Button } from '../../../components/common/LegacyButton';

const { RangePicker } = DatePicker;

const statusOptions = ['RECEIVED', 'PROCESSING', 'DELIVERED', 'SKIPPED', 'FAILED', 'STUCK'];
const skipCategoryOptions = [
  'DUPLICATE',
  'NO_WEBHOOK',
  'FILTER_MISMATCH',
  'CIRCUIT_BREAKER',
  'TRANSFORMATION_ERROR',
  'INVALID_PAYLOAD',
  'NO_ENTITY_CONTEXT',
  'PAYLOAD_TOO_LARGE',
  'SOURCE_FILTERED',
  'ACK_FAILURE',
  'WORKER_ERROR',
  'TEST_EVENT',
];
const sourceOptions = ['mysql', 'kafka', 'sqs', 'http'];

export const EventAuditRoute = () => {
  const location = useLocation();
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;
  const { message: msgApi } = App.useApp();
  const { orgId } = useTenant();

  const [statusFilter, setStatusFilter] = useState<string>();
  const [sourceFilter, setSourceFilter] = useState<string>();
  const [eventTypeFilter, setEventTypeFilter] = useState<string>();
  const [skipCategoryFilter, setSkipCategoryFilter] = useState<string>();
  const [dateRange, setDateRange] = useState<[string, string] | null>(null);
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedEvent, setSelectedEvent] = useState<EventAuditRecord | null>(null);
  // `?eventId=` deep-links straight into an event (e.g. from a delivery log's
  // "Source event" tab).
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkedEventId = searchParams.get('eventId');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(deepLinkedEventId);
  const [drawerOpen, setDrawerOpen] = useState(Boolean(deepLinkedEventId));
  const [exportLoading, setExportLoading] = useState(false);
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [testForm] = Form.useForm();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const hoursBack = useMemo(() => {
    if (!dateRange) return 24;
    const start = new Date(dateRange[0]).getTime();
    const end = new Date(dateRange[1]).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 24;
    const diffHours = Math.ceil((end - start) / (1000 * 60 * 60));
    return Math.max(1, diffHours);
  }, [dateRange]);

  const {
    data: stats,
    isFetching: statsFetching,
    error: statsError,
    refetch: refetchStats,
  } = useQuery({
    queryKey: ['event-audit-stats', statusFilter, sourceFilter, eventTypeFilter, skipCategoryFilter, dateRange, search],
    queryFn: () =>
      getEventAuditStats({
        hoursBack,
        status: statusFilter,
        source: sourceFilter,
        eventType: eventTypeFilter,
        skipCategory: skipCategoryFilter,
        startDate: dateRange?.[0],
        endDate: dateRange?.[1],
        search: search || undefined,
      }),
    staleTime: 30_000, // backend already caches for 30s — match it on the client
  });

  const {
    data: listResult,
    isFetching: eventsFetching,
    error: eventsError,
    refetch: refetchEvents,
  } = useQuery({
    queryKey: [
      'event-audit',
      statusFilter,
      sourceFilter,
      eventTypeFilter,
      skipCategoryFilter,
      dateRange,
      search,
      page,
      pageSize,
    ],
    queryFn: () =>
      getEventAudit({
        status: statusFilter,
        source: sourceFilter,
        eventType: eventTypeFilter,
        skipCategory: skipCategoryFilter,
        startDate: dateRange?.[0],
        endDate: dateRange?.[1],
        search: search || undefined,
        limit: pageSize,
        page,
      }),
    staleTime: 30_000,
    placeholderData: (prev: any) => prev, // keep previous rows visible while fetching new page
  });

  const events = listResult?.events || [];
  const total = listResult?.total || 0;

  const { data: allEventTypes = [] } = useQuery({
    queryKey: ['event-types'],
    queryFn: getEventTypes,
  });

  const { data: selectedEventDetail } = useQuery({
    queryKey: ['event-audit-detail', selectedEventId],
    queryFn: () => getEventAuditById(selectedEventId as string),
    enabled: Boolean(selectedEventId && drawerOpen),
  });

  const drawerEvent = selectedEventDetail || selectedEvent;

  const eventTypeOptions = useMemo(() => {
    const types = Object.keys(stats?.byEventType || {});
    return types.map((type) => ({ value: type, label: type }));
  }, [stats?.byEventType]);

  const handleExportCsv = async () => {
    setExportLoading(true);
    const { onProgress, finish } = createExportProgress(msgApi, 'Export CSV');
    try {
      await exportEventAuditToCsv(
        {
          status: statusFilter,
          eventType: eventTypeFilter,
          source: sourceFilter,
          skipCategory: skipCategoryFilter,
          search: search || undefined,
          startDate: dateRange?.[0],
          endDate: dateRange?.[1],
          timeoutMs: 120000,
        },
        { onProgress }
      );
      finish('Export complete');
    } catch (error) {
      finish(error instanceof Error ? error.message : 'Failed to export event audit', true);
    } finally {
      setExportLoading(false);
    }
  };

  const handleTestSubmit = async (values: any) => {
    setTestLoading(true);
    try {
      const payload = {
        orgId: Number(values.orgId),
        orgUnitRid: Number(values.orgUnitRid),
        phone: values.phone || undefined,
        mrn: values.mrn || undefined,
        datetime: values.datetime || undefined,
        createdAt: values.createdAt || undefined,
        limit: values.limit ? Number(values.limit) : undefined,
        eventTypes: values.eventTypes && values.eventTypes.length > 0 ? values.eventTypes : undefined,
        randomizeDates: Boolean(values.randomizeDates),
        randomDaysBack: values.randomDaysBack ? Number(values.randomDaysBack) : undefined,
        randomDaysForward: values.randomDaysForward ? Number(values.randomDaysForward) : undefined,
      };
      const result = await insertTestNotificationQueueEvents(payload);
      msgApi.success(`Inserted ${result.inserted} test events.`);
      setTestModalOpen(false);
      testForm.resetFields();
      refetchEvents();
      refetchStats();
    } catch (error) {
      msgApi.error(error instanceof Error ? error.message : 'Failed to insert test events');
    } finally {
      setTestLoading(false);
    }
  };

  const exportMenu = {
    items: [
      {
        key: 'csv',
        label: 'Export CSV',
        icon: <GatewayIcon name="DownloadOutlined" />,
        onClick: handleExportCsv,
      },
    ],
  };

  return (
    <PageTemplate
      title="Event Audit"
      description="Track every event received, skipped, delivered, or failed."
      compact
      actions={
        <Space size={spacingToNumber(spacing[2])} wrap>
          <Button
            type="primary"
            icon={<GatewayIcon name="UploadOutlined" />}
            onClick={() => setImportModalOpen(true)}
            size="small"
          >
            Bulk Import
          </Button>
          <Button
            onClick={() => {
              testForm.setFieldsValue({
                orgId: orgId || undefined,
                orgUnitRid: orgId || undefined,
                randomizeDates: false,
                randomDaysBack: 7,
                randomDaysForward: 7,
              });
              setTestModalOpen(true);
            }}
            size="small"
          >
            Add Test Events
          </Button>
          <Dropdown menu={exportMenu} trigger={['click']}>
            <Button icon={<GatewayIcon name="DownloadOutlined" />} disabled={exportLoading} size="small">
              Export CSV
            </Button>
          </Dropdown>
          <Button
            icon={<GatewayIcon name="ReloadOutlined" />}
            loading={eventsFetching || statsFetching}
            onClick={() => {
              refetchEvents();
              refetchStats();
            }}
            size="small"
          >
            Refresh
          </Button>
        </Space>
      }
    >
      <div className="event-audit-stats">
        <StatPillRow
          activeFilter={statusFilter}
          onFilterChange={(value) => {
            setStatusFilter(value);
            setPage(1);
          }}
          items={[
            {
              title: 'Total',
              value: total,
              icon: <GatewayIcon name="DatabaseOutlined" />,
              tone: cssVar.text.secondary,
              filterValue: null,
            },
            {
              title: 'Delivered',
              value: stats?.delivered,
              icon: <GatewayIcon name="CheckCircleOutlined" />,
              tone: colors.success[600],
              filterValue: 'DELIVERED',
            },
            {
              title: 'Skipped',
              value: stats?.skipped,
              icon: <GatewayIcon name="MinusCircleOutlined" />,
              tone: colors.warning[700],
              filterValue: 'SKIPPED',
            },
            {
              title: 'Failed',
              value: stats?.failed,
              icon: <GatewayIcon name="CloseCircleOutlined" />,
              tone: colors.error[600],
              filterValue: 'FAILED',
            },
            {
              title: 'Failed (stuck)',
              value: stats?.stuck,
              icon: <GatewayIcon name="WarningOutlined" />,
              tone: colors.warning[600],
              filterValue: 'STUCK',
            },
          ]}
        />
      </div>

      <Card className="event-audit-filter-panel" styles={{ body: { padding: spacing[3] } }}>
        <Space wrap size={spacingToNumber(spacing[2])} className="event-audit-filter-row">
          <Text type="label" size="sm" color="secondary">
            Filters
          </Text>
          <Select
            placeholder="Status"
            allowClear
            className="event-audit-filter-select"
            value={statusFilter}
            onChange={(value) => {
              setStatusFilter(value);
              setPage(1);
            }}
            options={statusOptions.map((status) => ({
              value: status,
              label:
                status === 'RECEIVED'
                  ? 'Pending (received)'
                  : status === 'PROCESSING'
                    ? 'Pending (processing)'
                    : status === 'STUCK'
                      ? 'Failed (stuck)'
                      : getStatusLabel(status),
            }))}
            size="small"
          />
          <Select
            placeholder="Source"
            allowClear
            className="event-audit-filter-select"
            value={sourceFilter}
            onChange={(value) => {
              setSourceFilter(value);
              setPage(1);
            }}
            options={sourceOptions.map((source) => ({ value: source, label: source.toUpperCase() }))}
            size="small"
          />
          <Select
            placeholder="Event Type"
            allowClear
            className="console-filter-field"
            value={eventTypeFilter}
            onChange={(value) => {
              setEventTypeFilter(value);
              setPage(1);
            }}
            options={eventTypeOptions}
            size="small"
          />
          <Select
            placeholder="Skip Category"
            allowClear
            className="console-filter-field"
            value={skipCategoryFilter}
            onChange={(value) => {
              setSkipCategoryFilter(value);
              setPage(1);
            }}
            options={skipCategoryOptions.map((category) => ({ value: category, label: category }))}
            size="small"
          />
          <RangePicker
            className="event-audit-filter-range"
            onChange={(dates, dateStrings) => {
              if (dateStrings[0] && dateStrings[1]) {
                setDateRange([dateStrings[0], dateStrings[1]]);
              } else {
                setDateRange(null);
              }
              setPage(1);
            }}
            size="small"
          />
          <Input.Search
            placeholder="Search event ID, source ID, or summary"
            allowClear
            className="event-audit-filter-search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            size="small"
          />
        </Space>
      </Card>

      <Modal
        title="Insert Test Events"
        open={testModalOpen}
        onCancel={() => setTestModalOpen(false)}
        okText="Insert Events"
        onOk={() => testForm.submit()}
        confirmLoading={testLoading}
        destroyOnClose
      >
        <Banner
          status="warning"
          title="This writes real, synthetic events into the live audit trail for the org below — not a preview or sandbox."
          className="console-margin-bottom-4"
        />
        <Form form={testForm} layout="vertical" onFinish={handleTestSubmit} requiredMark="optional">
          <Form.Item
            name="orgUnitRid"
            label="Org Unit RID"
            rules={[{ required: true, message: 'Please enter org unit RID' }]}
          >
            <InputNumber className="console-width-full" placeholder="e.g., 353" min={1} />
          </Form.Item>
          <Form.Item name="orgId" label="Org ID" rules={[{ required: true, message: 'Please enter org ID' }]}>
            <InputNumber className="console-width-full" placeholder="e.g., 353" min={1} />
          </Form.Item>
          <Form.Item name="phone" label="Patient Mobile">
            <Input placeholder="e.g., 9886106330" />
          </Form.Item>
          <Form.Item name="mrn" label="Patient MRN">
            <Input placeholder="e.g., 25-26/GGKN/05338" />
          </Form.Item>
          <Form.Item name="datetime" label="Payload DateTime">
            <Input placeholder="e.g., 27/01/2026 02:58 PM" />
          </Form.Item>
          <Form.Item name="createdAt" label="DB Created At">
            <Input placeholder="e.g., 2026-02-05 15:44:02" />
          </Form.Item>
          <Form.Item name="limit" label="Limit Events">
            <InputNumber className="console-width-full" placeholder="Insert first N events" min={1} />
          </Form.Item>
          <Form.Item
            name="randomizeDates"
            label="Randomize Date Fields"
            valuePropName="checked"
            extra="Replaces date-like fields in the payloads within a random range."
          >
            <Switch />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.randomizeDates !== next.randomizeDates}>
            {({ getFieldValue }) =>
              getFieldValue('randomizeDates') ? (
                <Space size="middle" className="console-width-full">
                  <Form.Item name="randomDaysBack" label="Days Back" className="event-audit-random-date-field">
                    <InputNumber className="console-width-full" placeholder="e.g., 7" min={0} />
                  </Form.Item>
                  <Form.Item name="randomDaysForward" label="Days Forward" className="event-audit-random-date-field">
                    <InputNumber className="console-width-full" placeholder="e.g., 7" min={0} />
                  </Form.Item>
                </Space>
              ) : null
            }
          </Form.Item>
          <Form.Item name="eventTypes" label="Event Types" extra="Leave empty to insert all event types.">
            <Select
              mode="multiple"
              placeholder="Select event types to insert"
              allowClear
              showSearch
              optionFilterProp="label"
              options={allEventTypes.map((type) => ({ label: type, value: type }))}
              maxTagCount={4}
            />
          </Form.Item>
        </Form>
      </Modal>

      {(eventsError || statsError) && (
        <Banner
          status="error"
          title="Could not load event audit data"
          description={
            eventsError instanceof Error
              ? eventsError.message
              : statsError instanceof Error
                ? statsError.message
                : 'An unexpected error occurred.'
          }
          endContent={
            <AstryxButton
              label="Retry"
              variant="secondary"
              size="sm"
              onClick={() => {
                refetchEvents();
                refetchStats();
              }}
            />
          }
          className="console-margin-bottom-3"
        />
      )}

      <div className="event-audit-table-wrapper">
        <Card className="event-audit-table-panel">
          <ModernTable<EventAuditRecord>
            dataSource={events}
            rowKey={(record) => record._id || record.eventId || record.id || ''}
            loading={eventsFetching}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              onChange: (nextPage, nextPageSize) => {
                setPage(nextPage);
                if (nextPageSize) setPageSize(nextPageSize);
              },
            }}
            size="small"
            columns={[
              {
                title: 'Received At',
                dataIndex: 'receivedAt',
                key: 'receivedAt',
                width: 152,
                render: (value: string) => (value ? formatDateTimeWithSeconds(value) : '—'),
                sorter: (a: any, b: any) =>
                  new Date(a.receivedAt || 0).getTime() - new Date(b.receivedAt || 0).getTime(),
              },
              {
                title: 'Event Type',
                dataIndex: 'eventType',
                key: 'eventType',
                width: 160,
                render: (value: string) => <MetaTag variant="event">{value || '—'}</MetaTag>,
              },
              {
                title: 'Status',
                dataIndex: 'status',
                key: 'status',
                width: 100,
                render: (value: string) => (
                  <StatusBadge
                    label={value || '—'}
                    variant={
                      value === 'DELIVERED'
                        ? 'success'
                        : value === 'FAILED' || value === 'STUCK'
                          ? 'error'
                          : value === 'SKIPPED'
                            ? 'warning'
                            : value === 'PROCESSING' || value === 'RECEIVED'
                              ? 'info'
                              : 'neutral'
                    }
                    showIcon={false}
                    size="small"
                  />
                ),
              },
              {
                title: 'Source',
                dataIndex: 'source',
                key: 'source',
                width: 130,
                render: (value: string, record: EventAuditRecord) => (
                  <Space direction="vertical" size={0} className="console-min-width-0">
                    <MetaTag variant="neutral">{(value || '—').toUpperCase()}</MetaTag>
                    {record.sourceId && (
                      <Text
                        type="supporting"
                        size="sm"
                        color="secondary"
                        maxLines={1}
                        hasTruncateTooltip
                        className="event-audit-source-id"
                      >
                        {record.sourceId}
                      </Text>
                    )}
                  </Space>
                ),
              },
              {
                title: 'Delivery',
                key: 'delivery',
                width: 150,
                render: (_: any, record: EventAuditRecord) => {
                  const delivery = record.deliveryStatus || {};
                  return (
                    <Text>
                      {delivery.integrationsMatched ?? 0} matched · {delivery.deliveredCount ?? 0} ok ·{' '}
                      {delivery.failedCount ?? 0} failed
                    </Text>
                  );
                },
              },
              {
                title: 'Skip / Reason',
                dataIndex: 'skipReason',
                key: 'skipReason',
                width: 210,
                ellipsis: true,
                render: (_: any, record: EventAuditRecord) => {
                  const reason = `${record.skipCategory ? `${record.skipCategory}: ` : ''}${record.skipReason || record.errorMessage || '—'}`;
                  return (
                    <Text type="supporting" color="secondary" maxLines={1} hasTruncateTooltip>
                      {reason}
                    </Text>
                  );
                },
              },
              {
                title: 'Event ID',
                dataIndex: 'eventId',
                key: 'eventId',
                width: 150,
                render: (value: string) => (
                  <Text type="code" maxLines={1} hasTruncateTooltip>
                    {value || '—'}
                  </Text>
                ),
              },
              {
                title: '',
                key: 'actions',
                width: 80,
                render: (_: any, record: EventAuditRecord) => (
                  <Button
                    type="text"
                    icon={<GatewayIcon name="EyeOutlined" />}
                    onClick={() => {
                      setSelectedEvent(record);
                      setSelectedEventId(record.eventId);
                      setDrawerOpen(true);
                    }}
                  >
                    View
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      </div>

      <EventAuditDrawer
        event={drawerEvent}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setSelectedEventId(null);
          if (searchParams.has('eventId')) {
            const next = new URLSearchParams(searchParams);
            next.delete('eventId');
            setSearchParams(next, { replace: true });
          }
        }}
      />

      <BulkImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onSuccess={() => {
          setImportModalOpen(false);
          refetchEvents();
          refetchStats();
        }}
      />
    </PageTemplate>
  );
};
