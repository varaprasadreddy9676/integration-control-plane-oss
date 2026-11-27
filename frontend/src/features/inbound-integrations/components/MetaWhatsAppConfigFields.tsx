import { Divider, Form, Input, Space } from '@/components/common/LegacyAntdControls';
import type { FormInstance } from '@/components/common/LegacyAntdControls';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '../../../components/common/LegacyButton';

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

      <Space direction="vertical" size="small" className="console-margin-top-2">
        <Text type="supporting" size="sm" color="secondary" weight="semibold" display="block">
          Meta Setup Required
        </Text>
        <Text type="supporting" size="sm" color="secondary" display="block">
          To get your WhatsApp Cloud API credentials:
        </Text>
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
        <Text type="supporting" size="sm" color="secondary" display="block">
          <strong>Payload your app must send:</strong>
        </Text>
        <code className="console-type-caption">{'{ "to": "+919876543210", "type": "text", "text": "Hello!" }'}</code>
        <Text type="supporting" size="sm" color="secondary" display="block">
          Use <code>type: "template"</code> with <code>templateName</code> for pre-approved templates. Free-form text
          only works within the 24-hour customer service window.
        </Text>
      </Space>

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
