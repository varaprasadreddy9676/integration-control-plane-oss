import { useEffect, useMemo, useState } from 'react';
import { Input, Modal, Space, Switch, message } from "@/components/common/LegacyAntdControls";
import { Text } from '@astryxdesign/core/Text';
import { Banner } from '@astryxdesign/core/Banner';

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
      width="min(820px, calc(100vw - 24px))"
      okText={force ? 'Force replay' : 'Replay'}
      okButtonProps={{ danger: force, loading: submitting }}
      cancelButtonProps={{ disabled: submitting }}
      onCancel={onCancel}
      onOk={handleSubmit}
      destroyOnHidden
    >
      <Space direction="vertical" className="console-width-full" size="middle">
        <Text color="secondary">Replay uses the current configuration. Protocol transforms run before delivery.</Text>
        <Input
          aria-label="Replay reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Replay reason"
        />
        <Input.TextArea
          aria-label="Replay payload"
          value={editorValue}
          onChange={(event) => {
            setEditorValue(event.target.value);
            setParseError(null);
          }}
          autoSize={{ minRows: 14, maxRows: 26 }}
          spellCheck={false}
          className="ui-extracted-d4a846e090"
        />
        {parseError && <Banner status="error" title="Payload is not valid JSON" description={parseError} />}
        <Space>
          <Switch checked={force} onChange={setForce} />
          <Text>Bypass circuit breaker for this replay</Text>
        </Space>
      </Space>
    </Modal>
  );
}
