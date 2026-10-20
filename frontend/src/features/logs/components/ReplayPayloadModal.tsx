import { useEffect, useMemo, useState } from 'react';
import { Alert, Input, Modal, Space, Switch, Typography, message } from 'antd';

const { Text } = Typography;

type ReplayPayloadModalProps = {
  open: boolean;
  title?: string;
  initialPayload: unknown;
  defaultReason?: string;
  submitting?: boolean;
  onCancel: () => void;
  onSubmit: (options: { payload: unknown; reason: string; force: boolean }) => Promise<void>;
};

function payloadToEditorValue(payload: unknown) {
  if (typeof payload === 'string') return payload;
  return JSON.stringify(payload ?? {}, null, 2);
}

function parseEditorPayload(value: string, originalPayload: unknown) {
  if (typeof originalPayload === 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return {};
  return JSON.parse(trimmed);
}

export function ReplayPayloadModal({
  open,
  title = 'Replay with edited payload',
  initialPayload,
  defaultReason = 'Manual replay with edited payload',
  submitting = false,
  onCancel,
  onSubmit,
}: ReplayPayloadModalProps) {
  const [editorValue, setEditorValue] = useState('');
  const [reason, setReason] = useState(defaultReason);
  const [force, setForce] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const initialValue = useMemo(() => payloadToEditorValue(initialPayload), [initialPayload]);

  useEffect(() => {
    if (!open) return;
    setEditorValue(initialValue);
    setReason(defaultReason);
    setForce(false);
    setParseError(null);
  }, [defaultReason, initialValue, open]);

  const handleSubmit = async () => {
    try {
      const payload = parseEditorPayload(editorValue, initialPayload);
      setParseError(null);
      await onSubmit({ payload, reason: reason.trim() || defaultReason, force });
    } catch (error: any) {
      const errorMessage = error?.message || 'Unable to replay with this payload';
      if (error instanceof SyntaxError) {
        setParseError(errorMessage);
        return;
      }
      message.error(errorMessage);
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      width={820}
      okText={force ? 'Force replay' : 'Replay'}
      okButtonProps={{ danger: force, loading: submitting }}
      cancelButtonProps={{ disabled: submitting }}
      onCancel={onCancel}
      onOk={handleSubmit}
      destroyOnClose
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Alert
          type="info"
          showIcon
          message="This replays the source payload through the current integration configuration."
          description="For transformed protocols such as HL7 MLLP, the transformation runs again before delivery."
        />
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Replay reason"
        />
        <Input.TextArea
          value={editorValue}
          onChange={(event) => {
            setEditorValue(event.target.value);
            setParseError(null);
          }}
          autoSize={{ minRows: 14, maxRows: 26 }}
          spellCheck={false}
          style={{ fontFamily: 'Monaco, Consolas, "Courier New", monospace', fontSize: 12 }}
        />
        {parseError && <Alert type="error" showIcon message="Payload is not valid JSON" description={parseError} />}
        <Space>
          <Switch checked={force} onChange={setForce} />
          <Text>Bypass circuit breaker for this replay</Text>
        </Space>
      </Space>
    </Modal>
  );
}
