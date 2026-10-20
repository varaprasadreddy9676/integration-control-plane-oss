import { Alert, Button, Divider, Form, Input } from 'antd';
import type { FormInstance } from 'antd';
import { WhatsAppOutlined } from '@ant-design/icons';

interface MetaWhatsAppConfigFieldsProps {
  spacing: Record<string, string>;
  httpComplete: boolean;
  onBack: () => void;
  onNext: () => void;
}

export function MetaWhatsAppConfigFields({ spacing, httpComplete, onBack, onNext }: MetaWhatsAppConfigFieldsProps) {
  return (
    <>
      <Form.Item
        name={['communicationConfig', 'meta', 'phoneNumberId']}
        label="Phone Number ID"
        rules={[{ required: true, message: 'Phone Number ID is required' }]}
        extra="Found in Meta Business Manager → WhatsApp → API Setup → Phone Number ID"
      >
        <Input size="middle" placeholder="123456789012345" />
      </Form.Item>

      <Form.Item
        name={['communicationConfig', 'meta', 'accessToken']}
        label="Access Token"
        rules={[{ required: true, message: 'Access token is required' }]}
        extra="Permanent system user access token from Meta Business Manager"
      >
        <Input.Password size="middle" placeholder="EAAxxxxxxxxxx..." />
      </Form.Item>

      <Alert
        type="warning"
        showIcon
        icon={<WhatsAppOutlined />}
        message="Meta Setup Required"
        description={
          <div>
            <p style={{ marginBottom: 8 }}>To get your WhatsApp Cloud API credentials:</p>
            <ol style={{ paddingLeft: 20, marginBottom: 8 }}>
              <li>
                Go to{' '}
                <a href="https://business.facebook.com" target="_blank" rel="noopener noreferrer">
                  Meta Business Manager
                </a>
              </li>
              <li>Navigate to WhatsApp → API Setup</li>
              <li>
                Copy the <strong>Phone Number ID</strong> (not the phone number itself)
              </li>
              <li>
                Create a <strong>System User</strong> with WhatsApp permissions and generate a permanent token
              </li>
            </ol>
            <p style={{ marginBottom: 4 }}>
              <strong>Payload your app must send:</strong>
            </p>
            <code style={{ fontSize: 11 }}>
              {'{ "to": "+919876543210", "type": "text", "text": "Hello!" }'}
            </code>
            <p style={{ marginTop: 8, marginBottom: 0 }}>
              Use <code>type: "template"</code> with <code>templateName</code> for pre-approved templates.
              Free-form text only works within the 24-hour customer service window.
            </p>
          </div>
        }
      />

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
