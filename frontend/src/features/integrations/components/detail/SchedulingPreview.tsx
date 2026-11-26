import { useEffect, useState } from 'react';
import { Typography } from '@/components/common/LegacyTypography';
import { Card, Space, Spin, Statistic, Row, Col, Collapse, Modal, App } from '@/components/common/LegacyAntdControls';
import { Icon as GatewayIcon } from '../../../../components/common/Icon';
import { Banner } from '@astryxdesign/core/Banner';
import { InlineHint } from '../../../../components/common/InlineHint';
import Editor from '@monaco-editor/react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { testSchedulingScript, type SchedulingTestResult } from '../../../../services/api';
import { useThemeMode } from '../../../../app/theme-provider';
import { Button } from '../../../../components/common/LegacyButton';
import { editorFontSize } from '../../../../design-system/utils';

dayjs.extend(relativeTime);

const { Text } = Typography;

interface SchedulingPreviewProps {
  integrationId?: string; // Can be undefined for new integrations
  script?: string;
  deliveryMode: 'IMMEDIATE' | 'DELAYED' | 'RECURRING';
  eventType?: string;
  onPreviewChange?: (state: { preview: SchedulingTestResult | null; error: string | null; loading: boolean }) => void;
}

/**
 * SchedulingPreview - Real-time preview of when integration will be scheduled
 *
 * Shows a visual preview of scheduling results:
 * - DELAYED: Shows single scheduled time
 * - RECURRING: Shows first occurrence, interval, and total occurrences
 *
 * Auto-refreshes when script changes (debounced 800ms)
 */
