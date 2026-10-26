import {
  useMemo,
  useState,
  useEffect,
  useCallback,
} from 'react';
import {
  Link,
} from 'react-router-dom';
import {
  App,
  Alert,
  Button,
  Card,
  Divider,
  Dropdown,
  Flex,
  Grid,
  Input,
  Space,
  Typography,
  Switch,
  Collapse,
  Tag,
  Tooltip,
} from 'antd';
import {
  CodeOutlined,
  InfoCircleOutlined,
  LinkOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  FileTextOutlined,
  CheckCircleFilled,
  UndoOutlined,
  HighlightOutlined,
  FileAddOutlined,
  DatabaseOutlined,
  BookOutlined,
} from '@ant-design/icons';
import {
  MonacoEditorInput,
} from './MonacoEditorInput';
import {
  cssVar,
  useDesignTokens,
  spacingToNumber,
} from '../../../design-system/utils';

// Default source fields will be dynamically loaded from the API based on selected event type
// No hardcoded values here - everything comes from the event_types collection in MongoDB
const defaultSourceFields: Array<{ key: string; label: string; type: string }> = [];

interface Props {
  scriptValue: string;
  onScriptChange: (val: string) => void;
  sampleInput: string;
  onSampleInputChange: (val: string) => void;
  // Actual event payload (from schema) to display in preview panel
  eventPayload?: unknown;
  onUseEventPayload?: (payloadText: string) => void;
  sampleOutput: string;
  onSampleOutputChange: (val: string) => void;
  getPreviewContext: () => { eventType: string; entityCode?: string; entityName?: string };
  onValidateScript?: () => void;
  availableFields?: Array<{
    key: string;
    label: string;
    type: string;
    path?: string;
    typeBadge?: string;
    depth?: number;
    description?: string;
    required?: boolean;
  }>;
  examplePayloads?: Array<{ label: string; payload: unknown }>;
  eventTypes?: string[];
  currentEventType?: string;
}

/**
 * Generate safe nested access for dot notation paths
 * e.g., 'patient.mrn.documentNumber' -> 'payload?.patient?.mrn?.documentNumber'
 */
const generateSafeAccess = (path: string): string => {
  const parts = path.split('.');
  return `payload?.${parts.join('?.')}`;
};

