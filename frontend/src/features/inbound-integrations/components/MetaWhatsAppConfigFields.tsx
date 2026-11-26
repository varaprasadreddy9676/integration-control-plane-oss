import { Divider, Form, Input } from '@/components/common/LegacyAntdControls';
import type { FormInstance } from '@/components/common/LegacyAntdControls';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { Button } from '../../../components/common/LegacyButton';
import { InlineNotice as Notice } from '../../../components/common';

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

      <Notice
        type="warning"
        icon={<GatewayIcon name="WhatsAppOutlined" />}
        message="Meta Setup Required"
        description={
          <div>
            <p className="console-margin-bottom-2">To get your WhatsApp Cloud API credentials:</p>
            <ol className="console-indent-5-margin-bottom-2">
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
            <p className="console-margin-bottom-1">
              <strong>Payload your app must send:</strong>
            </p>
            <code className="console-type-caption">
              {'{ "to": "+919876543210", "type": "text", "text": "Hello!" }'}
            </code>
            <p className="console-margin-top-2-reset-bottom">
              Use <code>type: "template"</code> with <code>templateName</code> for pre-approved templates. Free-form
              text only works within the 24-hour customer service window.
            </p>
          </div>
        }
      />

      <Divider className="console-margin-y-4" />

      <div className="console-flex-between">
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
