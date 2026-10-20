import { Alert, Button, Divider, Form, Input } from 'antd';
import { BellOutlined } from '@ant-design/icons';

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
        <Input
          size="middle"
          placeholder="firebase-adminsdk-xxx@my-app-12345.iam.gserviceaccount.com"
        />
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
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </Form.Item>

      <Alert
        type="warning"
        showIcon
        icon={<BellOutlined />}
        message="Firebase Setup"
        description={
          <div>
            <p style={{ marginBottom: 8 }}>To get your Firebase service account credentials:</p>
            <ol style={{ paddingLeft: 20, marginBottom: 8 }}>
              <li>
                Open{' '}
                <a href="https://console.firebase.google.com" target="_blank" rel="noopener noreferrer">
                  Firebase Console
                </a>
              </li>
              <li>Project Settings → Service Accounts → Generate new private key</li>
              <li>
                Copy <strong>project_id</strong>, <strong>client_email</strong>, and{' '}
                <strong>private_key</strong> from the downloaded JSON
              </li>
            </ol>
            <p style={{ marginBottom: 4 }}>
              <strong>Payload your app must send (device token):</strong>
            </p>
            <code style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
              {'{ "token": "<device_fcm_token>", "title": "New Bill", "body": "₹500 due", "data": { "billId": "123" } }'}
            </code>
            <p style={{ marginBottom: 4 }}>
              <strong>Broadcast to all users (topic):</strong>
            </p>
            <code style={{ fontSize: 11, display: 'block' }}>
              {'{ "topic": "all-patients", "title": "System Update", "body": "..." }'}
            </code>
            <p style={{ marginTop: 8, marginBottom: 0 }}>
              All <code>data</code> values must be strings. Use <code>androidPriority: "high"</code> for
              time-sensitive alerts (default).
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