const JavascriptTab = ({
  scriptValue,
  onScriptChange,
  onValidate,
  onReset,
  availableFields,
  validationStatus,
  validationMessage,
}: {
  scriptValue: string;
  onScriptChange: (val: string) => void;
  onValidate?: () => void;
  onReset: () => void;
  availableFields: Array<{ key: string; label: string; type: string }>;
  validationStatus?: 'idle' | 'success' | 'error';
  validationMessage?: string;
}) => {
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;

  return (
    <div className="panel" style={{ padding: spacing[3], borderRadius: token.borderRadiusLG }}>
      <Space direction="vertical" size={spacingToNumber(spacing[2])} style={{ width: '100%' }}>
        <Flex justify="space-between" align="center">
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}>
              JavaScript Transform
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Available: <code>payload</code>, <code>context</code>
              <Tooltip title="Sandbox environment: No network, filesystem, or imports. 10s timeout.">
                <InfoCircleOutlined style={{ marginLeft: 6, color: colors.info[500], cursor: 'help' }} />
              </Tooltip>
            </Typography.Text>
          </div>
          <Collapse
            ghost
            items={[
              {
                key: 'example',
                label: (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    <CodeOutlined /> Example
                  </Typography.Text>
                ),
                children: (
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      fontFamily: token.fontFamilyCode,
                      fontSize: 12,
                      padding: spacing[2],
                      background: colors.neutral[900],
                      color: colors.neutral[50],
                      borderRadius: token.borderRadius,
                    }}
                  >
                    {`const result = {
  event_type: context.eventType,
  entity_id: payload.patientRID,
  entity_name: payload.name
};
return result;`}
                  </pre>
                ),
              },
            ]}
          />
        </Flex>

        <Flex align="center" gap={spacingToNumber(spacing[2])} wrap>
          <Dropdown
            menu={{
              items: availableFields.map((field: any) => ({
                key: field.path || field.key,
                label: (
                  <Space size={4} style={{ paddingLeft: (field.depth || 0) * 8 }}>
                    <span>{field.label}</span>
                    {field.typeBadge && (
                      <Tag
                        color={field.type === 'array' ? 'blue' : 'purple'}
                        style={{ fontSize: '10px', lineHeight: '16px' }}
                      >
                        {field.typeBadge}
                      </Tag>
                    )}
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {field.path || field.key}
                    </Typography.Text>
                  </Space>
                ),
                onClick: () => {
                  const safeAccess = generateSafeAccess(field.path || field.key);
                  const comment = field.isComplex
                    ? `// ${field.label} (${field.type}) - use ${field.type === 'array' ? 'payload.' + (field.path || field.key) + '[0].fieldName' : 'payload.' + (field.path || field.key) + '.fieldName'}`
                    : `// ${field.label}`;
                  onScriptChange(`${scriptValue}\n${comment}\n${safeAccess}`);
                },
              })),
            }}
          >
            <Button icon={<FileAddOutlined />} size="small">
              Insert Field
            </Button>
          </Dropdown>
          <Button icon={<HighlightOutlined />} onClick={onValidate} size="small">
            Validate
          </Button>
          <Button icon={<UndoOutlined />} onClick={onReset} size="small">
            Insert example
          </Button>
        </Flex>

        <Collapse
          size="small"
          ghost
          style={{ marginTop: spacing[3], marginBottom: spacing[2] }}
          items={[
            {
              key: 'lookup-help',
              label: (
                <Space size={4}>
                  <DatabaseOutlined style={{ color: colors.primary[600] }} />
                  <Typography.Text strong style={{ fontSize: 13 }}>
                    Using Lookup Tables in Scripts
                  </Typography.Text>
                </Space>
              ),
              children: (
                <div>
                  <Typography.Text style={{ fontSize: 12 }}>
                    Use the <code>lookup(sourceCode, mappingType)</code> function to translate codes using your
                    configured lookup tables:
                  </Typography.Text>
                  <pre
                    style={{
                      background: colors.neutral[900],
                      color: colors.neutral[100],
                      padding: spacing[2],
                      borderRadius: 4,
                      fontSize: 12,
                      overflow: 'auto',
                      marginTop: 8,
                      marginBottom: 8,
                    }}
                  >
                    {`// Simple lookup
externalServiceCode: lookup(payload.serviceCode, 'SERVICE_CODE'),

// With fallback
providerID: lookup(payload.doctorId, 'PROVIDER_ID') || 'UNKNOWN',

// Array mapping
items: payload.items?.map(item => ({
  ...item,
  externalCode: lookup(item.code, 'ITEM_CODE')
}))`}
                  </pre>
                  <Typography.Link href="/help/lookup-guide" target="_blank" style={{ fontSize: 12 }}>
                    <BookOutlined style={{ marginRight: 4 }} />
                    View Complete Lookup Tables Guide
                  </Typography.Link>
                </div>
              ),
            },
          ]}
        />

        <div style={{ marginTop: spacing[2] }}>
          <MonacoEditorInput value={scriptValue} onChange={onScriptChange} height="400px" />
        </div>

        {validationStatus !== 'idle' && (
          <Alert
            type={validationStatus === 'success' ? 'success' : 'error'}
            showIcon
            message={validationStatus === 'success' ? 'Script validated' : 'Validation failed'}
            description={validationMessage}
            style={{ borderRadius: token.borderRadiusLG, marginTop: spacing[2] }}
          />
        )}

      </Space>
    </div>
  );
};

/**
 * Get nested value from object using dot notation path
 * e.g., getNestedValue(obj, 'patient.mrn.documentNumber')
 */
const formatScript = (code: string) => {
  const lines = code
    .split('\n')
    .map((l) => l.trim())
    .filter((l, idx, arr) => l.length > 0 || arr[idx + 1]?.trim().length > 0);
  let indent = 0;
  const formatted = lines.map((line) => {
    if (line.startsWith('}') || line.startsWith('];') || line === '}') {
      indent = Math.max(indent - 2, 0);
    }
    const padded = `${' '.repeat(indent)}${line}`;
    if (line.endsWith('{') || line.endsWith('[')) {
      indent += 2;
    }
    return padded;
  });
  return formatted.join('\n').trim();
};

