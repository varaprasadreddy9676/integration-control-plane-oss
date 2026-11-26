import { useMemo, useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { App, Card, Divider, Dropdown, Flex, Grid, Input, Space, Switch, Collapse, Tooltip } from "@/components/common/LegacyAntdControls";
import { Text } from '@astryxdesign/core/Text';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { MonacoEditorInput } from './MonacoEditorInput';
import { useDesignTokens, spacingToNumber } from '../../../design-system/utils';
import { Button } from '../../../components/common/LegacyButton';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { InlineNotice as Notice } from '../../../components/common';

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
  const { spacing } = useDesignTokens();

  return (
    <div className="panel transformation-script-panel">
      <Space direction="vertical" size={spacingToNumber(spacing[2])} className="console-width-full">
        <Flex justify="space-between" align="center">
          <div>
            <Heading level={5} className="console-margin-none">
              JavaScript Transform
            </Heading>
            <Text type="supporting" size="sm" color="secondary">
              Available: <code>payload</code>, <code>context</code>
              <Tooltip title="Sandbox environment: No network, filesystem, or imports. 10s timeout.">
                <GatewayIcon
                  name="InfoCircleOutlined"
                  className="console-margin-left-2 console-text-info console-cursor-help"
                />
              </Tooltip>
            </Text>
          </div>
          <Collapse
            ghost
            items={[
              {
                key: 'example',
                label: (
                  <Text type="supporting" size="sm" color="secondary">
                    <GatewayIcon name="CodeOutlined" /> Example
                  </Text>
                ),
                children: (
                  <pre className="transformation-code-example">
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
                      <Text type="supporting" color="secondary">
                        {field.typeBadge}
                      </Text>
                    )}
                    <Text type="code" color="secondary">
                      {field.path || field.key}
                    </Text>
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
            <Button icon={<GatewayIcon name="FileAddOutlined" />} size="small">
              Insert Field
            </Button>
          </Dropdown>
          <Button icon={<GatewayIcon name="HighlightOutlined" />} onClick={onValidate} size="small">
            Validate
          </Button>
          <Button icon={<GatewayIcon name="UndoOutlined" />} onClick={onReset} size="small">
            Insert example
          </Button>
        </Flex>

        <Collapse
          size="small"
          ghost
          className="console-margin-top-3 console-margin-bottom-2"
          items={[
            {
              key: 'lookup-help',
              label: (
                <Space size={4}>
                  <GatewayIcon name="DatabaseOutlined" className="console-text-accent" />
                  <Text size="base" weight="semibold">
                    Using Lookup Tables in Scripts
                  </Text>
                </Space>
              ),
              children: (
                <div>
                  <Text type="supporting" size="sm">
                    Use the <code>lookup(sourceCode, mappingType)</code> function to translate codes using your
                    configured lookup tables:
                  </Text>
                  <pre className="transformation-code-example transformation-lookup-example">
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
                  <a href="/help/lookup-guide" target="_blank" rel="noreferrer">
                    <GatewayIcon name="BookOutlined" className="console-margin-right-1" />
                    View Complete Lookup Tables Guide
                  </a>
                </div>
              ),
            },
          ]}
        />

        <div className="console-margin-top-2">
          <MonacoEditorInput value={scriptValue} onChange={onScriptChange} height="400px" />
        </div>

        {validationStatus !== 'idle' && (
          <Notice
            type={validationStatus === 'success' ? 'success' : 'error'}
            message={validationStatus === 'success' ? 'Script validated' : 'Validation failed'}
            description={validationMessage}
            className="transformation-validation-notice console-margin-top-2"
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
  const { spacing } = useDesignTokens();
  const eventPayloadText = useMemo(() => (eventPayload ? JSON.stringify(eventPayload, null, 2) : ''), [eventPayload]);

  const isSuccess = lastRunMeta?.status && lastRunMeta.status >= 200 && lastRunMeta.status < 300;
  const isError = lastRunMeta?.status && lastRunMeta.status >= 400;

  return (
    <Card className="panel transformation-test-panel">
      <Flex align="center" justify="space-between" className="console-margin-bottom-3">
        <Space align="center">
          <Heading level={5} className="console-margin-none">
            Test Preview
          </Heading>
          {lastRunMeta?.durationMs && (
            <Text type="supporting" size="sm" color="secondary">
              {isSuccess && (
                <GatewayIcon
                  name="CheckCircleFilled"
                  className="console-text-success console-margin-right-1"
                />
              )}
              {lastRunMeta.durationMs}ms
            </Text>
          )}
        </Space>
        <Space size={spacingToNumber(spacing[2])}>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'load',
                  label: 'Load example',
                  icon: <GatewayIcon name="FileTextOutlined" />,
                  onClick: onLoadExample,
                },
                {
                  key: 'paste',
                  label: 'Paste from clipboard',
                  icon: <GatewayIcon name="LinkOutlined" />,
                  onClick: onPaste,
                },
                eventPayloadText && {
                  key: 'schema',
                  label: 'Use event schema',
                  icon: <GatewayIcon name="ReloadOutlined" />,
                  onClick: () => onUseEventPayload?.(eventPayloadText),
                },
              ].filter(Boolean) as any,
            }}
            placement="bottomRight"
          >
            <Button icon={<GatewayIcon name="InfoCircleOutlined" />} size="small">
              Load
            </Button>
          </Dropdown>
          <Space size={4}>
            <Switch checked={autoRun} onChange={onToggleAutoRun} size="small" />
            <Text type="supporting" size="sm">
              Auto
            </Text>
          </Space>
          <Button icon={<GatewayIcon name="ThunderboltOutlined" />} type="primary" onClick={onRunPreview} size="small">
            Run
          </Button>
        </Space>
      </Flex>

      {/* Event Schema Reference - Collapsed */}
      {eventPayloadText && (
        <Collapse
          ghost className="console-margin-bottom-2"
          items={[
            {
              key: 'schema',
              label: (
                <Text type="supporting" size="sm" color="secondary">
                  <GatewayIcon name="InfoCircleOutlined" /> Event Schema
                </Text>
              ),
              children: (
                <Input.TextArea
                  rows={5}
                  value={eventPayloadText}
                  readOnly
                  className="transformation-code-textarea"
                />
              ),
            },
          ]}
        />
      )}

      {/* Compact Input/Output Grid */}
      <div className="transformation-input-output-grid console-gap-2">
        <div>
          <Text size="base" weight="semibold" display="block" className="console-margin-bottom-1-5">
            Input
          </Text>
          <Input.TextArea
            rows={12}
            value={sampleInput}
            onChange={(e) => onSampleInputChange(e.target.value)}
            placeholder='{"orderId": 12345}'
            className="transformation-code-textarea"
          />
        </div>
        <div>
          <Flex justify="space-between" align="center" className="console-margin-bottom-1-5">
            <Text size="base" weight="semibold">
              Output
            </Text>
            {isError && <StatusBadge label="Error" variant="error" showIcon={false} />}
            {isSuccess && <StatusBadge label="Success" variant="success" showIcon={false} />}
          </Flex>
          <Input.TextArea
            rows={12}
            value={sampleOutput}
            readOnly
            className="transformation-code-textarea"
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
  const { spacing } = useDesignTokens();
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
  }, [sampleInput, getPreviewContext, scriptValue, onSampleOutputChange, message]);

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
      <div className="console-margin-bottom-3">
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

      <Divider className="console-margin-y-3" />

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
