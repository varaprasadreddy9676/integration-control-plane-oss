import { useState } from 'react';
import { Typography } from '@/components/common/LegacyTypography';
import {
  Card,
  Col,
  Collapse,
  Drawer,
  Form,
  Input,
  Modal,
  Row,
  Space,
  Steps,
  Switch,
  message,
  Tooltip,
} from '@/components/common/LegacyAntdControls';
import { Tab, TabList } from '@astryxdesign/core';
import { Banner } from '@astryxdesign/core/Banner';
import { Text as AstryxText } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import type { IntegrationConfig } from '../../../mocks/types';
import { cssVar } from '../../../design-system/utils';
import { copyTextToClipboard } from '../../../utils/clipboard';
import { Button } from '../../../components/common/LegacyButton';
import { InlineHint } from '../../../components/common/InlineHint';
import { StatusBadge } from '../../../components/common/StatusBadge';

const { Text, Title, Paragraph } = Typography;

interface IntegrationSigningSectionProps {
  integration?: IntegrationConfig;
  form: any;
  isCreate: boolean;
  spacing: any;
  colors: any;
  token: any;
  onRotateSecret?: () => Promise<void>;
  onRemoveSecret?: (secret: string) => Promise<void>;
  hideToggle?: boolean;
  showConfigAlways?: boolean;
}

