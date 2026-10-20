import { useMemo, useState } from 'react';
import { Alert, Button, Descriptions, Empty, Input, Space, Tabs, Tag, Typography, message } from 'antd';
import { CopyOutlined, PlayCircleOutlined, SearchOutlined } from '@ant-design/icons';
import { useDesignTokens, withAlpha } from '../../../design-system/utils';
import { copyTextToClipboard } from '../../../utils/clipboard';
import { DeliveryDebugTimeline } from './DeliveryDebugTimeline';
import { ReplayPayloadModal } from './ReplayPayloadModal';
import { ModernTable } from '../../../components/common/ModernTable';

const { Text } = Typography;

type Hl7Segment = {
  name: string;
  raw: string;
  fields: string[];
};

type ParsedHl7 = {
  raw: string;
  segments: Hl7Segment[];
  messageType?: string | null;
  messageControlId?: string | null;
  version?: string | null;
  ackCode?: string | null;
  ackMessageControlId?: string | null;
  ackReason?: string | null;
};

type Hl7LogPanelProps = {
  requestPayload?: unknown;
  originalPayload?: unknown;
  responseBody?: unknown;
  metadata?: Record<string, any> | null;
  httpMethod?: string | null;
  status?: string | null;
  errorMessage?: string | null;
  responseStatus?: number | null;
  responseTimeMs?: number | null;
  targetUrl?: string | null;
  createdAt?: string | null;
  compact?: boolean;
  canReplay?: boolean;
  onReplayPayload?: (options: { payload: unknown; reason: string; force: boolean }) => Promise<void>;
};

function toRawHl7(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (value && typeof value === 'object') {
    const candidate = (value as any).rawHl7 || (value as any).hl7 || (value as any).message;
    return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
  }
  return null;
}

function stripMllp(raw: string) {
  const verticalTab = String.fromCharCode(0x0b);
  const fileSeparator = String.fromCharCode(0x1c);
  const withoutStart = raw.startsWith(verticalTab) ? raw.slice(1) : raw;
  if (withoutStart.endsWith(`${fileSeparator}\r`)) return withoutStart.slice(0, -2);
  return withoutStart.endsWith(fileSeparator) ? withoutStart.slice(0, -1) : withoutStart;
}

function parseHl7(rawValue: unknown): ParsedHl7 | null {
  const raw = toRawHl7(rawValue);
  if (!raw) return null;

  const normalized = stripMllp(raw).replace(/\r?\n/g, '\r').trim();
  if (!normalized.startsWith('MSH')) return null;

  const fieldSeparator = normalized[3] || '|';
  const segments = normalized
    .split('\r')
    .filter(Boolean)
    .map((segmentRaw) => {
      const parts = segmentRaw.split(fieldSeparator);
      return {
        name: parts[0] || '',
        raw: segmentRaw,
        fields: parts.slice(1),
      };
    });
  const msh = segments.find((segment) => segment.name === 'MSH');
  const msa = segments.find((segment) => segment.name === 'MSA');

  return {
    raw: normalized,
    segments,
    messageType: msh?.fields[7] || null,
    messageControlId: msh?.fields[8] || null,
    version: msh?.fields[10] || null,
    ackCode: msa?.fields[0] || null,
    ackMessageControlId: msa?.fields[1] || null,
    ackReason: msa?.fields[2] || null,
  };
}

function fieldLabel(segmentName: string, index: number) {
  if (segmentName === 'MSH') {
    return index === 0 ? 'MSH-2' : `MSH-${index + 2}`;
  }
  return `${segmentName}-${index + 1}`;
}

function segmentRows(parsed: ParsedHl7 | null) {
  if (!parsed) return [];
  return parsed.segments.flatMap((segment, segmentIndex) =>
    segment.fields.map((value, fieldIndex) => ({
      key: `${segmentIndex}-${fieldIndex}`,
      segment: segment.name,
      field: fieldLabel(segment.name, fieldIndex),
      value,
      components: value.includes('^') ? value.split('^').join(' | ') : '',
    }))
  );
}

function filterRows(rows: ReturnType<typeof segmentRows>, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return rows;
  return rows.filter((row) =>
    [row.segment, row.field, row.value, row.components]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalized))
  );
}