const TestTransformationPanel = ({
  sampleInput,
  onSampleInputChange,
  eventPayload,
  onUseEventPayload,
  sampleOutput,
  onRunPreview,
  onLoadExample,
  onPaste,
  autoRun,
  onToggleAutoRun,
  lastRunMeta,
}: {
  sampleInput: string;
  onSampleInputChange: (val: string) => void;
  eventPayload?: unknown;
  onUseEventPayload?: (payloadText: string) => void;
  sampleOutput: string;
  onRunPreview: () => void;
  onLoadExample: () => void;
  onPaste: () => void;
  autoRun: boolean;
  onToggleAutoRun: (val: boolean) => void;
  lastRunMeta?: { durationMs?: number; status?: number };
}) => {
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;
  const eventPayloadText = useMemo(() => (eventPayload ? JSON.stringify(eventPayload, null, 2) : ''), [eventPayload]);

  const isSuccess = lastRunMeta?.status && lastRunMeta.status >= 200 && lastRunMeta.status < 300;
  const isError = lastRunMeta?.status && lastRunMeta.status >= 400;

  return (
    <Card className="panel" style={{ borderRadius: token.borderRadiusLG, padding: spacing[3] }}>
      <Flex align="center" justify="space-between" style={{ marginBottom: spacing[3] }}>
        <Space align="center">
          <Typography.Title level={5} style={{ margin: 0 }}>
            Test Preview
          </Typography.Title>
          {lastRunMeta?.durationMs && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {isSuccess && <CheckCircleFilled style={{ color: colors.success[600], marginRight: 4 }} />}
              {lastRunMeta.durationMs}ms
            </Typography.Text>
          )}
        </Space>
        <Space size={spacingToNumber(spacing[2])}>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'load',
                  label: 'Load example',
                  icon: <FileTextOutlined />,
                  onClick: onLoadExample,
                },
                {
                  key: 'paste',
                  label: 'Paste from clipboard',
                  icon: <LinkOutlined />,
                  onClick: onPaste,
                },
                eventPayloadText && {
                  key: 'schema',
                  label: 'Use event schema',
                  icon: <ReloadOutlined />,
                  onClick: () => onUseEventPayload?.(eventPayloadText),
                },
              ].filter(Boolean) as any,
            }}
            placement="bottomRight"
          >
            <Button icon={<InfoCircleOutlined />} size="small">
              Load
            </Button>
          </Dropdown>
          <Space size={4}>
            <Switch checked={autoRun} onChange={onToggleAutoRun} size="small" />
            <Typography.Text style={{ fontSize: 12 }}>Auto</Typography.Text>
          </Space>
          <Button icon={<ThunderboltOutlined />} type="primary" onClick={onRunPreview} size="small">
            Run
          </Button>
        </Space>
      </Flex>

      {/* Event Schema Reference - Collapsed */}
      {eventPayloadText && (
        <Collapse
          ghost
          style={{ marginBottom: spacing[2] }}
          items={[
            {
              key: 'schema',
              label: (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  <InfoCircleOutlined /> Event Schema
                </Typography.Text>
              ),
              children: (
                <Input.TextArea
                  rows={5}
                  value={eventPayloadText}
                  readOnly
                  style={{
                    fontFamily: token.fontFamilyCode,
                    fontSize: 12,
                    background: colors.neutral[900],
                    color: colors.neutral[50],
                  }}
                />
              ),
            },
          ]}
        />
      )}

      {/* Compact Input/Output Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: spacing[2],
        }}
      >
        <div>
          <Typography.Text strong style={{ display: 'block', marginBottom: spacing[1.5], fontSize: 13 }}>
            Input
          </Typography.Text>
          <Input.TextArea
            rows={12}
            value={sampleInput}
            onChange={(e) => onSampleInputChange(e.target.value)}
            placeholder='{"orderId": 12345}'
            style={{
              fontFamily: token.fontFamilyCode,
              fontSize: 12,
              background: colors.neutral[900],
              color: colors.neutral[50],
              borderRadius: token.borderRadius,
            }}
          />
        </div>
        <div>
          <Flex justify="space-between" align="center" style={{ marginBottom: spacing[1.5] }}>
            <Typography.Text strong style={{ fontSize: 13 }}>
              Output
            </Typography.Text>
            {isError && (
              <Tag color="error" style={{ margin: 0, fontSize: 11 }}>
                Error
              </Tag>
            )}
            {isSuccess && (
              <Tag color="success" style={{ margin: 0, fontSize: 11 }}>
                Success
              </Tag>
            )}
          </Flex>
          <Input.TextArea
            rows={12}
            value={sampleOutput}
            readOnly
            style={{
              fontFamily: token.fontFamilyCode,
              fontSize: 12,
              background: colors.neutral[900],
              color: colors.neutral[50],
              borderRadius: token.borderRadius,
            }}
          />
        </div>
      </div>
    </Card>
  );
};

export const TransformationSection = ({
  scriptValue,
  onScriptChange,
  sampleInput,
  onSampleInputChange,
  sampleOutput,
  onSampleOutputChange,
  getPreviewContext,
  onValidateScript,
  eventPayload,
  onUseEventPayload,
  availableFields = defaultSourceFields,
  examplePayloads = [],
}: Props) => {
  const { message, modal } = App.useApp();
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;
  const [validationState, setValidationState] = useState<{ status: 'idle' | 'success' | 'error'; message?: string }>({
    status: 'idle',
  });
  const [lastRunMeta, setLastRunMeta] = useState<{ durationMs?: number; status?: number }>();
  const [autoRun, setAutoRun] = useState(true);
  const handleRunPreview = useCallback(() => {
    const started = performance.now();
    try {
      const parsed = JSON.parse(sampleInput || '{}');
      const ctx = getPreviewContext();
      // No script: the event is sent as it is.
      const result = scriptValue.trim() ? new Function('payload', 'context', scriptValue)(parsed, ctx) : parsed;
      onSampleOutputChange(JSON.stringify(result, null, 2));
      const meta = { durationMs: Math.max(1, Math.round(performance.now() - started)), status: 200 };
      setLastRunMeta(meta);
      message.success('Preview generated');
    } catch (err: any) {
      message.error('Unable to generate preview. Check JSON or script syntax.');
      onSampleOutputChange(
        JSON.stringify(
          {
            error: err?.message ?? 'Unknown error',
            hint: 'Validate your script.',
          },
          null,
          2
        )
      );
      const meta = { durationMs: Math.max(1, Math.round(performance.now() - started)), status: 500 };
      setLastRunMeta(meta);
    }
  }, [
    sampleInput,
    getPreviewContext,
    scriptValue,
    onSampleOutputChange,
    message,
  ]);

  const handleValidateScript = () => {
    try {
      const formatted = formatScript(scriptValue);
      onScriptChange(formatted);
      // Test with mock payload and context
      const mockPayload = {};
      const mockContext = { eventType: 'TEST_EVENT', tenantId: 100, entityName: 'Test Entity' };
      const fn = new Function('payload', 'context', formatted);
      const result = fn(mockPayload, mockContext);
      // Validate that result is an object
      if (typeof result !== 'object' || result === null) {
        throw new Error('Transform must return an object');
      }
      setValidationState({
        status: 'success',
        message: 'Script validated successfully. Transform function returns an object.',
      });
      onValidateScript?.();
      message.success('Formatted and validated');
    } catch (err: any) {
      const msg = err?.message ?? 'Unknown error';
      setValidationState({ status: 'error', message: msg });
      message.error(`Validation failed: ${msg}`);
    }
  };

  const handleResetScript = () => {
    onScriptChange(`// Transform the incoming event payload
// Available: payload (event data), context (eventType, tenantId, entityName)
// lookup(sourceCode, mappingType) - Translate codes using lookup tables

// Example: Map payload fields to your target API format
const result = {
  // Add your field mappings here based on the selected event type
  event_type: context.eventType,
  source: "source-system",
  entity_name: context.entityName,

  // Using lookup tables to translate codes:
  // externalServiceCode: lookup(payload.serviceCode, 'SERVICE_CODE'),
  // providerID: lookup(payload.doctorId, 'PROVIDER_ID') || 'UNKNOWN',

  // Array mapping with lookups:
  // items: payload.items?.map(item => ({
  //   ...item,
  //   externalCode: lookup(item.code, 'ITEM_CODE')
  // }))
};

return result;`);
    message.success('Example inserted');
  };

  return (
    <div>
      <div style={{ marginBottom: spacing[3] }}>
        <JavascriptTab
          scriptValue={scriptValue}
          onScriptChange={onScriptChange}
          onValidate={handleValidateScript}
          onReset={handleResetScript}
          availableFields={availableFields}
          validationStatus={validationState.status}
          validationMessage={validationState.message}
        />
      </div>

      <Divider style={{ margin: `${spacing[3]} 0` }} />

      <TestTransformationPanel
        sampleInput={sampleInput}
        onSampleInputChange={(val) => {
          onSampleInputChange(val);
          if (autoRun) handleRunPreview();
        }}
        eventPayload={eventPayload}
        onUseEventPayload={(payloadText) => {
          onSampleInputChange(payloadText);
          if (autoRun) handleRunPreview();
        }}
        sampleOutput={sampleOutput}
        onRunPreview={handleRunPreview}
        onLoadExample={() => {
          onSampleInputChange(JSON.stringify(examplePayloads[0]?.payload ?? {}, null, 2));
          if (autoRun) handleRunPreview();
        }}
        onPaste={async () => {
          const text = await navigator.clipboard.readText();
          onSampleInputChange(text);
          if (autoRun) handleRunPreview();
        }}
        autoRun={autoRun}
        onToggleAutoRun={setAutoRun}
        lastRunMeta={lastRunMeta}
      />
    </div>
  );
};