export const IntegrationSigningSection = ({
  integration,
  form,
  isCreate,
  spacing,
  colors,
  token,
  onRotateSecret,
  onRemoveSecret,
  hideToggle = false,
  showConfigAlways = false,
}: IntegrationSigningSectionProps) => {
  const [messageApi, contextHolder] = message.useMessage();
  const [showSecrets, setShowSecrets] = useState<{ [key: string]: boolean }>({});
  const [codeModalOpen, setCodeModalOpen] = useState(false);
  const [activeCodeLanguage, setActiveCodeLanguage] = useState<'javascript' | 'python' | 'php' | 'go'>('javascript');
  const [learnMoreOpen, setLearnMoreOpen] = useState(false);

  const enableSigning = Form.useWatch('enableSigning', form);
  const signingSecret = Form.useWatch('signingSecret', form);
  const signingSecrets = Form.useWatch('signingSecrets', form) || [];

  const copyToClipboard = async (text: string, label: string) => {
    const copied = await copyTextToClipboard(text);
    if (copied) {
      messageApi.success(`${label} copied to clipboard!`);
    } else {
      messageApi.error('Failed to copy to clipboard');
    }
  };

  const maskSecret = (secret: string) => {
    if (!secret) return '';
    const prefix = secret.substring(0, 10);
    return `${prefix}${'•'.repeat(20)}`;
  };

  const toggleSecretVisibility = (secret: string) => {
    setShowSecrets((prev) => ({ ...prev, [secret]: !prev[secret] }));
  };

  // Generate verification code examples
  const generateVerificationCode = (language: 'javascript' | 'python' | 'php' | 'go') => {
    const exampleSecret = signingSecret || 'whsec_<your_signing_secret_here>';

    switch (language) {
      case 'javascript':
        return `// Node.js signature verification
const crypto = require('crypto');

function verifyIntegration(secret, headers, rawBody) {
  const messageId = headers['x-integration-id'];
  const timestamp = headers['x-integration-timestamp'];
  const signature = headers['x-integration-signature'];

  // 1. Validate timestamp (prevent replay attacks)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) {
    throw new Error('Integration timestamp is too old');
  }

  // 2. Extract secret bytes (remove 'whsec_' prefix)
  const secretBytes = Buffer.from(secret.split('_')[1], 'base64');

  // 3. Create signed content: messageId.timestamp.payload
  const signedContent = \`\${messageId}.\${timestamp}.\${rawBody}\`;

  // 4. Compute expected signature
  const expectedSig = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent, 'utf8')
    .digest('base64');

  const expectedSignature = \`v1,\${expectedSig}\`;

  // 5. Compare signatures (support multiple for rotation)
  const signatures = signature.split(' ');
  const isValid = signatures.some(sig => sig === expectedSignature);

  if (!isValid) {
    throw new Error('Invalid integration signature');
  }

  return true;
}

// Example usage:
const secret = '${exampleSecret}';
const isValid = verifyIntegration(secret, req.headers, req.body);`;

      case 'python':
        return `# Python signature verification
import hmac
import hashlib
import base64
import time

def verify_integration(secret, headers, raw_body):
    message_id = headers.get('x-integration-id')
    timestamp = headers.get('x-integration-timestamp')
    signature = headers.get('x-integration-signature')

    # 1. Validate timestamp (prevent replay attacks)
    now = int(time.time())
    if abs(now - int(timestamp)) > 300:
        raise ValueError('Integration timestamp is too old')

    # 2. Extract secret bytes (remove 'whsec_' prefix)
    secret_bytes = base64.b64decode(secret.split('_')[1])

    # 3. Create signed content: messageId.timestamp.payload
    signed_content = f"{message_id}.{timestamp}.{raw_body}"

    # 4. Compute expected signature
    expected_sig = base64.b64encode(
        hmac.new(secret_bytes, signed_content.encode(), hashlib.sha256).digest()
    ).decode()

    expected_signature = f"v1,{expected_sig}"

    # 5. Compare signatures (support multiple for rotation)
    signatures = signature.split(' ')
    is_valid = expected_signature in signatures

    if not is_valid:
        raise ValueError('Invalid integration signature')

    return True

# Example usage:
secret = '${exampleSecret}'
is_valid = verify_integration(secret, request.headers, request.data)`;

      case 'php':
        return `<?php
// PHP signature verification
function verifyIntegration($secret, $headers, $rawBody) {
    $messageId = $headers['x-integration-id'];
    $timestamp = $headers['x-integration-timestamp'];
    $signature = $headers['x-integration-signature'];

    // 1. Validate timestamp (prevent replay attacks)
    $now = time();
    if (abs($now - intval($timestamp)) > 300) {
        throw new Exception('Integration timestamp is too old');
    }

    // 2. Extract secret bytes (remove 'whsec_' prefix)
    $secretBytes = base64_decode(explode('_', $secret)[1]);

    // 3. Create signed content: messageId.timestamp.payload
    $signedContent = "$messageId.$timestamp.$rawBody";

    // 4. Compute expected signature
    $expectedSig = base64_encode(
        hash_hmac('sha256', $signedContent, $secretBytes, true)
    );

    $expectedSignature = "v1,$expectedSig";

    // 5. Compare signatures (support multiple for rotation)
    $signatures = explode(' ', $signature);
    $isValid = in_array($expectedSignature, $signatures);

    if (!$isValid) {
        throw new Exception('Invalid integration signature');
    }

    return true;
}

// Example usage:
$secret = '${exampleSecret}';
$isValid = verifyIntegration($secret, getallheaders(), file_get_contents('php://input'));
?>`;

      case 'go':
        return `// Go signature verification
package main

import (
    "crypto/hmac"
    "crypto/sha256"
    "encoding/base64"
    "errors"
    "fmt"
    "strconv"
    "strings"
    "time"
)

func VerifyIntegration(secret string, headers map[string]string, rawBody string) error {
    messageID := headers["X-Integration-ID"]
    timestamp := headers["X-Integration-Timestamp"]
    signature := headers["X-Integration-Signature"]

    // 1. Validate timestamp (prevent replay attacks)
    ts, _ := strconv.ParseInt(timestamp, 10, 64)
    now := time.Now().Unix()
    if abs(now-ts) > 300 {
        return errors.New("integration timestamp is too old")
    }

    // 2. Extract secret bytes (remove 'whsec_' prefix)
    parts := strings.Split(secret, "_")
    secretBytes, _ := base64.StdEncoding.DecodeString(parts[1])

    // 3. Create signed content: messageId.timestamp.payload
    signedContent := fmt.Sprintf("%s.%s.%s", messageID, timestamp, rawBody)

    // 4. Compute expected signature
    mac := hmac.New(sha256.New, secretBytes)
    mac.Write([]byte(signedContent))
    expectedSig := base64.StdEncoding.EncodeToString(mac.Sum(nil))
    expectedSignature := fmt.Sprintf("v1,%s", expectedSig)

    // 5. Compare signatures (support multiple for rotation)
    signatures := strings.Split(signature, " ")
    for _, sig := range signatures {
        if sig == expectedSignature {
            return nil
        }
    }

    return errors.New("invalid integration signature")
}

func abs(x int64) int64 {
    if x < 0 {
        return -x
    }
    return x
}

// Example usage:
secret := "${exampleSecret}"
err := VerifyIntegration(secret, headers, requestBody)`;

      default:
        return '';
    }
  };

  return (
    <>
      {contextHolder}

      <Row gutter={[16, 16]}>
        <Col xs={24}>
          <Space direction="vertical" size="small" className="console-width-full">
            <AstryxText as="p" display="block" type="supporting">
              Integration signing adds a cryptographic HMAC-SHA256 signature to each delivery so receivers can verify
              authenticity and payload integrity.
            </AstryxText>
            <Space>
              <Button icon={<GatewayIcon name="BookOutlined" />} onClick={() => setLearnMoreOpen(true)}>
                Learn More &amp; Setup Guide
              </Button>
              <Button type="link" icon={<GatewayIcon name="CodeOutlined" />} onClick={() => setCodeModalOpen(true)}>
                View Code Examples
              </Button>
            </Space>
          </Space>
        </Col>

        {/* Enable Signing Toggle - Only show if not hidden */}
        {!hideToggle && (
          <Col xs={24}>
            <Form.Item
              name="enableSigning"
              label={
                <Space>
                  <Text strong>Enable Integration Signing</Text>
                  <Tooltip title="Recommended for production systems with sensitive data">
                    <GatewayIcon name="InfoCircleOutlined" className="console-text-secondary" />
                  </Tooltip>
                </Space>
              }
              valuePropName="checked"
              extra={
                <Space direction="vertical" size={0}>
                  <Text type="secondary">
                    {enableSigning
                      ? '✓ Signatures will be added to all integration deliveries'
                      : 'Integrations will be sent without signatures (less secure)'}
                  </Text>
                  <AstryxText type="supporting" display="block">
                    Recommended for production, sensitive or regulated data, and public endpoints; optional for local
                    development and testing.
                  </AstryxText>
                  {!enableSigning && (
                    <Text type="warning" className="console-type-caption">
                      Not recommended for production systems handling sensitive or regulated data
                    </Text>
                  )}
                </Space>
              }
            >
              <Switch />
            </Form.Item>
          </Col>
        )}

        {(enableSigning || showConfigAlways) && (
          <>
            {/* No Secrets Yet - Show Info Message */}
            {!signingSecret && (
              <Col xs={24}>
                <InlineHint>
                  {isCreate
                    ? 'A signing secret will be generated when you save.'
                    : 'Save to generate a signing secret for verification.'}
                </InlineHint>
              </Col>
            )}

            {/* Current Signing Secret */}
            {signingSecret && (
              <Col xs={24}>
                <div className="signing-secret-panel">
                  <Space direction="vertical" className="console-width-full" size="small">
                    <Space>
                      <GatewayIcon name="KeyOutlined" className="console-text-accent" />
                      <Text strong>Current Signing Secret</Text>
                      <StatusBadge status="ACTIVE" label="Active" variant="success" />
                    </Space>

                    <Input
                      value={showSecrets[signingSecret] ? signingSecret : maskSecret(signingSecret)}
                      readOnly
                      addonAfter={
                        <Space size="small">
                          <Button
                            type="text"
                            size="small"
                            icon={
                              showSecrets[signingSecret] ? (
                                <GatewayIcon name="EyeInvisibleOutlined" />
                              ) : (
                                <GatewayIcon name="EyeOutlined" />
                              )
                            }
                            onClick={() => toggleSecretVisibility(signingSecret)}
                          />
                          <Button
                            type="text"
                            size="small"
                            icon={<GatewayIcon name="CopyOutlined" />}
                            onClick={() => copyToClipboard(signingSecret, 'Signing secret')}
                          />
                        </Space>
                      }
                    />
                    <Text type="secondary" className="console-type-caption">
                      Keep this secret secure. You'll need it to verify integration signatures.
                    </Text>
                  </Space>
                </div>
              </Col>
            )}

            {/* Secret Rotation Section */}
            {!isCreate && signingSecrets.length > 0 && (
              <Col xs={24}>
                <div className="signing-secret-panel">
                  <Space direction="vertical" className="console-width-full" size="middle">
                    <div className="console-flex-between-center">
                      <Space>
                        <Text strong>Secret Rotation</Text>
                        <Text type="secondary">
                          {signingSecrets.length} active secret{signingSecrets.length > 1 ? 's' : ''}
                        </Text>
                      </Space>
                      {onRotateSecret && (
                        <Button
                          icon={<GatewayIcon name="PlusOutlined" />}
                          onClick={onRotateSecret}
                          disabled={signingSecrets.length >= 3}
                        >
                          Add New Secret
                        </Button>
                      )}
                    </div>

                    {signingSecrets.length > 1 && (
                      <Banner
                        status="warning"
                        title="Multiple signing secrets are active"
                        description={`${signingSecrets.length} secrets are currently used for signing. Remove old ones after receivers have been updated.`}
                      />
                    )}

                    <Space direction="vertical" className="console-width-full">
                      {signingSecrets.map((secret: string, index: number) => (
                        <div key={secret} className="signing-secret-row" data-current={secret === signingSecret}>
                          <Input
                            value={showSecrets[secret] ? secret : maskSecret(secret)}
                            readOnly
                            className="console-flex-fill"
                          />
                          <Button
                            type="text"
                            size="small"
                            icon={
                              showSecrets[secret] ? (
                                <GatewayIcon name="EyeInvisibleOutlined" />
                              ) : (
                                <GatewayIcon name="EyeOutlined" />
                              )
                            }
                            onClick={() => toggleSecretVisibility(secret)}
                          />
                          <Button
                            type="text"
                            size="small"
                            icon={<GatewayIcon name="CopyOutlined" />}
                            onClick={() => copyToClipboard(secret, 'Secret')}
                          />
                          {signingSecrets.length > 1 && secret !== signingSecret && onRemoveSecret && (
                            <Button
                              type="text"
                              size="small"
                              danger
                              icon={<GatewayIcon name="DeleteOutlined" />}
                              onClick={() => onRemoveSecret(secret)}
                            />
                          )}
                          {secret === signingSecret && (
                            <StatusBadge status="ACTIVE" label="Primary" variant="success" />
                          )}
                        </div>
                      ))}
                    </Space>

                    <Text type="secondary" className="console-type-caption">
                      <GatewayIcon name="InfoCircleOutlined" className="console-margin-right-1" />
                      Zero-downtime rotation: Add a new secret, update your receivers, then remove the old secret.
                    </Text>
                  </Space>
                </div>
              </Col>
            )}

            {/* Verification Code Button */}
            <Col xs={24}>
              <Button
                icon={<GatewayIcon name="CodeOutlined" />}
                onClick={() => setCodeModalOpen(true)}
                block
                size="middle"
              >
                View Verification Code Examples
              </Button>
            </Col>

            {/* Important Information - Collapsible */}
            <Col xs={24}>
              <Collapse
                items={[
                  {
                    key: 'critical-warning',
                    label: <Text strong>⚠️ CRITICAL: Remote System Must Implement Verification</Text>,
                    children: (
                      <Space direction="vertical" size="small" className="console-width-full">
                        <Paragraph className="console-margin-bottom-2">
                          <strong>Enabling signing alone does NOT secure your integrations!</strong> Your receiving
                          system MUST implement signature verification, or this provides zero security benefit.
                        </Paragraph>
                        <div>
                          <Text strong>Before enabling, ensure your remote team has:</Text>
                          <ul className="signing-instructions-list">
                            <li>Implemented verification code (see "Code Examples" above)</li>
                            <li>Received and stored the signing secret securely</li>
                            <li>Tested signature verification in their staging environment</li>
                            <li>Deployed verification to production</li>
                          </ul>
                        </div>
                        <Banner
                          status="warning"
                          title="The receiving system must verify signatures to reject forged requests."
                        />
                      </Space>
                    ),
                  },
                  {
                    key: 'headers-info',
                    label: <Text strong>Signature Headers Information</Text>,
                    children: (
                      <>
                        <Paragraph className="console-margin-bottom-2">
                          Your integrations will include three signature headers:
                        </Paragraph>
                        <ul className="signing-instructions-list signing-instructions-list--compact">
                          <li>
                            <code>X-Integration-Signature</code>: HMAC-SHA256 signature
                          </li>
                          <li>
                            <code>X-Integration-Timestamp</code>: Unix timestamp (replay protection)
                          </li>
                          <li>
                            <code>X-Integration-ID</code>: Unique message identifier
                          </li>
                        </ul>
                      </>
                    ),
                  },
                ]}
                className="console-margin-top-4"
              />
            </Col>
          </>
        )}
      </Row>

      {/* Learn More Drawer - Comprehensive Setup Guide */}
      <Drawer
        title={
          <Space>
            <GatewayIcon name="BookOutlined" />
            <span>Integration Signing - Complete Guide</span>
          </Space>
        }
        open={learnMoreOpen}
        onClose={() => setLearnMoreOpen(false)}
        width={720}
      >
        <Space direction="vertical" size="middle" className="console-width-full">
          {/* How It Works */}
          <div>
            <Title level={4}>
              <GatewayIcon name="SafetyOutlined" /> How It Works
            </Title>
            <Paragraph>
              When you enable integration signing, every integration delivery includes three special headers:
            </Paragraph>
            <Card size="small" className="console-bg-subtle">
              <Space direction="vertical" className="console-width-full">
                <div>
                  <code className="console-text-accent">X-Integration-Signature</code>
                  <Text type="secondary" className="console-margin-left-2">
                    HMAC-SHA256 cryptographic signature
                  </Text>
                </div>
                <div>
                  <code className="console-text-accent">X-Integration-Timestamp</code>
                  <Text type="secondary" className="console-margin-left-2">
                    Unix timestamp (prevents replay attacks)
                  </Text>
                </div>
                <div>
                  <code className="console-text-accent">X-Integration-ID</code>
                  <Text type="secondary" className="console-margin-left-2">
                    Unique message identifier (UUID)
                  </Text>
                </div>
              </Space>
            </Card>
          </div>

          {/* Setup Steps */}
          <div>
            <Title level={4}>
              <GatewayIcon name="CheckCircleOutlined" /> Setup Steps
            </Title>
            <Steps
              direction="vertical"
              current={-1}
              items={[
                {
                  title: 'Enable Signing',
                  description: 'Toggle "Enable Integration Signing" on this page',
                  icon: <GatewayIcon name="SafetyOutlined" />,
                },
                {
                  title: 'Copy Signing Secret',
                  description: 'Copy the generated signing secret (starts with whsec_)',
                  icon: <GatewayIcon name="KeyOutlined" />,
                },
                {
                  title: 'Add Verification Code',
                  description: 'Add verification code to your integration receiver (see Code Examples)',
                  icon: <GatewayIcon name="CodeOutlined" />,
                },
                {
                  title: 'Test Integration',
                  description: 'Use the "Test Integration" button to verify signatures are working',
                  icon: <GatewayIcon name="BugOutlined" />,
                },
                {
                  title: 'Deploy to Production',
                  description: 'Once tested, your integrations are now securely signed!',
                  icon: <GatewayIcon name="CheckCircleOutlined" />,
                },
              ]}
            />
          </div>

          {/* Real-World Scenarios */}
          <div>
            <Title level={4}>
              <GatewayIcon name="WarningOutlined" /> Real-World Attack Scenarios (Why You Need This)
            </Title>
            <Collapse
              items={[
                {
                  key: '1',
                  label: '🎭 Impersonation Attack',
                  children: (
                    <div>
                      <Paragraph>
                        <strong>Without Signing:</strong> An attacker sends a fake integration pretending to be from
                        your source system, injecting false patient data into your system.
                      </Paragraph>
                      <Paragraph type="success">
                        <strong>With Signing:</strong> Your system verifies the signature, detects it's fake, and
                        rejects it immediately.
                      </Paragraph>
                    </div>
                  ),
                },
                {
                  key: '2',
                  label: '✂️ Man-in-the-Middle Tampering',
                  children: (
                    <div>
                      <Paragraph>
                        <strong>Without Signing:</strong> An attacker intercepts a integration, changes the billing
                        amount from $100 to $1000, and forwards it to your system.
                      </Paragraph>
                      <Paragraph type="success">
                        <strong>With Signing:</strong> The signature won't match the tampered data, so your system
                        rejects it.
                      </Paragraph>
                    </div>
                  ),
                },
                {
                  key: '3',
                  label: '🔁 Replay Attack',
                  children: (
                    <div>
                      <Paragraph>
                        <strong>Without Signing:</strong> An attacker captures a valid integration (e.g., "charge
                        patient $50") and replays it 100 times.
                      </Paragraph>
                      <Paragraph type="success">
                        <strong>With Signing:</strong> Timestamp validation detects the integration is old (&gt; 5
                        minutes) and rejects replays.
                      </Paragraph>
                    </div>
                  ),
                },
                {
                  key: '4',
                  label: '🏥 HIPAA Compliance',
                  children: (
                    <div>
                      <Paragraph>
                        <strong>Audit Requirement:</strong> "How do you ensure integration data hasn't been tampered
                        with?"
                      </Paragraph>
                      <Paragraph type="success">
                        <strong>Your Answer:</strong> "We use cryptographic signatures (HMAC-SHA256) to verify integrity
                        and authenticity of all integration deliveries."
                      </Paragraph>
                    </div>
                  ),
                },
              ]}
            />
          </div>

          {/* Secret Rotation Guide */}
          <div>
            <Title level={4}>
              <GatewayIcon name="ClockCircleOutlined" /> Zero-Downtime Secret Rotation
            </Title>
            <Paragraph>When you need to rotate your signing secret (security best practice every 90 days):</Paragraph>
            <ol>
              <li>Click "Add New Secret" - a new secret is generated</li>
              <li>Both old and new secrets are now active (integrations signed with both)</li>
              <li>Update your integration receiver to use the new secret</li>
              <li>Test that verification works with the new secret</li>
              <li>Remove the old secret once you've confirmed the new one works</li>
            </ol>
            <InlineHint tone="success">No downtime: both secrets remain active while receivers are updated.</InlineHint>
          </div>

          {/* Technical Details */}
          <div>
            <Title level={4}>
              <GatewayIcon name="CodeOutlined" /> Technical Details
            </Title>
            <Collapse
              items={[
                {
                  key: 'algorithm',
                  label: 'Signing Algorithm',
                  children: (
                    <div>
                      <Paragraph>
                        <strong>Algorithm:</strong> HMAC-SHA256 (Hash-based Message Authentication Code with SHA-256)
                      </Paragraph>
                      <Paragraph>
                        <strong>Signed Content:</strong> <code>messageId.timestamp.payload</code>
                      </Paragraph>
                      <Paragraph>
                        <strong>Format:</strong> <code>v1,&lt;base64_signature&gt;</code>
                      </Paragraph>
                      <Paragraph type="secondary">
                        Used by: Stripe, GitHub, Shopify, Twilio, and most modern integration providers
                      </Paragraph>
                    </div>
                  ),
                },
                {
                  key: 'security',
                  label: 'Security Features',
                  children: (
                    <ul>
                      <li>
                        <strong>256-bit entropy:</strong> Signing secrets are 32 bytes of cryptographically secure
                        random data
                      </li>
                      <li>
                        <strong>Per-endpoint secrets:</strong> Each integration gets a unique secret (not shared)
                      </li>
                      <li>
                        <strong>Replay protection:</strong> 5-minute timestamp tolerance window
                      </li>
                      <li>
                        <strong>Constant-time comparison:</strong> Prevents timing attacks
                      </li>
                      <li>
                        <strong>Multiple active secrets:</strong> Supports up to 3 concurrent secrets for rotation
                      </li>
                    </ul>
                  ),
                },
              ]}
            />
          </div>

          {/* Quick Reference */}
          <div>
            <Title level={4}>Quick Reference</Title>
            <Card size="small" className="console-bg-subtle">
              <Space direction="vertical" className="console-width-full" size="small">
                <div>
                  <Text strong>Secret Format:</Text> <code>whsec_&lt;32_bytes_base64&gt;</code>
                </div>
                <div>
                  <Text strong>Signature Format:</Text> <code>v1,&lt;hmac_sha256_base64&gt;</code>
                </div>
                <div>
                  <Text strong>Replay Window:</Text> 5 minutes (300 seconds)
                </div>
                <div>
                  <Text strong>Max Secrets:</Text> 3 concurrent (for rotation)
                </div>
              </Space>
            </Card>
          </div>
        </Space>
      </Drawer>

      {/* Verification Code Modal */}
      <Modal
        title="Integration Signature Verification"
        open={codeModalOpen}
        onCancel={() => setCodeModalOpen(false)}
        footer={null}
        width={800}
      >
        <TabList
          role="tablist"
          aria-label="Verification code language"
          value={activeCodeLanguage}
          onChange={(language) => setActiveCodeLanguage(language as typeof activeCodeLanguage)}
          hasDivider
        >
          <Tab
            id="verification-code-javascript-tab"
            value="javascript"
            label="Node.js"
            panelId="verification-code-javascript"
          />
          <Tab id="verification-code-python-tab" value="python" label="Python" panelId="verification-code-python" />
          <Tab id="verification-code-php-tab" value="php" label="PHP" panelId="verification-code-php" />
          <Tab id="verification-code-go-tab" value="go" label="Go" panelId="verification-code-go" />
        </TabList>
        {(['javascript', 'python', 'php', 'go'] as const).map((language) => (
          <div
            key={language}
            id={`verification-code-${language}`}
            role="tabpanel"
            aria-labelledby={`verification-code-${language}-tab`}
            hidden={activeCodeLanguage !== language}
            tabIndex={0}
          >
            <div className="console-position-relative">
              <Button
                icon={<GatewayIcon name="CopyOutlined" />}
                onClick={() => copyToClipboard(generateVerificationCode(language), 'Code')}
                className="console-overlay-copy-action"
              >
                Copy
              </Button>
              <pre className="signing-verification-code">
                <code>{generateVerificationCode(language)}</code>
              </pre>
            </div>
          </div>
        ))}
      </Modal>
    </>
  );
};

// Helper function to add alpha transparency to hex/rgb colors
function withAlpha(color: string, alpha: number): string {
  // For now, just use the color directly - Ant Design colors work fine
  // In production, you might want to convert hex to rgba
  return color;
}