function classifyHl7Issue(input: {
  ackCode?: string | null;
  accepted?: boolean;
  errorMessage?: string | null;
  responseBody?: unknown;
}) {
  const ackCode = String(input.ackCode || '').toUpperCase();
  const error = String(input.errorMessage || '').toLowerCase();
  if (input.accepted === true) return 'Accepted';
  if (ackCode === 'AR') return 'Receiver application rejected the HL7 message';
  if (ackCode === 'AE') return 'Receiver reported an HL7 application error';
  if (error.includes('ack timed out') || error.includes('ack timeout')) return 'ACK timeout';
  if (error.includes('tls') || error.includes('certificate')) return 'TLS or certificate failure';
  if (error.includes('connect') || error.includes('socket') || error.includes('econn'))
    return 'MLLP connection failure';
  if (error.includes('transformation') || error.includes('script')) return 'Transformation failure';
  if (error.includes('duplicate')) return 'Duplicate HL7 message';
  if (!input.responseBody && input.accepted === false) return 'No ACK captured';
  return input.accepted === false ? 'Delivery failed' : 'HL7 delivery details';
}

async function copyText(value: string) {
  const copied = await copyTextToClipboard(value);
  if (copied) {
    message.success('Copied');
  } else {
    message.error('Failed to copy to clipboard');
  }
}

export function isHl7LogLike(
  input: Pick<Hl7LogPanelProps, 'httpMethod' | 'metadata' | 'requestPayload' | 'responseBody'>
) {
  return (
    input.httpMethod === 'HL7_MLLP' ||
    Boolean(input.metadata?.hl7) ||
    Boolean(parseHl7(input.requestPayload)) ||
    Boolean(parseHl7(input.responseBody))
  );
}

