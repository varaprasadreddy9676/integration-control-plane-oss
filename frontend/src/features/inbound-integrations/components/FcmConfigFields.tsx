import { Divider, Form, Input, Space } from '@/components/common/LegacyAntdControls';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '../../../components/common/LegacyButton';

interface FcmConfigFieldsProps {
  spacing: Record<string, string>;
  httpComplete: boolean;
  onBack: () => void;
  onNext: () => void;
}

export function FcmConfigFields({ spacing, httpComplete, onBack, onNext }: FcmConfigFieldsProps) {
  return (
    <>
      <Form.Item
        name={['communicationConfig', 'fcm', 'projectId']}
        label="Firebase Project ID"
        rules={[{ required: true, message: 'Project ID is required' }]}
        extra="Found in Firebase Console → Project Settings → General → Project ID"
      >
        <Input size="middle" placeholder="my-app-12345" />
      </Form.Item>

      <Form.Item
        name={['communicationConfig', 'fcm', 'clientEmail']}
        label="Service Account Email"
        rules={[
          { required: true, message: 'Service account email is required' },
          { type: 'email', message: 'Must be a valid email' },
        ]}
        extra="From your service account JSON — the client_email field"
      >
        <Input size="middle" placeholder="firebase-adminsdk-xxx@my-app-12345.iam.gserviceaccount.com" />
      </Form.Item>

      <Form.Item
        name={['communicationConfig', 'fcm', 'privateKey']}
        label="Service Account Private Key"
        rules={[{ required: true, message: 'Private key is required' }]}
        extra="From your service account JSON — the private_key field (include the BEGIN/END PRIVATE KEY lines)"
      >
        <Input.TextArea
          rows={5}
          placeholder={'-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...\n-----END PRIVATE KEY-----'}
          className="console-mono-caption"
        />
      </Form.Item>

      <Space direction="vertical" size="small" className="console-margin-top-2">
        <Text type="supporting" size="sm" color="secondary" weight="semibold" display="block">
          Firebase Setup
        </Text>
        <Text type="supporting" size="sm" color="secondary" display="block">
          To get your Firebase service account credentials:
        </Text>
        <ol className="console-indent-5-margin-bottom-2">
          <li>
            Open{' '}
            <a href="https://console.firebase.google.com" target="_blank" rel="noopener noreferrer">
              Firebase Console
            </a>
          </li>
          <li>Project Settings → Service Accounts → Generate new private key</li>
          <li>
            Copy <strong>project_id</strong>, <strong>client_email</strong>, and <strong>private_key</strong> from the
            downloaded JSON
          </li>
        </ol>
        <Text type="supporting" size="sm" color="secondary" display="block">
          <strong>Payload your app must send (device token):</strong>
        </Text>
        <code className="ui-extracted-e8bd2112ae">
          {'{ "token": "<device_fcm_token>", "title": "New Bill", "body": "₹500 due", "data": { "billId": "123" } }'}
        </code>
        <Text type="supporting" size="sm" color="secondary" display="block">
          <strong>Broadcast to all users (topic):</strong>
        </Text>
        <code className="console-caption-block">{'{ "topic": "all-patients", "title": "System Update", "body": "..." }'}</code>
        <Text type="supporting" size="sm" color="secondary" display="block">
          All <code>data</code> values must be strings. Use <code>androidPriority: "high"</code> for time-sensitive
          alerts (default).
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
