/**
 * SmsConfigFields — plug-and-play SMS provider configuration
 *
 * Adding a new SMS vendor:
 *   1. Add a <Select.Option value="NEW_VENDOR"> to the provider select below
 *   2. Add a config block in the switch inside the provider-specific fields section
 *   3. Register the adapter in backend/src/services/communication/bootstrap.js
 *
 * Config is stored at communicationConfig.msg91.*, communicationConfig.twilio.*, etc.
 * (same flat pattern as .meta.*, .fcm.*) so the delivery engine normalizes it automatically.
 */

import { Alert, Button, Divider, Form, Input, Select, Space, Tag } from 'antd';
import { MessageOutlined } from '@ant-design/icons';

interface SmsConfigFieldsProps {
  spacing: Record<string, string>;
  httpComplete: boolean;
  smsProvider: string | undefined;
  onBack: () => void;
  onNext: () => void;
}

// ─── Provider metadata — extend this list as new vendors are added ──────────
const SMS_PROVIDERS: Array<{
  value: string;
  label: string;
  badge?: string;
  disabled?: boolean;
}> = [
  { value: 'MSG91', label: 'MSG91', badge: 'India · DLT compliant' },
  { value: 'TWILIO', label: 'Twilio', badge: 'Coming Soon', disabled: true },
  { value: 'EXOTEL', label: 'Exotel', badge: 'Coming Soon', disabled: true },
];

export function SmsConfigFields({
  spacing,
  httpComplete,
  smsProvider,
  onBack,
  onNext,
}: SmsConfigFieldsProps) {
  return (
    <>
      {/* ── Provider selector ───────────────────────────────────────────── */}
      <Form.Item
        name={['communicationConfig', 'provider']}
        label="SMS Provider"
        rules={[{ required: true, message: 'Provider is required' }]}
        extra="Select the SMS gateway you have an account with"
      >
        <Select size="middle" placeholder="Select SMS provider">
          {SMS_PROVIDERS.map(({ value, label, badge, disabled }) => (
            <Select.Option key={value} value={value} disabled={disabled}>
              <Space>
                <MessageOutlined />
                {label}
                {badge && (
                  <Tag color={disabled ? 'default' : 'blue'} style={{ fontSize: 11 }}>
                    {badge}
                  </Tag>
                )}
              </Space>
            </Select.Option>
          ))}
        </Select>
      </Form.Item>

      {/* ── Provider-specific config fields ─────────────────────────────── */}
      {smsProvider === 'MSG91' && <Msg91Fields />}

      {/* Future: {smsProvider === 'TWILIO' && <TwilioFields />} */}

      <Divider style={{ margin: `${spacing[4]} 0` }} />

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button size="middle" onClick={onBack}>
          Back to Basic Info
        </Button>
        <Button type="primary" size="middle" onClick={onNext} disabled={!httpComplete}>
          Continue to Request Policy
        </Button>
      </div>
    </>
  );
}

// ─── MSG91 fields ────────────────────────────────────────────────────────────

function Msg91Fields() {
  return (
    <>
      <Form.Item
        name={['communicationConfig', 'msg91', 'authKey']}
        label="Auth Key"
        rules={[{ required: true, message: 'Auth Key is required' }]}
        extra="Found in MSG91 dashboard → API → Auth Key"
      >
        <Input.Password size="middle" placeholder="xxxxxxxxxxxxxxxxxxxxxxxx" />
      </Form.Item>

      <Form.Item
        name={['communicationConfig', 'msg91', 'senderId']}
        label="Sender ID"
        rules={[
          { required: true, message: 'Sender ID is required' },
          { len: 6, message: 'Sender ID must be exactly 6 characters' },
        ]}
        extra="6-character alphanumeric sender name approved in DLT portal (e.g. SENDER)"
      >
        <Input size="middle" placeholder="SENDER" maxLength={6} style={{ textTransform: 'uppercase' }} />
      </Form.Item>

      <Form.Item
        name={['communicationConfig', 'msg91', 'route']}
        label="Route"
        initialValue="4"
        extra="Transactional (4) for OTP/alerts. Promotional (1) for marketing — requires opt-in."
      >
        <Select size="middle">
          <Select.Option value="4">4 — Transactional (OTP, alerts, bills)</Select.Option>
          <Select.Option value="1">1 — Promotional (marketing)</Select.Option>
        </Select>
      </Form.Item>

      <Form.Item
        name={['communicationConfig', 'msg91', 'country']}
        label="Default Country Code"
        initialValue="91"
        extra="Prepended to bare 10-digit numbers. E.g. 91 for India."
      >
        <Input size="middle" placeholder="91" style={{ maxWidth: 120 }} />
      </Form.Item>

      <Alert
        type="info"
        showIcon
        icon={<MessageOutlined />}
        message="MSG91 Setup"
        style={{ marginTop: 8 }}
        description={
          <div>
            <p style={{ marginBottom: 8 }}>To get your MSG91 credentials:</p>
            <ol style={{ paddingLeft: 20, marginBottom: 8 }}>
              <li>
                Log in to{' '}
                <a href="https://msg91.com" target="_blank" rel="noopener noreferrer">
                  msg91.com
                </a>
              </li>
              <li>Go to <strong>API</strong> → copy your <strong>Auth Key</strong></li>
              <li>Register a <strong>Sender ID</strong> in your DLT portal (TRAI compliance)</li>
              <li>For template SMS: create a flow in <strong>Campaign → Flow</strong> and copy the <strong>Template ID</strong></li>
            </ol>
            <p style={{ marginBottom: 4 }}>
              <strong>Payload your app must send (plain text):</strong>
            </p>
            <code style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
              {'{ "to": "919876543210", "message": "Your OTP is 4321. Valid for 10 mins." }'}
            </code>
            <p style={{ marginBottom: 4 }}>
              <strong>Template-based (DLT-compliant, recommended):</strong>
            </p>
            <code style={{ fontSize: 11, display: 'block' }}>
              {'{ "to": "919876543210", "templateId": "your_flow_id", "variables": { "VAR1": "4321", "VAR2": "10" } }'}
            </code>
            <p style={{ marginTop: 8, marginBottom: 0 }}>
              Multiple recipients: pass <code>to</code> as an array:{' '}
              <code>["919876543210", "918888888888"]</code>
            </p>
          </div>
        }
      />
    </>
  );
}
