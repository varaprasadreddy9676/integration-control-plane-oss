import { useState } from 'react';
import { Input, Modal, message } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { DeliveryLog } from '../../../mocks/types';
import type { CheckAndReplayResult } from '../../../services/stages-api';
import { checkAndReplay, getSimilarFailures } from '../../../services/stages-api';
import { buildStageCurl } from '../components/StageRunView';

type Refusal = { code: string; message: string; check?: CheckAndReplayResult };

const asRefusal = (error: unknown): Refusal => {
  const api = error as { code?: string; message?: string; details?: { check?: CheckAndReplayResult } };
  return {
    code: api.code || 'ERROR',
    message: api.message || 'The delivery could not be sent again',
    check: api.details?.check,
  };
};

const cause = (log: DeliveryLog) => {
  const attempts = Math.max(Number(log.attemptCount) || 1, 1);
  if (log.responseStatus === null || log.responseStatus === undefined) {
    return {
      title: 'The provider never answered',
      body: `${attempts > 1 ? `All ${attempts} attempts` : 'The attempt'} got no answer in time${log.status === 'ABANDONED' ? ', so the delivery was abandoned' : ''}. A send that timed out may still have reached the provider: check before sending again.`,
    };
  }
  if (log.responseStatus < 400) {
    return {
      title: 'A step rejected the provider\'s answer',
      body: log.errorMessage || `The provider answered ${log.responseStatus}, but a step after the response turned it into a failure.`,
    };
  }
  return {
    title: `The provider answered ${log.responseStatus}`,
    body: log.errorMessage || `The send failed after ${attempts} attempt${attempts === 1 ? '' : 's'}.`,
  };
};

/**
 * Why a delivery failed and what can be done about it (spec 8.3): the cause first, then
 * the actions: send it again only after asking the provider, and the other deliveries
 * that failed the same way.
 */
