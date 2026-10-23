import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FollowUpChecks, buildFollowUpCurl } from '../features/logs/components/FollowUpChecks';
import { followUpStatusColor, followUpStatusLabel } from '../features/logs/components/followUpStatus';
import type { DeliveryFollowUp, FollowUpCheck } from '../mocks/types';

const call = {
  method: 'GET',
  url: 'https://api.example.com/v1/messages?msgid=abc',
  headers: { 'QIKCHAT-API-KEY': '********', Accept: 'application/json' },
  statusCode: 200,
  durationMs: 42,
  responseBody: '{"message":{"status":"delivered"}}',
};
const check = (overrides: Partial<FollowUpCheck> = {}): FollowUpCheck => ({
  check: 1,
  at: '2026-10-22T10:00:30Z',
  outcome: 'RESULT',
  status: 'DELIVERED',
  httpCalls: [call],
  ...overrides,
});
const followUp = (history: FollowUpCheck[], extra: Partial<DeliveryFollowUp> = {}): DeliveryFollowUp => ({
  status: 'DELIVERED',
  done: false,
  checks: history.length,
  history,
  ...extra,
});

describe('status words', () => {
  it('shows what the script returned in plain words', () => {
    expect(followUpStatusLabel('READ')).toBe('Read');
    expect(followUpStatusLabel('SIGNED_OFF')).toBe('Signed off');
    expect(followUpStatusLabel('PENDING')).toBe('Checking');
    expect(followUpStatusLabel('NOT_TRACKED')).toBe('Not tracked');
    expect(followUpStatusLabel(undefined)).toBe('Checking');
  });

  it('colors failures red, finished work green, in-progress blue', () => {
    expect(followUpStatusColor('FAILED')).toBe('red');
    expect(followUpStatusColor('UNDELIVERED')).toBe('red');
    expect(followUpStatusColor('DELIVERED')).toBe('green');
    expect(followUpStatusColor('SIGNED_OFF', true)).toBe('green');
    expect(followUpStatusColor('IN_PROGRESS', false)).toBe('blue');
    expect(followUpStatusColor('UNKNOWN')).toBe('orange');
    expect(followUpStatusColor('PENDING')).toBe('default');
  });
});

describe('buildFollowUpCurl', () => {
  it('writes the request like the delivery cURL, with credentials as they were masked', () => {
    expect(buildFollowUpCurl(call)).toBe(
      'curl -X GET "https://api.example.com/v1/messages?msgid=abc" \\\n  -H "QIKCHAT-API-KEY: ********" \\\n  -H "Accept: application/json"'
    );
  });

  it('works without headers', () => {
    expect(buildFollowUpCurl({ ...call, headers: null })).toBe('curl -X GET "https://api.example.com/v1/messages?msgid=abc"');
  });
});

describe('FollowUpChecks', () => {
  it('shows each check with its request and response', () => {
    render(<FollowUpChecks followUp={followUp([check()])} />);
    expect(screen.getByText(/Check 1/)).toBeInTheDocument();
    expect(screen.getByText(/curl -X GET "https:\/\/api\.example\.com\/v1\/messages\?msgid=abc"/)).toBeInTheDocument();
    expect(screen.getByText(/QIKCHAT-API-KEY: \*{8}/)).toBeInTheDocument();
    expect(screen.getByText(/Response · 200 · 42 ms/)).toBeInTheDocument();
    // the JSON body is laid out for reading
    expect(screen.getByText(/"status": "delivered"/)).toBeInTheDocument();
  });

  it('keeps the checks in the order they ran, one block each', () => {
    render(
      <FollowUpChecks
        followUp={followUp([check({ check: 1, status: 'SENT' }), check({ check: 2, status: 'DELIVERED' })])}
      />
    );
    const headings = screen.getAllByText(/^Check \d/).map((el) => el.textContent);
    expect(headings).toEqual(['Check 1', 'Check 2']);
  });

  it('shows what the script concluded, including a failure reason', () => {
    render(
      <FollowUpChecks
        followUp={followUp([check({ status: 'FAILED', errorCode: '131026', errorMessage: 'Message undeliverable' })], { status: 'FAILED', done: true })}
      />
    );
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText(/131026/)).toBeInTheDocument();
    expect(screen.getByText(/Message undeliverable/)).toBeInTheDocument();
  });

  it('shows a script error and the response that came before it', () => {
    render(
      <FollowUpChecks
        followUp={followUp([
          check({ outcome: 'ERROR', status: undefined, error: 'Qikchat delivery report returned 500', httpCalls: [{ ...call, statusCode: 500, responseBody: '{"error":"down"}' }] }),
        ])}
      />
    );
    expect(screen.getByText('Qikchat delivery report returned 500')).toBeInTheDocument();
    expect(screen.getByText(/Response · 500/)).toBeInTheDocument();
    expect(screen.getByText(/"error": "down"/)).toBeInTheDocument();
  });

  it('shows why tracking stopped', () => {
    render(<FollowUpChecks followUp={followUp([check({ outcome: 'SKIPPED', status: undefined, reason: 'No message id in the response', httpCalls: [] })])} />);
    expect(screen.getByText(/No message id in the response/)).toBeInTheDocument();
  });

  it('says so when a check made no request', () => {
    render(<FollowUpChecks followUp={followUp([check({ httpCalls: [] })])} />);
    expect(screen.getByText('The script made no request.')).toBeInTheDocument();
  });

  it('shows a response that is not JSON as it is', () => {
    render(<FollowUpChecks followUp={followUp([check({ httpCalls: [{ ...call, responseBody: 'OK queued' }] })])} />);
    expect(screen.getByText('OK queued')).toBeInTheDocument();
  });

  it('shows a failed request that got no response', () => {
    render(<FollowUpChecks followUp={followUp([check({ outcome: 'ERROR', httpCalls: [{ ...call, statusCode: null, responseBody: null, error: 'connect ETIMEDOUT' }] })])} />);
    expect(screen.getByText(/connect ETIMEDOUT/)).toBeInTheDocument();
  });

  it('explains deliveries that were followed up before checks were recorded', () => {
    render(<FollowUpChecks followUp={{ status: 'DELIVERED', done: true, checks: 3 }} />);
    expect(screen.getByText(/not recorded for this delivery/i)).toBeInTheDocument();
  });

  it('says when the next check is', () => {
    render(<FollowUpChecks followUp={followUp([check()], { nextCheckAt: '2026-10-22T10:05:00Z' })} />);
    expect(screen.getByText(/Next check/)).toBeInTheDocument();
  });
});