export function Hl7LogPanel({
  requestPayload,
  originalPayload,
  responseBody,
  metadata,
  httpMethod,
  status,
  errorMessage,
  responseStatus,
  responseTimeMs,
  targetUrl,
  createdAt,
  compact = false,
  canReplay = false,
  onReplayPayload,
}: Hl7LogPanelProps) {
  const { spacing, token } = useDesignTokens();
  const [search, setSearch] = useState('');
  const [replayOpen, setReplayOpen] = useState(false);
  const [replaySubmitting, setReplaySubmitting] = useState(false);
  const request = parseHl7(requestPayload);
  const response = parseHl7(responseBody);
  const hl7Meta = metadata?.hl7 || {};
  const isHl7 = isHl7LogLike({ requestPayload, responseBody, metadata, httpMethod });

  if (!isHl7) return null;

  const ackCode = hl7Meta.ackCode || response?.ackCode || null;
  const accepted = hl7Meta.accepted ?? (ackCode ? ['AA', 'CA'].includes(String(ackCode)) : undefined);
  const requestRows = segmentRows(request);
  const responseRows = segmentRows(response);
  const filteredRequestRows = useMemo(() => filterRows(requestRows, search), [requestRows, search]);
  const filteredResponseRows = useMemo(() => filterRows(responseRows, search), [responseRows, search]);
  const rawRequest = request?.raw || toRawHl7(requestPayload) || '';
  const rawResponse = response?.raw || toRawHl7(responseBody) || '';
  const classification = classifyHl7Issue({ ackCode, accepted, errorMessage, responseBody });
  const replayPayload = originalPayload ?? metadata?.originalPayload ?? requestPayload ?? {};

  const handleReplay = async (options: { payload: unknown; reason: string; force: boolean }) => {
    if (!onReplayPayload) return;
    setReplaySubmitting(true);
    try {
      await onReplayPayload(options);
      setReplayOpen(false);
    } finally {
      setReplaySubmitting(false);
    }
  };

  const codeStyle = {
    background: withAlpha(token.colorTextBase, 0.04),
    color: token.colorText,
    padding: spacing[2],
    borderRadius: token.borderRadiusLG,
    border: `1px solid ${token.colorBorderSecondary}`,
    maxHeight: compact ? 220 : 320,
    overflow: 'auto',
    whiteSpace: 'pre-wrap' as const,
    overflowWrap: 'anywhere' as const,
    fontSize: 12,
    lineHeight: 1.45,
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={compact ? 'small' : 'middle'}>
      <Alert
        type={accepted === false ? 'warning' : 'info'}
        showIcon
        message={classification}
        description="Debug timeline, parsed message fields, raw HL7 request, and ACK details from this delivery log."
      />

      <DeliveryDebugTimeline
        compact={compact}
        protocol="HL7 MLLP"
        status={status}
        target={targetUrl}
        createdAt={createdAt}
        responseStatus={responseStatus}
        responseTimeMs={responseTimeMs}
        classification={classification}
        errorMessage={errorMessage}
        metadata={metadata}
      />

      <Descriptions bordered size="small" column={compact ? 1 : 2}>
        <Descriptions.Item label="Protocol">
          <Tag color="purple">HL7 MLLP</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Message Type">
          <Text code>
            {hl7Meta.messageType?.code
              ? `${hl7Meta.messageType.code}^${hl7Meta.messageType.trigger || ''}`
              : request?.messageType || '-'}
          </Text>
        </Descriptions.Item>
        <Descriptions.Item label="MSH-10">
          <Text code>{hl7Meta.messageControlId || request?.messageControlId || '-'}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="ACK">
          {ackCode ? (
            <Tag color={accepted ? 'success' : 'error'}>{ackCode}</Tag>
          ) : (
            <Text type="secondary">No ACK captured</Text>
          )}
          {(hl7Meta.ackMessageControlId || response?.ackMessageControlId) && (
            <Text code style={{ marginLeft: spacing[1] }}>
              {hl7Meta.ackMessageControlId || response?.ackMessageControlId}
            </Text>
          )}
        </Descriptions.Item>
        {(hl7Meta.requestBytes || hl7Meta.responseBytes) && (
          <Descriptions.Item label="Bytes">
            <Text>
              request {hl7Meta.requestBytes || 0}, response {hl7Meta.responseBytes || 0}
            </Text>
          </Descriptions.Item>
        )}
        {(hl7Meta.ackReason || response?.ackReason) && (
          <Descriptions.Item label="ACK Reason">
            <Text>{hl7Meta.ackReason || response?.ackReason}</Text>
          </Descriptions.Item>
        )}
      </Descriptions>

      <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search MSH-10, PID-3, OBR-4, accession, ACK reason..."
          style={{ minWidth: compact ? 240 : 360, maxWidth: 560 }}
        />
        {onReplayPayload && (
          <Button
            icon={<PlayCircleOutlined />}
            disabled={!canReplay}
            onClick={() => setReplayOpen(true)}
            title={
              canReplay
                ? 'Replay this delivery with an edited source payload'
                : 'Only failed or abandoned logs can be replayed'
            }
          >
            Replay edited payload
          </Button>
        )}
      </Space>

      <Tabs
        size="small"
        items={[
          {
            key: 'request',
            label: 'Request HL7',
            children: rawRequest ? (
              <div style={{ position: 'relative' }}>
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => copyText(rawRequest)}
                  style={{ position: 'absolute', top: spacing[1], right: spacing[1], zIndex: 1 }}
                />
                <pre style={{ ...codeStyle, paddingRight: spacing[5] }}>{rawRequest}</pre>
              </div>
            ) : (
              <Text type="secondary">No HL7 request captured</Text>
            ),
          },
          {
            key: 'ack',
            label: 'ACK',
            children: rawResponse ? (
              <div style={{ position: 'relative' }}>
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => copyText(rawResponse)}
                  style={{ position: 'absolute', top: spacing[1], right: spacing[1], zIndex: 1 }}
                />
                <pre style={{ ...codeStyle, paddingRight: spacing[5] }}>{rawResponse}</pre>
              </div>
            ) : (
              <Text type="secondary">No ACK captured</Text>
            ),
          },
          {
            key: 'request-fields',
            label: `Request Fields (${filteredRequestRows.length})`,
            children: filteredRequestRows.length ? (
              <ModernTable
                size="small"
                rowKey="key"
                pagination={{ pageSize: compact ? 8 : 12, size: 'small' }}
                dataSource={filteredRequestRows}
                columns={[
                  { title: 'Segment', dataIndex: 'segment', width: 90, render: (value) => <Tag>{value}</Tag> },
                  { title: 'Field', dataIndex: 'field', width: 110, render: (value) => <Text code>{value}</Text> },
                  {
                    title: 'Value',
                    dataIndex: 'value',
                    render: (value) => <Text style={{ wordBreak: 'break-word' }}>{value || '-'}</Text>,
                  },
                  { title: 'Components', dataIndex: 'components', responsive: ['lg'], render: (value) => value || '-' },
                ]}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No fields match the current search" />
            ),
          },
          ...(filteredResponseRows.length
            ? [
                {
                  key: 'ack-fields',
                  label: `ACK Fields (${filteredResponseRows.length})`,
                  children: (
                    <ModernTable
                      size="small"
                      rowKey="key"
                      pagination={false}
                      dataSource={filteredResponseRows}
                      columns={[
                        {
                          title: 'Segment',
                          dataIndex: 'segment',
                          width: 90,
                          render: (value: string) => <Tag>{value}</Tag>,
                        },
                        {
                          title: 'Field',
                          dataIndex: 'field',
                          width: 110,
                          render: (value: string) => <Text code>{value}</Text>,
                        },
                        { title: 'Value', dataIndex: 'value', render: (value: string) => <Text>{value || '-'}</Text> },
                      ]}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />

      <ReplayPayloadModal
        open={replayOpen}
        initialPayload={replayPayload}
        submitting={replaySubmitting}
        onCancel={() => setReplayOpen(false)}
        onSubmit={handleReplay}
      />
    </Space>
  );
}