export const FailurePanel = ({
  log,
  integrationId,
  onChanged,
}: {
  log: DeliveryLog;
  integrationId?: string;
  onChanged: () => void;
}) => {
  const navigate = useNavigate();
  const failed = log.status === 'FAILED' || log.status === 'ABANDONED';
  const similar = useQuery({
    queryKey: ['similar-failures', log.id],
    queryFn: () => getSimilarFailures(log.id, 60),
    enabled: failed,
    retry: false,
  });
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [toast, holder] = message.useMessage();

  const replay = useMutation({
    mutationFn: (acceptUnverified: boolean) => checkAndReplay(log.id, { reason: reason.trim(), acceptUnverified }),
    onSuccess: (result) => {
      setAsking(false);
      setRefusal(null);
      toast.success(
        result.verdict === 'safe_to_resend'
          ? `The provider said ${result.status}. Sent again.`
          : 'Sent again without a confirmation from the provider.'
      );
      onChanged();
    },
    onError: (error) => setRefusal(asRefusal(error)),
  });

  if (!failed) return null;
  const { title, body } = cause(log);
  const others = similar.data;
  const request = log.request;
  const curl =
    log.metadata?.curlCommand ||
    (request?.url
      ? buildStageCurl({
          id: 0,
          method: request.method || 'POST',
          url: request.url,
          requestHeaders: (request.headers || {}) as Record<string, string>,
          requestBody: request.body,
        })
      : null);
  const attemptsList = log.retryAttempts || [];

  return (
    <>
      {holder}
      <div className="wf-callout" role="group" aria-label="Why it failed">
        <h4>{title}</h4>
        <p>{body}</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {log.errorCategory && <span className="wf-chip wf-chip--danger">{log.errorCategory}</span>}
          <span className="wf-chip wf-chip--danger">{log.status}</span>
          {others && others.matchedOn && others.count > 0 && (
            <span className="wf-chip">
              {others.capped ? `${others.count}+` : others.count} other{others.count === 1 ? '' : 's'} in the last hour
            </span>
          )}
        </div>
      </div>

      <div>
        <div className="wf-section-title">What you can do</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="wf-btn wf-btn--primary"
            onClick={() => {
              setRefusal(null);
              setAsking(true);
            }}
          >
            Check status, then replay
          </button>
          {others && others.count > 0 && (
            <button
              type="button"
              className="wf-btn"
              onClick={() =>
                navigate(
                  `/logs?integrationId=${integrationId || log.integrationConfigId || ''}&status=FAILED&dateRange=all`
                )
              }
            >
              See the {others.count} other{others.count === 1 ? '' : 's'}
            </button>
          )}
        </div>
        <div className="wf-help" style={{ marginTop: 6 }}>
          Asks the provider first, and does not send again if it already has the message.
        </div>
      </div>

      {attemptsList.length > 0 && (
        <div>
          <div className="wf-section-title">
            Attempts <span className="wf-help">each one re-ran the stages before send</span>
          </div>
          {attemptsList.map((attempt) => (
            <div
              key={attempt.attemptNumber}
              className="wf-mono"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 12,
                padding: '6px 0',
                borderBottom: '1px solid var(--wf-border)',
              }}
            >
              <span>Attempt {attempt.attemptNumber}</span>
              <span>
                {attempt.responseStatus ? `HTTP ${attempt.responseStatus}` : 'timeout'}
                {attempt.responseTimeMs ? ` · ${(attempt.responseTimeMs / 1000).toFixed(1)} s` : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {curl && (
        <div>
          <div className="wf-section-title">Request (masked)</div>
          <pre
            className="wf-mono"
            style={{
              margin: 0,
              padding: 12,
              borderRadius: 8,
              background: 'var(--wf-sunk)',
              fontSize: 11.5,
              lineHeight: '18px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              maxHeight: 220,
              overflow: 'auto',
            }}
          >
            {curl}
          </pre>
        </div>
      )}
      <div>
        <div className="wf-section-title">Response</div>
        {log.responseStatus === null || log.responseStatus === undefined ? (
          <div
            className="wf-help"
            style={{ padding: 12, border: '1px dashed var(--wf-border-strong)', borderRadius: 8 }}
          >
            No response: the connection was closed before the provider answered.
          </div>
        ) : (
          <pre
            className="wf-mono"
            style={{
              margin: 0,
              padding: 12,
              borderRadius: 8,
              background: 'var(--wf-sunk)',
              fontSize: 11.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              maxHeight: 220,
              overflow: 'auto',
            }}
          >
            {log.responseBody || `HTTP ${log.responseStatus}`}
          </pre>
        )}
      </div>

      <Modal
        open={asking}
        title="Check status, then replay"
        okText={refusal?.code === 'UNVERIFIED' ? 'Send anyway' : 'Check and replay'}
        okButtonProps={{
          loading: replay.isPending,
          disabled: !reason.trim() || refusal?.code === 'PROVIDER_HAS_MESSAGE',
          danger: refusal?.code === 'UNVERIFIED',
        }}
        onOk={() => replay.mutate(refusal?.code === 'UNVERIFIED')}
        onCancel={() => setAsking(false)}
        destroyOnClose
      >
        <p className="wf-help" style={{ color: 'inherit' }}>
          The delivery&apos;s own check asks the provider whether it has the message. It is sent again only if the
          provider says it does not.
        </p>
        <Input.TextArea
          aria-label="Why send it again"
          rows={2}
          placeholder="Why is it sent again?"
          value={reason}
          maxLength={300}
          onChange={(event) => setReason(event.target.value)}
        />
        {refusal && (
          <div className="wf-callout" role="alert" style={{ marginTop: 12 }}>
            <h4>
              {refusal.code === 'PROVIDER_HAS_MESSAGE'
                ? 'Not sent again'
                : refusal.code === 'UNVERIFIED'
                  ? 'Could not confirm'
                  : 'Could not replay'}
            </h4>
            <p>{refusal.message}</p>
            {refusal.code === 'UNVERIFIED' && (
              <p>Sending anyway may deliver the message twice. The choice is recorded.</p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
};