export const SchedulingPreview = ({
  integrationId,
  script,
  deliveryMode,
  eventType,
  onPreviewChange,
}: SchedulingPreviewProps) => {
  const { mode } = useThemeMode();
  const { message } = App.useApp();
  const [preview, setPreview] = useState<SchedulingTestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [samplePayload, setSamplePayload] = useState<any>(null);
  const [customPayload, setCustomPayload] = useState<any>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editedPayloadText, setEditedPayloadText] = useState<string>('');
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [showNextRuns, setShowNextRuns] = useState(false);

  useEffect(() => {
    if (deliveryMode !== 'RECURRING') {
      setShowNextRuns(false);
    }
  }, [deliveryMode]);

  useEffect(() => {
    // Only fetch preview for DELAYED or RECURRING modes with script
    if (deliveryMode === 'IMMEDIATE' || !script || script.trim().length === 0) {
      setPreview(null);
      setError(null);
      setLoading(false);
      onPreviewChange?.({ preview: null, error: null, loading: false });
      return;
    }

    let isActive = true;
    const fetchPreview = async () => {
      setLoading(true);
      onPreviewChange?.({ preview: null, error: null, loading: true });
      setError(null);
      try {
        // Use 'new' as integration ID for create mode, otherwise use actual ID
        const id = integrationId || 'new';

        // Send current script, deliveryMode, and eventType from form (unsaved changes)
        // Use custom payload if user has edited it, otherwise backend will use event-specific sample
        const result = await testSchedulingScript(id, {
          script,
          deliveryMode,
          eventType, // Send event type so backend can use event-specific sample payload
          payload: customPayload, // Send custom payload if available (overrides event-specific sample)
        });
        if (!isActive) return;
        setPreview(result);
        // Store sample payload if available
        if ((result as any).samplePayload) {
          setSamplePayload((result as any).samplePayload);
        }
        onPreviewChange?.({ preview: result, error: null, loading: false });
      } catch (err: any) {
        if (!isActive) return;
        const message = err.message || 'Failed to generate preview';
        setError(message);
        setPreview(null);
        onPreviewChange?.({ preview: null, error: message, loading: false });
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    // Debounce to avoid too many API calls while user is typing
    const timer = setTimeout(fetchPreview, 800);
    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [script, deliveryMode, eventType, integrationId, customPayload, onPreviewChange]);

  const handleEditSampleData = () => {
    // Use current sample payload or custom payload as starting point
    const currentPayload = customPayload ||
      samplePayload || {
        sample: true,
        testMode: true,
        timestamp: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        arrivedAt: new Date().toISOString(),
        appt: {
          apptDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          fromDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          apptTime: '14:00:00',
          fromTime: '14:00:00',
          name: 'Test Patient',
          reasonForVisit: 'new consult',
        },
        patient: {
          fullName: 'Test Patient',
          phone: '9876543210',
          uhid: 'TEST_UHID_001',
        },
        appointmentDateTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        entityId: 12345,
        eventType: eventType || 'TEST_EVENT',
        name: 'Test Patient',
      };
    setEditedPayloadText(JSON.stringify(currentPayload, null, 2));
    setEditModalOpen(true);
  };

  const handleSaveCustomPayload = () => {
    try {
      const parsed = JSON.parse(editedPayloadText);
      setCustomPayload(parsed);
      setEditModalOpen(false);
      message.success('Custom sample data saved - preview will update');
    } catch (err: any) {
      message.error('Invalid JSON: ' + err.message);
    }
  };

  const handleResetToDefault = () => {
    setCustomPayload(null);
    setEditModalOpen(false);
    message.info('Reset to default sample data');
  };

  // Don't show anything for IMMEDIATE mode
  if (deliveryMode === 'IMMEDIATE') {
    return null;
  }

  // Don't show if no script yet
  if (!script || script.trim().length === 0) {
    return (
      <Card size="small" className="console-surface-subtle-bordered">
        <Text type="secondary">
          <GatewayIcon name="ClockCircleOutlined" /> Enter a scheduling script to see preview
        </Text>
      </Card>
    );
  }

  // Don't show if no event type selected (unless custom payload is provided)
  if (!eventType && !customPayload) {
    return (
      <Card
        size="small"
        title={
          <Space>
            <GatewayIcon name="ClockCircleOutlined" className="console-text-warning" />
            <span>No Event Type Selected</span>
          </Space>
        }
        extra={
          <Button
            type="link"
            size="small"
            icon={<GatewayIcon name="EditOutlined" />}
            onClick={handleEditSampleData}
            className="console-control-reset-padding"
          >
            Use Custom Sample
          </Button>
        }
        className="schedule-preview-panel schedule-preview-panel--neutral"
      >
        <Text type="secondary" className="console-type-caption">
          Select an event type to see preview with relevant sample data, or click "Use Custom Sample" to provide your
          own test data.
        </Text>

        {/* Edit Sample Modal */}
        <Modal
          title="Edit Sample Test Data"
          open={editModalOpen}
          onCancel={() => setEditModalOpen(false)}
          width={700}
          footer={
            <Space>
              <Button onClick={handleResetToDefault}>Reset to Default</Button>
              <Button onClick={() => setEditModalOpen(false)}>Cancel</Button>
              <Button type="primary" onClick={handleSaveCustomPayload}>
                Apply Custom Data
              </Button>
            </Space>
          }
        >
          <Space direction="vertical" size={12} className="console-width-full">
            <InlineHint>
              Create custom test data for your scheduling script. Since no event type is selected, provide JSON with the
              fields it needs.
            </InlineHint>
            <div className="console-preview-frame">
              <Editor
                height="400px"
                language="json"
                value={editedPayloadText}
                onChange={(value) => setEditedPayloadText(value || '')}
                options={{
                  minimap: { enabled: false },
                  fontSize: editorFontSize('body'),
                  lineNumbers: 'on',
                  wordWrap: 'on',
                  formatOnPaste: true,
                  formatOnType: true,
                }}
                theme={mode === 'dark' ? 'vs-dark' : 'light'}
              />
            </div>
          </Space>
        </Modal>
      </Card>
    );
  }

  // Loading state
  if (loading) {
    return (
      <Card size="small" className="schedule-preview-panel schedule-preview-panel--neutral">
        <Space>
          <Spin size="small" />
          <Text type="secondary">Generating schedule preview...</Text>
        </Space>
      </Card>
    );
  }

  // Error state - show error but still allow editing sample data
  if (error) {
    return (
      <Card
        size="small"
        title={
          <Space>
            <GatewayIcon name="CalendarOutlined" className="console-text-error" />
            <span>Schedule Preview Error</span>
          </Space>
        }
        extra={
          <Space size={8}>
            <Text type="secondary">{customPayload ? 'Custom test data' : 'Sample event data'}</Text>
            <Button
              type="link"
              size="small"
              icon={<GatewayIcon name="EditOutlined" />}
              onClick={handleEditSampleData}
              className="console-control-reset-padding"
            >
              Edit Sample
            </Button>
          </Space>
        }
        className="schedule-preview-panel schedule-preview-panel--error"
      >
        <Banner
          status="error"
          title="Scheduling script execution failed"
          collapsible={false}
          description={
            <Space direction="vertical" size={8}>
              <Text className="console-type-caption">{error}</Text>
              <Text className="console-type-caption">
                Click "Edit Sample" above to test with the fields your script expects.
                {!customPayload && ' The default sample may not include them.'}
              </Text>
            </Space>
          }
          className="console-margin-bottom-none"
        />

        {/* Edit Sample Modal */}
        <Modal
          title="Edit Sample Test Data"
          open={editModalOpen}
          onCancel={() => setEditModalOpen(false)}
          width={700}
          footer={
            <Space>
              <Button onClick={handleResetToDefault}>Reset to Default</Button>
              <Button onClick={() => setEditModalOpen(false)}>Cancel</Button>
              <Button type="primary" onClick={handleSaveCustomPayload}>
                Apply Custom Data
              </Button>
            </Space>
          }
        >
          <Space direction="vertical" size={12} className="console-width-full">
            <InlineHint>
              Use valid JSON and include the fields your script needs. The preview updates after you apply the sample.
            </InlineHint>
            <div className="schedule-preview-editor">
              <Editor
                height="400px"
                language="json"
                value={editedPayloadText}
                onChange={(value) => setEditedPayloadText(value || '')}
                options={{
                  minimap: { enabled: false },
                  fontSize: editorFontSize('body'),
                  lineNumbers: 'on',
                  wordWrap: 'on',
                  formatOnPaste: true,
                  formatOnType: true,
                }}
                theme={mode === 'dark' ? 'vs-dark' : 'light'}
              />
            </div>
          </Space>
        </Modal>
      </Card>
    );
  }

  // No preview data
  if (!preview) {
    return null;
  }

  // DELAYED mode preview
  if (deliveryMode === 'DELAYED' && preview.result.scheduledFor) {
    const scheduledTime = dayjs(preview.result.scheduledFor);
    const isPastDue = preview.result.isPastDue || scheduledTime.isBefore(dayjs());
    const fromNow = scheduledTime.fromNow();

    // Extract sample appointment details if available
    const sampleApptDate = samplePayload?.appt?.apptDate || samplePayload?.appt?.fromDate;
    const sampleApptTime = samplePayload?.appt?.apptTime || samplePayload?.appt?.fromTime;
    const sampleApptDateTime = sampleApptDate && sampleApptTime ? dayjs(`${sampleApptDate}T${sampleApptTime}`) : null;

    return (
      <Card
        size="small"
        title={
          <Space>
            <GatewayIcon name="CalendarOutlined" className="console-text-info" />
            <span>Schedule Preview (Test Mode)</span>
          </Space>
        }
        extra={
          <Space size={8}>
            <Text type="secondary">{customPayload ? 'Custom test data' : 'Sample event data'}</Text>
            <Button
              type="link"
              size="small"
              icon={<GatewayIcon name="EditOutlined" />}
              onClick={handleEditSampleData}
              className="console-control-reset-padding"
            >
              Edit
            </Button>
            <Button
              type="text"
              size="small"
              icon={previewCollapsed ? <GatewayIcon name="RightOutlined" /> : <GatewayIcon name="DownOutlined" />}
              onClick={() => setPreviewCollapsed((prev) => !prev)}
            >
              {previewCollapsed ? 'Show' : 'Hide'}
            </Button>
          </Space>
        }
        className="schedule-preview-panel schedule-preview-panel--info"
      >
        {previewCollapsed ? (
          <Text type="secondary" className="console-type-caption">
            Preview hidden. Click "Show" to view details.
          </Text>
        ) : (
          <>
            <InlineHint>
              <Space direction="vertical" size={4}>
                <Text>
                  {customPayload ? 'Preview based on custom test data.' : 'Preview based on sample event data.'}
                </Text>
                <Text type="secondary">
                  Actual scheduled time varies with real event data at runtime.
                  {!customPayload && ' Select Edit above to test with a custom sample.'}
                </Text>
                {sampleApptDateTime && (
                  <Text type="secondary">
                    Sample appointment: {sampleApptDateTime.format('MMM D, YYYY [at] h:mm A')}
                  </Text>
                )}
              </Space>
            </InlineHint>

            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12}>
                <Statistic
                  title="Calculated schedule time"
                  value={scheduledTime.format('MMM D, YYYY')}
                  className="schedule-statistic-value schedule-statistic-value--section schedule-statistic-value--info"
                  prefix={<GatewayIcon name="CalendarOutlined" />}
                />
                <Text type="secondary" className="console-type-caption">
                  {scheduledTime.format('dddd')} at {scheduledTime.format('h:mm A')}
                </Text>
              </Col>
              <Col xs={24} sm={12}>
                <Statistic
                  title="Delay from sample time"
                  value={preview.result.delayFromNow || fromNow}
                  className="schedule-statistic-value schedule-statistic-value--section schedule-statistic-value--success"
                  prefix={<GatewayIcon name="ClockCircleOutlined" />}
                />
                <Text type="secondary" className="console-type-caption">
                  {fromNow}
                </Text>
              </Col>
            </Row>

            <Collapse
              size="small"
              ghost
              items={[
                {
                  key: 'sample-data',
                  label: (
                    <Text type="secondary" className="console-type-caption">
                      {customPayload ? 'View custom test data used' : 'View sample event data used'}
                    </Text>
                  ),
                  children: (
                    <pre className="schedule-preview-sample-code">
                      {JSON.stringify(customPayload || samplePayload, null, 2)}
                    </pre>
                  ),
                },
              ]}
              className="console-margin-top-3"
            />

            <Text type="secondary" className="console-type-caption console-display-block console-margin-top-2">
              Script execution: {preview.executionTimeMs}ms
            </Text>
          </>
        )}

        <Modal
          title="Edit Sample Test Data"
          open={editModalOpen}
          onCancel={() => setEditModalOpen(false)}
          width={700}
          footer={
            <Space>
              <Button onClick={handleResetToDefault}>Reset to Default</Button>
              <Button onClick={() => setEditModalOpen(false)}>Cancel</Button>
              <Button type="primary" onClick={handleSaveCustomPayload}>
                Apply Custom Data
              </Button>
            </Space>
          }
        >
          <Space direction="vertical" size={12} className="console-width-full">
            <InlineHint>
              Use valid JSON with the fields your script needs. The preview updates after you apply the sample.
            </InlineHint>
            <div className="schedule-preview-editor">
              <Editor
                height="400px"
                language="json"
                value={editedPayloadText}
                onChange={(value) => setEditedPayloadText(value || '')}
                options={{
                  minimap: { enabled: false },
                  fontSize: editorFontSize('body'),
                  lineNumbers: 'on',
                  wordWrap: 'on',
                  formatOnPaste: true,
                  formatOnType: true,
                }}
                theme={mode === 'dark' ? 'vs-dark' : 'light'}
              />
            </div>
          </Space>
        </Modal>
      </Card>
    );
  }

  // RECURRING mode preview
  if (deliveryMode === 'RECURRING' && preview.result.firstOccurrenceDate) {
    const firstTime = dayjs(preview.result.firstOccurrenceDate);
    const fromNow = firstTime.fromNow();

    return (
      <Card
        size="small"
        title={
          <Space>
            <GatewayIcon name="SyncOutlined" className="console-text-info" />
            <span>Recurring Schedule Preview</span>
          </Space>
        }
        extra={
          <Space size={8}>
            {customPayload && <Text type="secondary">Custom test data</Text>}
            <Button
              type="link"
              size="small"
              icon={<GatewayIcon name="EditOutlined" />}
              onClick={handleEditSampleData}
              className="console-control-reset-padding"
            >
              Edit
            </Button>
            <Button
              type="text"
              size="small"
              icon={previewCollapsed ? <GatewayIcon name="RightOutlined" /> : <GatewayIcon name="DownOutlined" />}
              onClick={() => setPreviewCollapsed((prev) => !prev)}
            >
              {previewCollapsed ? 'Show' : 'Hide'}
            </Button>
          </Space>
        }
        className="schedule-preview-panel schedule-preview-panel--info"
      >
        {previewCollapsed ? (
          <Text type="secondary" className="console-type-caption">
            Preview hidden. Click "Show" to view details.
          </Text>
        ) : (
          <>
            <Row gutter={[16, 12]}>
              <Col xs={24} sm={12}>
                <Statistic
                  title="First occurrence"
                  value={firstTime.format('MMM D, YYYY')}
                  className="schedule-statistic-value schedule-statistic-value--control schedule-statistic-value--info"
                  prefix={<GatewayIcon name="CalendarOutlined" />}
                />
                <Text type="secondary" className="console-type-caption">
                  {firstTime.format('dddd')} at {firstTime.format('h:mm A')} ({fromNow})
                </Text>
              </Col>
              <Col xs={24} sm={12}>
                <Statistic
                  title="Interval"
                  value={preview.result.intervalHuman || 'Unknown'}
                  className="schedule-statistic-value schedule-statistic-value--control schedule-statistic-value--success"
                  prefix={<GatewayIcon name="ClockCircleOutlined" />}
                />
                {preview.result.intervalMs && (
                  <Text type="secondary" className="console-type-caption">
                    Every {(preview.result.intervalMs / (1000 * 60 * 60)).toFixed(1)} hours
                  </Text>
                )}
              </Col>
              <Col xs={24} sm={12}>
                <Statistic
                  title="Total occurrences"
                  value={preview.result.maxOccurrences || '∞'}
                  className="schedule-statistic-value schedule-statistic-value--control"
                />
              </Col>
              {preview.result.endDateFormatted && (
                <Col xs={24} sm={12}>
                  <Statistic
                    title="End date"
                    value={dayjs(preview.result.endDateFormatted).format('MMM D, YYYY')}
                    className="schedule-statistic-value schedule-statistic-value--control"
                  />
                  <Text type="secondary" className="console-type-caption">
                    {dayjs(preview.result.endDateFormatted).format('h:mm A')}
                  </Text>
                </Col>
              )}
            </Row>

            {preview.result.sampleOccurrences && preview.result.sampleOccurrences.length > 0 && (
              <div className="console-margin-top-3">
                <Button
                  type="link"
                  size="small"
                  icon={<GatewayIcon name="UnorderedListOutlined" />}
                  onClick={() => setShowNextRuns((prev) => !prev)}
                  className="console-control-reset-padding"
                >
                  {showNextRuns ? 'Hide next 5 runs' : 'Show next 5 runs'}
                </Button>
                {showNextRuns && (
                  <div className="console-margin-top-2">
                    {preview.result.sampleOccurrences.map((occurrence) => (
                      <Space key={occurrence.occurrence} size={8} className="schedule-preview-occurrence">
                        <Text type="secondary" className="font-mono">
                          #{occurrence.occurrence}
                        </Text>
                        <Text type="secondary">{dayjs(occurrence.scheduledFor).format('MMM D, YYYY [at] h:mm A')}</Text>
                      </Space>
                    ))}
                  </div>
                )}
              </div>
            )}

            {preview.result.totalDuration && (
              <Text type="secondary" className="console-display-block console-margin-top-3">
                Total duration: {preview.result.totalDuration}
              </Text>
            )}

            <Text type="secondary" className="console-type-caption console-display-block console-margin-top-3">
              Execution time: {preview.executionTimeMs}ms
            </Text>
          </>
        )}

        <Modal
          title="Edit Sample Test Data"
          open={editModalOpen}
          onCancel={() => setEditModalOpen(false)}
          width={700}
          footer={
            <Space>
              <Button onClick={handleResetToDefault}>Reset to Default</Button>
              <Button onClick={() => setEditModalOpen(false)}>Cancel</Button>
              <Button type="primary" onClick={handleSaveCustomPayload}>
                Apply Custom Data
              </Button>
            </Space>
          }
        >
          <Space direction="vertical" size={12} className="console-width-full">
            <InlineHint>
              Use valid JSON with the fields your script needs. The preview updates after you apply the sample.
            </InlineHint>
            <div className="schedule-preview-editor">
              <Editor
                height="400px"
                language="json"
                value={editedPayloadText}
                onChange={(value) => setEditedPayloadText(value || '')}
                options={{
                  minimap: { enabled: false },
                  fontSize: editorFontSize('body'),
                  lineNumbers: 'on',
                  wordWrap: 'on',
                  formatOnPaste: true,
                  formatOnType: true,
                }}
                theme={mode === 'dark' ? 'vs-dark' : 'light'}
              />
            </div>
          </Space>
        </Modal>
      </Card>
    );
  }

  return null;
};
