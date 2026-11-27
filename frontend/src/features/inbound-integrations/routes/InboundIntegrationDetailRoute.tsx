import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Typography } from '@/components/common/LegacyTypography';
import { RevealCredentialsButton } from '../../../components/common/RevealCredentialsButton';
import { IntegrationHistoryButton } from '../../integration-history';
import { useLocation, useParams } from 'react-router-dom';
import { useNavigateWithParams } from '../../../utils/navigation';
import { useTenant } from '../../../app/tenant-context';
import { useUnsavedChangesWarning } from '../../../hooks/useUnsavedChangesWarning';
import {
  Form,
  Space,
  Input,
  Divider,
  Dropdown,
  Switch,
  Modal,
  App,
  Collapse,
  Badge,
  Tooltip,
  Select,
  Radio,
} from '@/components/common/LegacyAntdControls';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Editor from '@monaco-editor/react';
import { cssVar, editorFontSize, useDesignTokens, withAlpha } from '../../../design-system/utils';
import { useThemeMode } from '../../../app/theme-provider';
import { MetaWhatsAppConfigFields } from '../components/MetaWhatsAppConfigFields';
import { FcmConfigFields } from '../components/FcmConfigFields';
import { SmsConfigFields } from '../components/SmsConfigFields';
import { DeliveryTab } from '../../stages/components/delivery-tab/DeliveryTab';
import { protocolOf } from '../../stages/deliveryTargets';
import type { StepEditors } from '../../stages/canvas/stepEditors';
import {
  getInboundIntegration,
  createInboundIntegration,
  updateInboundIntegration,
  getUIConfig,
  testInboundRuntime,
  listSenderProfiles,
  getInboundIntegrationCredentials,
  getApiBaseUrl,
} from '../../../services/api';
import { PageHeader } from '../../../components/common/PageHeader';
import { PageTemplate } from '../../../components/common/PageTemplate';
import { ConfigSection } from '../../../components/common/ConfigSection';
import { ConfigGrid } from '../../../components/common/ConfigGrid';
import { ConfigFieldHelp } from '../../../components/common/ConfigFieldHelp';
import { InlineHint } from '../../../components/common/InlineHint';
import { AuthenticationFields, HttpConfigFields } from '../../../shared/integration-forms';
import { FormItemRadioGroup } from '../../../shared/forms/FormItemControls';
import { RequestPolicySection } from '../../integrations/components/detail/RequestPolicySection';
import { copyTextToClipboard } from '../../../utils/clipboard';
import { Button } from '../../../components/common/LegacyButton';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Banner } from '@astryxdesign/core/Banner';

const { Text, Paragraph } = Typography;

type InboundTabItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  forceRender?: boolean;
  title?: string;
  children?: ReactNode;
};

function InboundIntegrationTabs({
  items,
  activeKey,
  onChange,
}: {
  items: InboundTabItem[];
  activeKey: string;
  onChange: (key: string) => void;
}) {
  const [visitedKeys, setVisitedKeys] = useState(() => new Set([activeKey]));
  const selectedKey =
    items.find((item) => item.key === activeKey && !item.disabled)?.key ??
    items.find((item) => !item.disabled)?.key ??
    '';

  useEffect(() => {
    if (selectedKey && selectedKey !== activeKey) onChange(selectedKey);
    if (selectedKey) setVisitedKeys((current) => new Set(current).add(selectedKey));
  }, [activeKey, onChange, selectedKey]);

  const selectTab = (key: string) => {
    setVisitedKeys((current) => new Set(current).add(key));
    onChange(key);
  };

  return (
    <>
      <div className="inbound-integration-tabs">
        <TabList
          aria-label="Inbound integration configuration"
          className="inbound-integration-tab-list"
          hasDivider
          onChange={selectTab}
          overflow="auto"
          role="tablist"
          size="sm"
          value={selectedKey}
        >
          {items.map((item) => (
            <Tab
              aria-disabled={item.disabled}
              icon={item.icon}
              id={`inbound-tab-${item.key}`}
              key={item.key}
              label={item.label}
              aria-label={item.label}
              panelId={`inbound-panel-${item.key}`}
              value={item.key}
            />
          ))}
        </TabList>
      </div>
      <div className="inbound-integration-tab-panels">
        {items.map((item) => {
          const isActive = item.key === selectedKey;
          const shouldRender = isActive || item.forceRender || visitedKeys.has(item.key);
          return (
            <section
              aria-labelledby={`inbound-tab-${item.key}`}
              className="inbound-integration-tab-panel"
              hidden={!isActive}
              id={`inbound-panel-${item.key}`}
              key={item.key}
              role="tabpanel"
              tabIndex={isActive ? 0 : -1}
            >
              {shouldRender ? item.children : null}
            </section>
          );
        })}
      </div>
    </>
  );
}

export const InboundIntegrationDetailRoute = () => {
  // The name the list passed along, shown until the record loads (title morph target).
  const passedTitle = (useLocation().state as { title?: string } | null)?.title;
  const { id } = useParams();
  const navigate = useNavigateWithParams();
  const queryClient = useQueryClient();
  const { spacing } = useDesignTokens();
  const { mode } = useThemeMode();
  const colors = cssVar.legacy;
  const { message: messageApi, modal } = App.useApp();
  const { orgId } = useTenant();
  const isCreate = !id || id === 'new';

  const [form] = Form.useForm();
  const [isSaving, setIsSaving] = useState(false);
  // This form is long enough that losing it to a stray refresh or a mis-clicked
  // Cancel is a real cost. Cancel now asks first, and the browser warns on exit.
  const hasUnsavedChanges = () => form.isFieldsTouched();
  const [requestTransformEnabled, setRequestTransformEnabled] = useState(false);
  const [responseTransformEnabled, setResponseTransformEnabled] = useState(false);

  // Watch form fields to trigger re-render and unlock tabs dynamically
  const formName = Form.useWatch('name', form);
  const formType = Form.useWatch('type', form);
  const formTargetUrl = Form.useWatch('targetUrl', form);
  const formHttpMethod = Form.useWatch('httpMethod', form);
  const inboundAuthTypeValue = Form.useWatch('inboundAuthType', form);
  const outgoingAuthTypeValue = Form.useWatch('outgoingAuthType', form);
  const streamResponse = Form.useWatch('streamResponse', form);
  const actionType = Form.useWatch('actionType', form); // NEW: HTTP or COMMUNICATION
  const communicationChannel = Form.useWatch(['communicationConfig', 'channel'], form); // EMAIL, SMS, etc.
  const communicationProvider = Form.useWatch(['communicationConfig', 'provider'], form); // SMTP, GMAIL_OAUTH, etc.
  const senderRoutingEnabled = communicationProvider === 'ROUTED_EMAIL';

  const runtimeUrlPreview = useMemo(() => {
    const apiBase = getApiBaseUrl();
    const base = apiBase.replace(/\/$/, '');
    const typedType = typeof formType === 'string' ? formType.trim() : '';
    const typeSegment = typedType ? encodeURIComponent(typedType) : '<type>';
    const runtimePath =
      !inboundAuthTypeValue || inboundAuthTypeValue === 'NONE' || inboundAuthTypeValue === 'HMAC'
        ? 'public/integrations'
        : 'integrations';
    return `${base}/${runtimePath}/${typeSegment}?orgId=<orgId>`;
  }, [formType, inboundAuthTypeValue]);

  // Watch SMTP fields for reactive button enabling
  const smtpHost = Form.useWatch(['communicationConfig', 'smtp', 'host'], form);
  const smtpPort = Form.useWatch(['communicationConfig', 'smtp', 'port'], form);
  const smtpUsername = Form.useWatch(['communicationConfig', 'smtp', 'username'], form);
  const smtpPassword = Form.useWatch(['communicationConfig', 'smtp', 'password'], form);
  const smtpFromEmail = Form.useWatch(['communicationConfig', 'smtp', 'fromEmail'], form);
  const defaultSenderProfileId = Form.useWatch(['communicationConfig', 'senderRouting', 'defaultProfileId'], form);
  const metaPhoneNumberId = Form.useWatch(['communicationConfig', 'meta', 'phoneNumberId'], form);
  const metaAccessToken = Form.useWatch(['communicationConfig', 'meta', 'accessToken'], form);
  const fcmProjectId = Form.useWatch(['communicationConfig', 'fcm', 'projectId'], form);
  const fcmClientEmail = Form.useWatch(['communicationConfig', 'fcm', 'clientEmail'], form);
  const fcmPrivateKey = Form.useWatch(['communicationConfig', 'fcm', 'privateKey'], form);
  const msg91AuthKey = Form.useWatch(['communicationConfig', 'msg91', 'authKey'], form);
  const msg91SenderId = Form.useWatch(['communicationConfig', 'msg91', 'senderId'], form);

  const { data: senderProfiles = [] } = useQuery({
    queryKey: ['senderProfiles', orgId],
    queryFn: listSenderProfiles,
    enabled: !!orgId,
    staleTime: 30_000,
  });

  // Automatically disable response transformation when streaming is enabled
  useEffect(() => {
    if (streamResponse && responseTransformEnabled) {
      setResponseTransformEnabled(false);
    }
  }, [streamResponse, responseTransformEnabled]);

  const [curlModalOpen, setCurlModalOpen] = useState(false);
  const [curlApiKey, setCurlApiKey] = useState('');
  const [curlInboundKey, setCurlInboundKey] = useState('');
  const [curlQueryParams, setCurlQueryParams] = useState<Array<{ name: string; value: string }>>([]);
  // Never prefill a real key: examples show a placeholder; callers use their own
  // integration-only key (Settings → API Keys).
  const defaultApiKey = '';
  const [testEmailModalOpen, setTestEmailModalOpen] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [testFromEmail, setTestFromEmail] = useState('');
  const [testEmailSubject, setTestEmailSubject] = useState('Test Email from Integration Gateway');
  const [testEmailBody, setTestEmailBody] = useState(
    '<h1>Test Email</h1><p>This is a test email sent from the Integration Gateway.</p>'
  );
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');
  const splitPolicyLines = (value: unknown) =>
    String(value || '')
      .split(/\r?\n|,/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  const getDefaultRequestTransformScript = (actionType: string) => {
    if (actionType === 'COMMUNICATION') {
      return `/**
 * Email Transformation - Client Request → Email Format
 *
 * Transform incoming request data into email format.
 * Required fields: to, subject, html
 * Optional fields: text, attachments
 */

// Simple email transformation
return {
  to: payload.email || payload.email,
  subject: \`Appointment Confirmed - \${payload.appointmentDate}\`,
  html: \`
    <h1>Hello \${payload.name}!</h1>
    <p>Your appointment has been confirmed.</p>
    <p><strong>Date:</strong> \${payload.appointmentDate}</p>
    <p><strong>Doctor:</strong> \${payload.doctorName}</p>
  \`,
  text: \`Hello \${payload.name}! Your appointment is confirmed for \${payload.appointmentDate}\`
};

/*
Example 2: Multiple recipients
return {
  to: [payload.email, payload.guardianEmail],
  subject: 'Test Results Available',
  html: '<h1>Your test results are ready</h1><p>Please visit the portal to view.</p>'
};

Example 3: Email with attachment (base64 encoded)
return {
  to: payload.email,
  subject: 'Invoice Attached',
  html: '<h1>Invoice</h1><p>Please find your invoice attached.</p>',
  attachments: [
    {
      filename: 'invoice.pdf',
      content: payload.pdfBase64,
      encoding: 'base64',
      contentType: 'application/pdf'
    }
  ]
};

Example 4: Fetch patient data and compose email
const patient = await http.get(\`https://api.yourserver.com/entities/\${payload.entityId}\`);

if (patient.status !== 200) {
  throw new Error('Failed to fetch patient data');
}

return {
  to: patient.data.email,
  subject: \`Welcome, \${patient.data.firstName}!\`,
  html: \`
    <h1>Welcome to Our Hospital</h1>
    <p>Dear \${patient.data.firstName} \${patient.data.lastName},</p>
    <p>Your registration is complete. Your patient ID is: \${patient.data.id}</p>
  \`
};
*/`;
    }

    // Default HTTP transformation
    return `/**
 * Request Transformation - Client App → External API
 *
 * IMPORTANT: Paste function BODY only (not the full function declaration)
 * The code is automatically wrapped in: async function transform(payload, context) { ... }
 *
 * Available globals:
 * - http.get(url, options), http.post(url, data, options), etc.
 * - context.http (same as http)
 * - epoch(dateStr), datetime(date, time, tz), trim(str), uppercase(str), etc.
 *
 * Returns: Transformed request body (or the original payload)
 */

// Default: pass-through (no transformation)
return payload;

/*
Example 1: Simple field mapping
return {
  entity_id: payload.entityId,
  full_name: payload.name,
  email: payload.email
};

Example 2: Fetch additional data from external API
const response = await http.get(
  \`https://api.example.com/entities/\${payload.entityId}\`,
  { headers: { 'Authorization': 'Bearer TOKEN' }, timeout: 15000 }
);

if (response.status !== 200) {
  throw new Error(\`Failed to fetch patient: \${response.status}\`);
}

return {
  ...payload,
  externalData: response.data
};

Example 3: Loop through list and enrich each item
const patients = payload.patientList || [];
const enriched = [];

for (const patient of patients) {
  const res = await http.get(\`https://api.example.com/entities/\${patient.id}\`);
  if (res.status === 200) {
    enriched.push({ ...patient, details: res.data });
  }
}

return { patients: enriched };

Example 4: Sequential API calls with conditional logic
const eligCheck = await http.post(
  'https://api.insurance.com/eligibility',
  { memberId: payload.memberId, serviceDate: payload.date }
);

if (eligCheck.status !== 200 || !eligCheck.data.isEligible) {
  return { status: 'INELIGIBLE', reason: eligCheck.data.reason };
}

const auth = await http.post(
  'https://api.insurance.com/authorization',
  { memberId: payload.memberId, referenceId: eligCheck.data.refId }
);

return {
  status: 'AUTHORIZED',
  authNumber: auth.data.authNumber,
  validUntil: auth.data.validUntil
};
*/`;
  };

  const [requestTransformScript, setRequestTransformScript] = useState(getDefaultRequestTransformScript('HTTP'));
  const [responseTransformScript, setResponseTransformScript] = useState(`/**
 * Response Transformation - External API → Client App
 *
 * IMPORTANT: Paste function BODY only (not the full function declaration)
 * The code is automatically wrapped in: async function transform(payload, context) { ... }
 *
 * Input 'payload' shape: { data, status, headers }
 * - payload.data: Response body from external API
 * - payload.status: HTTP status code (e.g., 200, 404)
 * - payload.headers: Response headers object
 *
 * Available: http.get/post/etc, context.http, epoch(), datetime(), etc.
 */

// Default: pass-through (no transformation)
return payload.data;

/*
Example 1: Extract and map specific fields
return {
  success: payload.status === 200,
  externalId: payload.data.id,
  message: payload.data.message || 'Success',
  timestamp: new Date().toISOString()
};

Example 2: Make additional API call based on response
if (payload.status === 200 && payload.data.requiresFollowup) {
  const followup = await http.post(
    'https://api.example.com/followup',
    { referenceId: payload.data.id }
  );

  return {
    ...payload.data,
    followup: followup.data,
    followupStatus: followup.status
  };
}

return payload.data;

Example 3: Handle errors gracefully
if (payload.status >= 400) {
  return {
    success: false,
    error: payload.data.error || 'External API error',
    httpStatus: payload.status
  };
}

return {
  success: true,
  data: payload.data
};
*/`);

  // Watch form values
  const authType = Form.useWatch('inboundAuthType', form);

  // Security posture based on auth type
  const getSecurityPosture = (auth: string) => {
    if (!auth || auth === 'NONE')
      return { label: 'Low', color: 'orange', tip: 'No authentication — any caller can invoke this endpoint' };
    if (auth === 'API_KEY') return { label: 'Medium', color: 'blue', tip: 'API key required' };
    if (auth === 'BASIC') return { label: 'Medium', color: 'blue', tip: 'Basic auth required' };
    if (auth === 'HMAC')
      return { label: 'High', color: 'green', tip: 'Signed requests with replay protection required' };
    return { label: 'High', color: 'green', tip: 'Strong authentication configured' };
  };

  // Fetch UI config
  const { data: uiConfig } = useQuery({
    queryKey: ['ui-config'],
    queryFn: getUIConfig,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch integration if editing
  const { data: integration, isLoading } = useQuery({
    queryKey: ['inbound-integration', id],
    queryFn: () => getInboundIntegration(id!),
    enabled: !isCreate,
    staleTime: 30_000,
  });

  // Update transformation script template when action type changes
  useEffect(() => {
    if (actionType && !integration) {
      // Only update template for new integrations
      setRequestTransformScript(getDefaultRequestTransformScript(actionType));
    }
  }, [actionType, integration]);

  const inferCurlQueryParams = (integrationConfig: any) => {
    if (!integrationConfig) return [];
    const httpMethod = (integrationConfig.httpMethod || 'POST').toUpperCase();
    if (httpMethod !== 'GET') return [];

    const extractQueryParamsFromTemplate = (template?: string) => {
      const params = new Set<string>();
      if (!template || typeof template !== 'string') return params;
      const re = /\{\{\s*query\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
      let match = re.exec(template);
      while (match) {
        params.add(match[1]);
        match = re.exec(template);
      }
      return params;
    };

    const addDestructuredKeys = (params: Set<string>, source: string) => {
      source
        .split(',')
        .map((part) => part.trim())
        .forEach((part) => {
          if (!part) return;
          const withoutDefault = part.replace(/=.*$/, '').trim();
          const withoutSpread = withoutDefault.replace(/^\.\.\./, '').trim();
          const key = withoutSpread.split(':')[0]?.trim();
          if (key && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
            params.add(key);
          }
        });
    };

    const extractQueryParamsFromScript = (script?: string) => {
      const params = new Set<string>();
      if (!script || typeof script !== 'string') return params;

      const dotPatterns = [
        /\b(?:context|ctx)(?:\s*\?\.)?\s*\.\s*query(?:\s*\?\.)?\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/g,
        /\bquery(?:\s*\?\.)?\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/g,
      ];
      for (const pattern of dotPatterns) {
        let match = pattern.exec(script);
        while (match) {
          params.add(match[1]);
          match = pattern.exec(script);
        }
      }

      const destructurePatterns = [/\{([^}]+)\}\s*=\s*(?:context|ctx)\s*\.\s*query\b/g, /\{([^}]+)\}\s*=\s*query\b/g];
      for (const pattern of destructurePatterns) {
        let match = pattern.exec(script);
        while (match) {
          addDestructuredKeys(params, match[1]);
          match = pattern.exec(script);
        }
      }

      return params;
    };

    const orgId = integrationConfig.orgId;
    const paramNames = new Set<string>();
    extractQueryParamsFromTemplate(integrationConfig.targetUrl).forEach((param) => paramNames.add(param));
    extractQueryParamsFromScript(integrationConfig.requestTransformation?.script).forEach((param) =>
      paramNames.add(param)
    );

    if ((paramNames.has('entityName') || paramNames.has('identifier')) && !paramNames.has('entityId')) {
      paramNames.add('entityId');
    }
    paramNames.delete('orgId');

    const defaultSampleValue = (name: string) => {
      if (name === 'entityId') return String(orgId ?? 84);
      if (name === 'entityName') return 'PAPPAMPATTI';
      if (name === 'identifier') return 'SEHPAP-3045';
      return `sample_${name}`;
    };

    const preferredOrder = ['entityId', 'entityName', 'identifier'];
    const orderedNames = Array.from(paramNames).sort((a, b) => {
      const aIdx = preferredOrder.indexOf(a);
      const bIdx = preferredOrder.indexOf(b);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.localeCompare(b);
    });

    return orderedNames.map((name) => ({ name, value: defaultSampleValue(name) }));
  };

  const buildInboundCurl = (
    integrationConfig: any,
    options?: { apiKey?: string; inboundKey?: string; queryParams?: Record<string, string> }
  ) => {
    if (!integrationConfig) return '';
    const apiBase = getApiBaseUrl();
    const base = apiBase.replace(/\/$/, '');
    const httpMethod = (integrationConfig.httpMethod || 'POST').toUpperCase();
    const orgId = integrationConfig.orgId;
    const headers: string[] = [];
    const apiKey = options?.apiKey?.trim();
    const inboundKey = options?.inboundKey?.trim();
    const inferredParams = inferCurlQueryParams(integrationConfig);

    const queryEntries: Array<[string, string]> = [['orgId', String(orgId ?? 84)]];
    if (httpMethod === 'GET') {
      inferredParams.forEach((param) => {
        const customValue = options?.queryParams?.[param.name];
        queryEntries.push([param.name, customValue ?? param.value]);
      });
    }
    const queryString = new URLSearchParams(queryEntries).toString();
    const usesPublicRuntime =
      !integrationConfig.inboundAuthType ||
      integrationConfig.inboundAuthType === 'NONE' ||
      integrationConfig.inboundAuthType === 'HMAC';
    const runtimePath = usesPublicRuntime ? 'public/integrations' : 'integrations';
    const url = `${base}/${runtimePath}/${encodeURIComponent(integrationConfig.type)}?${queryString}`;

    if (integrationConfig.inboundAuthType === 'API_KEY') {
      const headerName = (integrationConfig.inboundAuthConfig?.headerName || 'x-api-key').toLowerCase();
      const value = inboundKey || apiKey || '<INBOUND_API_KEY>';
      headers.push(`-H "${headerName}: ${value}"`);
    } else if (!usesPublicRuntime) {
      headers.push(`-H "X-API-Key: ${apiKey || '<API_KEY>'}"`);
    }

    if (httpMethod !== 'GET') {
      headers.push(`-H "Content-Type: application/json"`);
    }

    if (integrationConfig.inboundAuthType === 'BEARER') {
      headers.push(`-H "Authorization: Bearer <INBOUND_TOKEN>"`);
    } else if (integrationConfig.inboundAuthType === 'BASIC') {
      headers.push(`-H "Authorization: Basic <BASE64_USER_PASS>"`);
    } else if (integrationConfig.inboundAuthType === 'HMAC') {
      const messageIdHeader = integrationConfig.inboundAuthConfig?.messageIdHeader || 'X-Integration-ID';
      const timestampHeader = integrationConfig.inboundAuthConfig?.timestampHeader || 'X-Integration-Timestamp';
      const signatureHeader = integrationConfig.inboundAuthConfig?.signatureHeader || 'X-Integration-Signature';
      headers.push(`-H "${messageIdHeader}: <MESSAGE_ID>"`);
      headers.push(`-H "${timestampHeader}: <UNIX_TIMESTAMP>"`);
      headers.push(`-H "${signatureHeader}: <V1_HMAC_SIGNATURE>"`);
    }

    // Add placeholder headers from customHeaders (e.g. "x-partner-id": "{{partnerId}}" → -H "partnerId: <your-partnerId>")
    const customHeaders = (integrationConfig as any).customHeaders || {};
    const seenPlaceholders = new Set<string>();
    Object.values(customHeaders).forEach((value: any) => {
      const matches = String(value).match(/\{\{(\w+)\}\}/g);
      if (matches) {
        matches.forEach((match: string) => {
          const placeholder = match.replace(/\{\{|\}\}/g, '');
          if (!seenPlaceholders.has(placeholder)) {
            seenPlaceholders.add(placeholder);
            headers.push(`-H "${placeholder}: <your-${placeholder}>"`);
          }
        });
      }
    });

    const communicationAction = integrationConfig.actions?.find((a: any) => a.kind === 'COMMUNICATION');
    const communicationConfig = communicationAction?.communicationConfig || {};
    const isEmailCommunication =
      integrationConfig.type === 'EMAIL' ||
      communicationConfig.channel === 'EMAIL' ||
      integrationConfig.actions?.some((a: any) => a.kind === 'COMMUNICATION');
    const isRoutedEmail =
      communicationConfig.provider === 'ROUTED_EMAIL' && communicationConfig.senderRouting?.enabled === true;
    const senderField = communicationConfig.senderRouting?.sourceField || 'from';
    const defaultProfile =
      senderProfiles.find((profile) => profile.id === communicationConfig.senderRouting?.defaultProfileId) ||
      senderProfiles.find((profile) => profile.isDefault);
    const fixedFromEmail = communicationConfig.smtp?.fromEmail || communicationConfig.fromEmail;

    let dataPart = '';
    if (httpMethod !== 'GET') {
      if (isEmailCommunication) {
        const sampleBody = {
          ...(isRoutedEmail
            ? { [senderField]: defaultProfile?.fromEmail || '<CONFIGURED_SENDER_EMAIL>' }
            : fixedFromEmail
              ? { from: fixedFromEmail }
              : {}),
          to: 'recipient@example.com',
          subject: 'Test Email',
          html: '<h1>Test</h1><p>This is a test email.</p>',
          attachments: [
            {
              filename: 'document.pdf',
              content: '<BASE64_ENCODED_PDF>',
              encoding: 'base64',
              contentType: 'application/pdf',
            },
          ],
        };
        dataPart = ` \\\n  --data-raw '${JSON.stringify(sampleBody, null, 2)}'`;
      } else {
        dataPart = ` \\\n  -d '{}'`;
      }
    }

    return `curl -X ${httpMethod} "${url}" \\\n  ${headers.join(' \\\n  ')}${dataPart}`;
  };

  const handleCopyCurl = () => {
    if (!integration) return;
    setCurlApiKey(defaultApiKey);
    setCurlInboundKey('');
    setCurlQueryParams(inferCurlQueryParams(integration));
    setCurlModalOpen(true);
  };

  const handleConfirmCopyCurl = async () => {
    if (!integration) return;
    const queryParams = Object.fromEntries(curlQueryParams.map((param) => [param.name, param.value]));
    const curl = buildInboundCurl(integration, { apiKey: curlApiKey, inboundKey: curlInboundKey, queryParams });
    if (!curl) return;
    const copied = await copyTextToClipboard(curl);
    if (copied) {
      messageApi.success('Curl command copied');
      setCurlModalOpen(false);
    } else {
      messageApi.error('Failed to copy curl command — select and copy the text manually');
    }
  };

  const handleTestRuntime = async () => {
    if (!integration) return;
    const hide = messageApi.loading('Testing runtime endpoint...', 0);
    try {
      await testInboundRuntime({
        type: integration.type,
        httpMethod: integration.httpMethod,
      });
      hide();
      messageApi.success('Runtime call succeeded');
    } catch (error: any) {
      hide();
      messageApi.error(error.message || 'Runtime call failed');
    }
  };

  const handleOpenTestEmailModal = () => {
    setTestEmailAddress('');
    setTestFromEmail('');
    setTestEmailSubject('Test Email from Integration Gateway');
    setTestEmailBody('<h1>Test Email</h1><p>This is a test email sent from the Integration Gateway.</p>');
    setTestEmailModalOpen(true);
  };

  const handleSendTestEmail = async () => {
    if (!integration || !testEmailAddress) return;

    try {
      setIsSendingTest(true);
      const { testInboundIntegration } = await import('../../../services/api');

      const payload: Record<string, string> = {
        to: testEmailAddress,
        subject: testEmailSubject,
        html: testEmailBody,
      };
      if (senderRoutingEnabled && testFromEmail) {
        payload.from = testFromEmail;
      }

      const response = (await testInboundIntegration(integration._id, payload)) as any;

      if (response.success) {
        const messageId = response.messageId || response.response?.messageId;
        messageApi.success(
          messageId
            ? `Test email sent successfully! Message ID: ${messageId}`
            : response.message || 'Test email sent successfully!'
        );
        setTestEmailModalOpen(false); // Close modal on success
      } else {
        messageApi.error(response.error || 'Test email failed');
      }
    } catch (error: any) {
      const errorMsg =
        error.response?.data?.error || error.response?.data?.details || error.message || 'Failed to send test email';
      messageApi.error(errorMsg);
    } finally {
      setIsSendingTest(false);
    }
  };

  // Populate form when editing
  useEffect(() => {
    if (integration && !isCreate) {
      const requestScript = integration.requestTransformation?.script;
      const responseScript = integration.responseTransformation?.script;

      // Detect action type based on presence of actions array
      const detectedActionType = integration.actions && integration.actions.length > 0 ? 'COMMUNICATION' : 'HTTP';

      form.setFieldsValue({
        name: integration.name,
        type: integration.type,
        actionType: detectedActionType,
        inboundAuthType: integration.inboundAuthType,
        inboundAuthConfig: integration.inboundAuthConfig,
        outgoingAuthType: integration.outgoingAuthType || 'NONE',
        outgoingAuthConfig: integration.outgoingAuthConfig || {},
        targetUrl: integration.targetUrl,
        httpMethod: integration.httpMethod || 'POST',
        timeout: integration.timeout || 10000,
        retryCount: integration.retryCount || 3,
        contentType: integration.contentType || 'application/json',
        maxInboundFileSizeMb: integration.maxInboundFileSizeMb || 50,
        streamResponse: integration.streamResponse || false,
        customHeaders:
          integration.customHeaders && typeof integration.customHeaders === 'object'
            ? JSON.stringify(integration.customHeaders, null, 2)
            : integration.customHeaders || undefined,
        requestPolicy: {
          rateLimit: integration.requestPolicy?.rateLimit ||
            integration.rateLimits || { enabled: false, maxRequests: 100, windowSeconds: 60 },
          allowedIpCidrsText: (integration.requestPolicy?.allowedIpCidrs || []).join('\n'),
          allowedBrowserOriginsText: (integration.requestPolicy?.allowedBrowserOrigins || []).join('\n'),
        },
        // Its one action is the delivery; its stages are edited on the Delivery tab.
        stages: integration.actions?.[0]?.stages || [],
        send: integration.actions?.[0]?.send || null,
        stagesPaused: integration.stagesPaused === true,
        communicationConfig: integration.actions?.[0]?.communicationConfig || {
          channel: 'EMAIL',
          provider: 'SMTP',
          senderRouting: {
            enabled: false,
            sourceField: 'from',
            defaultProfileId: undefined,
            fallbackToDefaultOnMissingFrom: true,
            fallbackToDefaultOnUnknownFrom: false,
          },
        },
      });

      // Set request and response transformation scripts
      if (requestScript) {
        setRequestTransformScript(requestScript);
      }
      if (responseScript) {
        setResponseTransformScript(responseScript);
      }

      setRequestTransformEnabled(Boolean(requestScript && requestScript.trim()));
      setResponseTransformEnabled(Boolean(responseScript && responseScript.trim()));
    }
  }, [integration, isCreate, form]);

  // Custom form validation
  const validateForm = async () => {
    const currentActionType = form.getFieldValue('actionType');

    // For COMMUNICATION integrations, bypass HTTP field validation
    if (currentActionType === 'COMMUNICATION') {
      // Temporarily set dummy values for HTTP fields to pass their required validation
      const originalValues = form.getFieldsValue();
      form.setFieldsValue({
        targetUrl: 'https://dummy.communication.placeholder',
        httpMethod: 'POST',
        timeout: 10000,
        retryCount: 3,
        contentType: 'application/json',
        streamResponse: false,
      });

      // Clear any errors on HTTP-specific fields
      form.setFields([
        { name: 'targetUrl', errors: [] },
        { name: 'httpMethod', errors: [] },
        { name: 'timeout', errors: [] },
        { name: 'retryCount', errors: [] },
        { name: 'contentType', errors: [] },
        { name: 'streamResponse', errors: [] },
      ]);

      // Validate only COMMUNICATION-specific fields
      await form.validateFields([
        'name',
        'type',
        'actionType',
        ['communicationConfig', 'channel'],
        ['communicationConfig', 'provider'],
        ...(communicationProvider === 'ROUTED_EMAIL'
          ? [['communicationConfig', 'senderRouting', 'defaultProfileId']]
          : [
              ['communicationConfig', 'smtp', 'host'],
              ['communicationConfig', 'smtp', 'port'],
              ['communicationConfig', 'smtp', 'username'],
              ['communicationConfig', 'smtp', 'password'],
              ['communicationConfig', 'smtp', 'fromEmail'],
            ]),
      ]);

      // Restore original values (remove dummy HTTP values)
      form.setFieldsValue({
        targetUrl: originalValues.targetUrl,
        httpMethod: originalValues.httpMethod,
        timeout: originalValues.timeout,
        retryCount: originalValues.retryCount,
        contentType: originalValues.contentType,
        streamResponse: originalValues.streamResponse,
      });
    } else {
      // For HTTP integrations, validate all fields normally
      await form.validateFields();
    }

    return form.getFieldsValue();
  };

  // Handle form submission
  useUnsavedChangesWarning(hasUnsavedChanges);

  const handleCancel = () => {
    if (!hasUnsavedChanges()) {
      navigate('/inbound-integrations');
      return;
    }
    modal.confirm({
      title: 'Discard unsaved changes?',
      content: 'Your edits to this inbound integration have not been saved. Leaving now discards them.',
      okText: 'Discard changes',
      okButtonProps: { danger: true },
      cancelText: 'Keep editing',
      onOk: () => navigate('/inbound-integrations'),
    });
  };

  const handleSubmit = async () => {
    if (isSaving) return;

    try {
      setIsSaving(true);

      // Validate form with custom logic
      await validateForm();
      const values = form.getFieldsValue(true);

      // Build payload based on action type
      let payload: any = {
        name: values.name,
        type: values.type,
        direction: 'INBOUND',
        inboundAuthType: values.inboundAuthType,
        inboundAuthConfig: values.inboundAuthConfig,
        requestTransformation: {
          mode: 'SCRIPT',
          script: requestTransformEnabled ? requestTransformScript : '',
        },
        isActive: true,
      };

      const requestPolicy = {
        rateLimit: values.requestPolicy?.rateLimit || { enabled: false, maxRequests: 100, windowSeconds: 60 },
        allowedIpCidrs: splitPolicyLines(values.requestPolicy?.allowedIpCidrsText),
        allowedBrowserOrigins: splitPolicyLines(values.requestPolicy?.allowedBrowserOriginsText),
      };
      payload.requestPolicy = requestPolicy;
      payload.rateLimits = requestPolicy.rateLimit;

      if (values.actionType === 'COMMUNICATION') {
        const communicationConfig = {
          ...values.communicationConfig,
          senderRouting:
            values.communicationConfig?.provider === 'ROUTED_EMAIL'
              ? {
                  ...values.communicationConfig?.senderRouting,
                  enabled: true,
                }
              : {
                  ...values.communicationConfig?.senderRouting,
                  enabled: false,
                },
        };
        // COMMUNICATION integration
        payload.actions = [
          {
            name: `Send ${communicationConfig.channel}`,
            kind: 'COMMUNICATION',
            communicationConfig,
            // Pipeline stages of this delivery (Delivery tab).
            stages: values.stages,
            send: values.send,
          },
        ];
        payload.stagesPaused = values.stagesPaused;
        // Response transformation not used for COMMUNICATION
      } else {
        // HTTP integration
        payload.targetUrl = values.targetUrl;
        payload.outgoingAuthType = values.outgoingAuthType || 'NONE';
        payload.outgoingAuthConfig = values.outgoingAuthConfig || {};
        payload.httpMethod = values.httpMethod || 'POST';
        payload.timeout = values.timeout || 10000;
        payload.retryCount = values.retryCount || 3;
        payload.contentType = values.contentType || 'application/json';
        payload.maxInboundFileSizeMb =
          Number(values.maxInboundFileSizeMb) > 0 ? Number(values.maxInboundFileSizeMb) : 50;
        payload.streamResponse = values.streamResponse || false;
        payload.responseTransformation = {
          mode: 'SCRIPT',
          script: responseTransformEnabled && !values.streamResponse ? responseTransformScript : '',
        };
        if (values.customHeaders) {
          try {
            payload.customHeaders = JSON.parse(values.customHeaders);
          } catch {
            // invalid JSON — form validator already caught this
          }
        } else {
          payload.customHeaders = {};
        }
      }

      if (isCreate) {
        await createInboundIntegration(payload);
        messageApi.success('Inbound integration created successfully');
      } else {
        await updateInboundIntegration(id!, payload);
        messageApi.success('Inbound integration updated successfully');
      }

      queryClient.invalidateQueries({ queryKey: ['inbound-integrations'] });
      navigate('/inbound-integrations');
    } catch (error: any) {
      messageApi.error(error.message || 'Failed to save inbound integration');
    } finally {
      setIsSaving(false);
    }
  };

  // Helper function to check if a tab is complete (uses watched values for reactivity)
  const isTabComplete = (tabKey: string): boolean => {
    switch (tabKey) {
      case 'basic':
        if (actionType === 'COMMUNICATION') {
          // SMS picks provider inside the Provider Config tab (SmsConfigFields) — only require channel here
          if (communicationChannel === 'SMS') {
            return !!(formName && formType && communicationChannel);
          }
          return !!(formName && formType && communicationChannel && communicationProvider);
        }
        return !!(formName && formType);
      case 'http':
        if (actionType === 'COMMUNICATION') {
          // Check if SMTP config is complete
          if (communicationProvider === 'SMTP') {
            return !!(smtpHost && smtpPort && smtpUsername && smtpPassword && smtpFromEmail);
          }
          if (communicationProvider === 'ROUTED_EMAIL') {
            return !!defaultSenderProfileId;
          }
          if (communicationProvider === 'META') {
            return !!(metaPhoneNumberId && metaAccessToken);
          }
          if (communicationProvider === 'FCM') {
            return !!(fcmProjectId && fcmClientEmail && fcmPrivateKey);
          }
          if (communicationProvider === 'MSG91') {
            return !!(msg91AuthKey && msg91SenderId && msg91SenderId.length === 6);
          }
          return true;
        }
        return !!(formTargetUrl && formHttpMethod);
      case 'policy':
        return true; // Policy is optional
      case 'auth':
        return true; // Auth is optional (can be NONE)
      case 'request-transform':
        return true; // Transformation is optional
      case 'response-transform':
        return true; // Transformation is optional
      default:
        return false;
    }
  };

  // Check completion status for progressive disclosure
  const basicComplete = isTabComplete('basic');
  const httpComplete = isTabComplete('http');

  // The Delivery tab's diagram edits the fixed steps (the event, the transformation, the send) in place, with the
  // sections the other tabs show: nothing sends you to another tab and back. Same as an outbound integration's.
  type TabItems = InboundTabItem[];
  const withStepEditors = (tabs: TabItems): TabItems => {
    const section = (key: string, title: string) => ({
      key,
      title,
      node: tabs.find((tab) => tab.key === key)?.children,
    });
    const stepEditors: StepEditors = {
      trigger: [section('basic', 'Event'), section('policy', 'Request policy'), section('auth', 'Authentication')],
      transform: [section('request-transform', 'Request transformation')],
      send: [section('http', 'Provider')],
    };
    return tabs.map((tab) =>
      tab.key === 'delivery'
        ? {
            ...tab,
            children: (
              <div className="integration-tab-content">
                <DeliveryTab
                  form={form}
                  integrationId={isCreate ? undefined : id}
                  stepEditors={stepEditors}
                  targets={[
                    {
                      key: 'action-0',
                      label: null,
                      namePath: [],
                      protocol: protocolOf({
                        kind: 'COMMUNICATION',
                        communicationConfig: { channel: communicationChannel },
                      }),
                      actionIndex: 0,
                    },
                  ]}
                  context={() => ({
                    direction: 'INBOUND',
                    actions: [
                      { kind: 'COMMUNICATION', communicationConfig: form.getFieldValue('communicationConfig') },
                    ],
                  })}
                />
              </div>
            ),
          }
        : tab
    );
  };

  return (
    <PageTemplate
      as="main"
      className="inbound-integration-detail-template configuration-workspace"
      contentClassName="inbound-integration-detail-template__content"
      header={
        <PageHeader
          title={
            isCreate ? 'Create Inbound Integration' : integration?.name || passedTitle || 'Edit Inbound Integration'
          }
          morphTitle={!isCreate}
          breadcrumb={[
            { label: 'Configuration', path: '/integrations' },
            { label: 'Inbound Integrations', path: '/inbound-integrations' },
            { label: isCreate ? 'New' : integration?.name || 'Edit' },
          ]}
          dense
          actions={
            <Space size="small" wrap>
              <IntegrationHistoryButton
                integrationId={isCreate ? undefined : id}
                onRestored={() => queryClient.invalidateQueries({ queryKey: ['inbound-integration', id] })}
              />
              <RevealCredentialsButton
                integrationId={isCreate ? undefined : id}
                form={form}
                fetchCredentials={getInboundIntegrationCredentials}
                toFormValues={(document) => ({
                  inboundAuthConfig: document.inboundAuthConfig,
                  outgoingAuthConfig: document.outgoingAuthConfig,
                  customHeaders: document.customHeaders,
                  communicationConfig: document.actions?.[0]?.communicationConfig,
                })}
              />
            </Space>
          }
        />
      }
    >
      {/* Form */}
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        // The form runs well past one screen; without this a failed required
        // field just turns red somewhere out of sight.
        scrollToFirstError={{ behavior: 'smooth', block: 'center' }}
        onFinishFailed={({ errorFields }) =>
          messageApi.error(
            errorFields.length === 1
              ? 'One field needs attention before this can be saved.'
              : `${errorFields.length} fields need attention before this can be saved.`
          )
        }
        className="configuration-form"
        initialValues={{
          actionType: 'HTTP', // NEW: HTTP or COMMUNICATION
          httpMethod: 'POST',
          timeout: 10000,
          retryCount: 3,
          contentType: 'application/json',
          maxInboundFileSizeMb: 50,
          inboundAuthType: 'NONE',
          outgoingAuthType: 'NONE',
          requestPolicy: {
            rateLimit: {
              enabled: false,
              maxRequests: 100,
              windowSeconds: 60,
            },
            allowedIpCidrsText: '',
            allowedBrowserOriginsText: '',
          },
          communicationConfig: {
            channel: 'EMAIL',
            provider: 'SMTP',
            senderRouting: {
              enabled: false,
              sourceField: 'from',
              defaultProfileId: undefined,
              fallbackToDefaultOnMissingFrom: true,
              fallbackToDefaultOnUnknownFrom: false,
            },
          },
        }}
      >
        <InboundIntegrationTabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={withStepEditors([
            {
              key: 'basic',
              label: 'Basic Info',
              icon: <GatewayIcon name="ApiOutlined" />,
              disabled: false, // First tab always enabled
              children: (
                <div className="integration-tab-content">
                  <Space direction="vertical" size="small" className="ui-extracted-32ee142ac2">
                    <ConfigGrid columns={2}>
                      <Form.Item
                        name="name"
                        label="Integration Name"
                        rules={[{ required: true, message: 'Name is required' }]}
                      >
                        <Input placeholder="e.g., CleverTap Real-time Sync" />
                      </Form.Item>

                      <Form.Item
                        name="type"
                        label={
                          <Space size={6}>
                            Integration Type
                            <Tooltip
                              title={
                                <div>
                                  This value becomes the runtime endpoint path:
                                  <br />
                                  <code>{runtimeUrlPreview}</code>
                                </div>
                              }
                            >
                              <GatewayIcon name="InfoCircleOutlined" />
                            </Tooltip>
                          </Space>
                        }
                        extra={
                          <ConfigFieldHelp>
                            Unique identifier for this integration type (e.g., 'clevertap', 'zoho-crm')
                          </ConfigFieldHelp>
                        }
                        rules={[
                          { required: true, message: 'Type is required' },
                          ...(isCreate
                            ? [
                                {
                                  pattern: /^[a-z0-9-]+$/,
                                  message: 'Type must be lowercase alphanumeric with hyphens only',
                                },
                              ]
                            : []),
                        ]}
                      >
                        <Input placeholder="e.g., clevertap" />
                      </Form.Item>
                    </ConfigGrid>

                    <Form.Item
                      name="actionType"
                      label="Action Type"
                      extra={
                        <ConfigFieldHelp>
                          HTTP: Proxy to external API | COMMUNICATION: Send emails, SMS, WhatsApp, etc.
                        </ConfigFieldHelp>
                      }
                      rules={[{ required: true, message: 'Action type is required' }]}
                    >
                      <FormItemRadioGroup>
                        <Radio.Button value="HTTP">
                          <Space>
                            <GatewayIcon name="ApiOutlined" />
                            HTTP Proxy
                          </Space>
                        </Radio.Button>
                        <Radio.Button value="COMMUNICATION">
                          <Space>
                            <GatewayIcon name="MailOutlined" />
                            Communication
                          </Space>
                        </Radio.Button>
                      </FormItemRadioGroup>
                    </Form.Item>

                    {actionType === 'COMMUNICATION' && (
                      <ConfigGrid columns={2}>
                        <Form.Item
                          name={['communicationConfig', 'channel']}
                          label="Communication Channel"
                          rules={[{ required: true, message: 'Channel is required' }]}
                        >
                          <Select
                            placeholder="Select channel"
                            onChange={() => {
                              // Reset provider when channel changes
                              form.setFieldValue(['communicationConfig', 'provider'], undefined);
                            }}
                          >
                            <Select.Option value="EMAIL">
                              <Space>
                                <GatewayIcon name="MailOutlined" />
                                Email
                              </Space>
                            </Select.Option>
                            <Select.Option value="WHATSAPP">
                              <Space>
                                <GatewayIcon name="WhatsAppOutlined" />
                                WhatsApp
                              </Space>
                            </Select.Option>
                            <Select.Option value="PUSH">
                              <Space>
                                <GatewayIcon name="BellOutlined" />
                                Push Notification
                              </Space>
                            </Select.Option>
                            <Select.Option value="SMS">
                              <Space>
                                <GatewayIcon name="MessageOutlined" />
                                SMS
                              </Space>
                            </Select.Option>
                          </Select>
                        </Form.Item>

                        {/* SMS manages its own provider select inside SmsConfigFields (multi-vendor). */}
                        {communicationChannel !== 'SMS' && (
                          <Form.Item
                            name={['communicationConfig', 'provider']}
                            label={
                              communicationChannel === 'WHATSAPP'
                                ? 'WhatsApp Provider'
                                : communicationChannel === 'PUSH'
                                  ? 'Push Provider'
                                  : 'Email Provider'
                            }
                            rules={[{ required: true, message: 'Provider is required' }]}
                          >
                            {communicationChannel === 'WHATSAPP' ? (
                              <Select placeholder="Select provider">
                                <Select.Option value="META">
                                  <Space>
                                    <GatewayIcon name="WhatsAppOutlined" />
                                    Meta WhatsApp Business (Cloud API)
                                  </Space>
                                </Select.Option>
                              </Select>
                            ) : communicationChannel === 'PUSH' ? (
                              <Select placeholder="Select provider">
                                <Select.Option value="FCM">
                                  <Space>
                                    <GatewayIcon name="BellOutlined" />
                                    Firebase Cloud Messaging (FCM v1)
                                  </Space>
                                </Select.Option>
                              </Select>
                            ) : (
                              <Select placeholder="Select provider">
                                <Select.Option value="SMTP">SMTP (Gmail, Outlook, Custom)</Select.Option>
                                <Select.Option value="ROUTED_EMAIL">Sender Profiles (Generic Email)</Select.Option>
                                <Select.Option value="GMAIL_OAUTH" disabled>
                                  Gmail OAuth 2.0 (Coming Soon)
                                </Select.Option>
                                <Select.Option value="OUTLOOK_OAUTH" disabled>
                                  Outlook OAuth 2.0 (Coming Soon)
                                </Select.Option>
                              </Select>
                            )}
                          </Form.Item>
                        )}
                      </ConfigGrid>
                    )}

                    {isCreate && (
                      <section className="ui-extracted-8d0d7af51a">
                        <Button type="primary" onClick={() => setActiveTab('http')} disabled={!basicComplete}>
                          {actionType === 'COMMUNICATION' ? 'Continue to Provider' : 'Continue to Target API'}
                        </Button>
                      </section>
                    )}
                  </Space>
                </div>
              ),
            },
            {
              key: 'http',
              label: actionType === 'COMMUNICATION' ? 'Provider Config' : 'Target API',
              icon:
                actionType === 'COMMUNICATION' ? (
                  <GatewayIcon name="MailOutlined" />
                ) : (
                  <GatewayIcon name="SendOutlined" />
                ),
              disabled: !basicComplete, // Requires Basic Info to be complete
              // Force this pane's Form.Items to mount immediately so Form.useWatch('targetUrl'/'httpMethod')
              // reflects loaded data right away — otherwise editing an existing integration keeps every
              // downstream tab (Request Policy, Authentication, Transforms, Review) disabled until the
              // user manually visits this tab once, even though the record is already fully configured.
              forceRender: true,
              children: (
                <div className="integration-tab-content">
                  {actionType === 'COMMUNICATION' ? (
                    <Space direction="vertical" size="middle" className="console-width-full">
                      {communicationChannel === 'WHATSAPP' ? (
                        <InlineHint>Configure Meta WhatsApp Business API credentials in the fields below.</InlineHint>
                      ) : communicationChannel === 'PUSH' ? (
                        <InlineHint>Use a Firebase service account with the FCM HTTP v1 API.</InlineHint>
                      ) : communicationChannel === 'SMS' ? (
                        <InlineHint>Select an SMS provider, then enter its credentials.</InlineHint>
                      ) : (
                        <InlineHint>Enter the SMTP connection and credential details below.</InlineHint>
                      )}

                      {communicationChannel === 'WHATSAPP' && communicationProvider === 'META' && (
                        <MetaWhatsAppConfigFields
                          spacing={spacing}
                          httpComplete={httpComplete}
                          onBack={() => setActiveTab('basic')}
                          onNext={() => setActiveTab('policy')}
                        />
                      )}

                      {communicationChannel === 'PUSH' && communicationProvider === 'FCM' && (
                        <FcmConfigFields
                          spacing={spacing}
                          httpComplete={httpComplete}
                          onBack={() => setActiveTab('basic')}
                          onNext={() => setActiveTab('policy')}
                        />
                      )}

                      {communicationChannel === 'SMS' && (
                        <SmsConfigFields
                          spacing={spacing}
                          httpComplete={httpComplete}
                          smsProvider={communicationProvider}
                          onBack={() => setActiveTab('basic')}
                          onNext={() => setActiveTab('policy')}
                        />
                      )}

                      {senderRoutingEnabled && (
                        <>
                          <InlineHint>
                            Resolve the sender profile from the request's <Text code>from</Text> field; the default
                            profile is used when it is missing.
                          </InlineHint>

                          <Form.Item
                            name={['communicationConfig', 'senderRouting', 'defaultProfileId']}
                            label="Default Sender Profile"
                            rules={[{ required: true, message: 'Default sender profile is required' }]}
                            extra="Used when the request does not send a from address."
                          >
                            <Select
                              size="middle"
                              placeholder="Select default sender profile"
                              options={senderProfiles.map((profile) => ({
                                label: `${profile.name} · ${profile.fromEmail}`,
                                value: profile.id,
                              }))}
                            />
                          </Form.Item>

                          <Form.Item
                            name={['communicationConfig', 'senderRouting', 'sourceField']}
                            label="Payload Sender Field"
                            extra="Field name from the request body used to resolve the sender profile."
                          >
                            <Input size="middle" placeholder="from" />
                          </Form.Item>

                          <Form.Item
                            name={['communicationConfig', 'senderRouting', 'fallbackToDefaultOnMissingFrom']}
                            label="Missing from field"
                            valuePropName="checked"
                            extra="If enabled, requests without a from field will use the default sender profile."
                          >
                            <Switch checkedChildren="Use default" unCheckedChildren="Reject" />
                          </Form.Item>

                          <Form.Item
                            name={['communicationConfig', 'senderRouting', 'fallbackToDefaultOnUnknownFrom']}
                            label="Unknown from value"
                            valuePropName="checked"
                            extra="If disabled, unknown sender addresses are rejected instead of silently falling back."
                          >
                            <Switch checkedChildren="Use default" unCheckedChildren="Reject" />
                          </Form.Item>

                          {senderProfiles.length > 0 ? (
                            <InlineHint tone="success">
                              {senderProfiles.length} sender profile{senderProfiles.length === 1 ? '' : 's'} available.
                            </InlineHint>
                          ) : (
                            <Banner
                              status="warning"
                              title="No sender profiles configured"
                              description="Create a sender profile to enable generic email routing."
                              endContent={
                                <Button size="small" onClick={() => navigate('/settings/sender-profiles')}>
                                  Open Sender Profiles
                                </Button>
                              }
                            />
                          )}

                          <Divider className="console-margin-y-4" />

                          <div className="console-flex-between">
                            <Button size="middle" onClick={() => setActiveTab('basic')}>
                              Back to Basic Info
                            </Button>
                            <Button
                              type="primary"
                              size="middle"
                              onClick={() => setActiveTab('policy')}
                              disabled={!httpComplete}
                            >
                              Continue to Request Policy
                            </Button>
                          </div>
                        </>
                      )}

                      {communicationProvider === 'SMTP' && (
                        <>
                          <ConfigGrid columns={2}>
                            <Form.Item
                              name={['communicationConfig', 'smtp', 'host']}
                              label="SMTP Host"
                              rules={[{ required: true, message: 'SMTP host is required' }]}
                              extra={
                                <ConfigFieldHelp>
                                  e.g., smtp.gmail.com, smtp-mail.outlook.com, smtp.yourserver.com
                                </ConfigFieldHelp>
                              }
                            >
                              <Input placeholder="smtp.gmail.com" />
                            </Form.Item>

                            <Form.Item
                              name={['communicationConfig', 'smtp', 'port']}
                              label="SMTP Port"
                              rules={[{ required: true, message: 'SMTP port is required' }]}
                              extra={<ConfigFieldHelp>Common ports: 587 (TLS), 465 (SSL), 25 (Plain)</ConfigFieldHelp>}
                              normalize={(value) => {
                                const num = parseInt(value, 10);
                                return isNaN(num) ? value : num;
                              }}
                            >
                              <Input type="number" placeholder="587" />
                            </Form.Item>

                            <Form.Item
                              name={['communicationConfig', 'smtp', 'username']}
                              label="SMTP Username"
                              rules={[{ required: true, message: 'SMTP username is required' }]}
                              extra={<ConfigFieldHelp>Usually your email address</ConfigFieldHelp>}
                            >
                              <Input placeholder="your-email@gmail.com" />
                            </Form.Item>

                            <Form.Item
                              name={['communicationConfig', 'smtp', 'password']}
                              label="SMTP Password"
                              rules={[{ required: true, message: 'SMTP password is required' }]}
                              extra={
                                <ConfigFieldHelp>
                                  For Gmail, use an App Password (not your regular password)
                                </ConfigFieldHelp>
                              }
                            >
                              <Input.Password placeholder="your-app-password" />
                            </Form.Item>
                          </ConfigGrid>

                          <Form.Item
                            name={['communicationConfig', 'smtp', 'fromEmail']}
                            label="From Email Address"
                            rules={[
                              { required: true, message: 'From email is required' },
                              { type: 'email', message: 'Please enter a valid email' },
                            ]}
                            extra={<ConfigFieldHelp>Email address that will appear as sender</ConfigFieldHelp>}
                          >
                            <Input placeholder="noreply@yourcompany.com" />
                          </Form.Item>

                          <Banner
                            status="warning"
                            title="Gmail requires an App Password"
                            description={
                              <>
                                Enable 2-step verification, then create an{' '}
                                <a
                                  href="https://myaccount.google.com/apppasswords"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  App Password
                                </a>{' '}
                                and enter it above.
                              </>
                            }
                          />

                          <Divider className="console-margin-y-4" />

                          <div className="console-flex-between">
                            <Button size="middle" onClick={() => setActiveTab('basic')}>
                              Back to Basic Info
                            </Button>
                            <Button
                              type="primary"
                              size="middle"
                              onClick={() => setActiveTab('policy')}
                              disabled={!httpComplete}
                            >
                              Continue to Request Policy
                            </Button>
                          </div>
                        </>
                      )}
                    </Space>
                  ) : (
                    <>
                      <HttpConfigFields
                        form={form}
                        uiConfig={uiConfig}
                        mode="inbound"
                        spacing={spacing}
                        colors={colors}
                      />

                      <Divider className="console-margin-y-4" />

                      <ConfigSection
                        title="Target API Authentication"
                        description="Configure how the gateway authenticates when calling the target API"
                        icon={<GatewayIcon name="LockOutlined" />}
                      >
                        <AuthenticationFields
                          form={form}
                          uiConfig={uiConfig}
                          selectedAuthType={outgoingAuthTypeValue}
                          fieldPrefix={['outgoingAuthConfig']}
                          mode="outbound"
                          spacing={spacing}
                          authTypeFieldName="outgoingAuthType"
                        />
                      </ConfigSection>

                      <Divider className="console-margin-y-4" />

                      <div className="console-flex-between">
                        <Button size="middle" onClick={() => setActiveTab('basic')}>
                          Back to Basic Info
                        </Button>
                        <Button
                          type="primary"
                          size="middle"
                          onClick={() => setActiveTab('policy')}
                          disabled={!httpComplete}
                        >
                          Continue to Request Policy
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ),
            },
            {
              key: 'policy',
              label: 'Request Policy',
              icon: <GatewayIcon name="SafetyOutlined" />,
              disabled: !basicComplete || !httpComplete,
              children: (
                <div className="integration-tab-content">
                  <Space direction="vertical" size="middle" className="console-width-full">
                    <RequestPolicySection form={form} spacing={spacing} />

                    <Divider className="console-margin-y-4" />

                    <div className="console-flex-between">
                      <Button size="middle" onClick={() => setActiveTab('http')}>
                        Back to {actionType === 'COMMUNICATION' ? 'Provider Config' : 'Target API'}
                      </Button>
                      <Button type="primary" size="middle" onClick={() => setActiveTab('auth')}>
                        Continue to Authentication
                      </Button>
                    </div>
                  </Space>
                </div>
              ),
            },
            {
              key: 'auth',
              label: 'Authentication',
              icon: <GatewayIcon name="LockOutlined" />,
              disabled: !basicComplete || !httpComplete, // Requires Basic Info and Target API to be complete
              children: (
                <div className="integration-tab-content">
                  <Space
                    direction="vertical"
                    size="middle"
                    style={{
                      width: '100%',
                      maxWidth: ['NONE', 'API_KEY', 'BASIC', 'BEARER'].includes(authType) ? 720 : undefined,
                    }}
                  >
                    <AuthenticationFields
                      form={form}
                      uiConfig={uiConfig}
                      selectedAuthType={authType}
                      fieldPrefix={['inboundAuthConfig']}
                      mode="inbound"
                      spacing={spacing}
                      authTypeFieldName="inboundAuthType"
                    />

                    {/* Security posture indicator */}
                    {(() => {
                      const posture = getSecurityPosture(authType);
                      return (
                        <InlineHint tone={authType === 'NONE' ? 'warning' : 'success'}>
                          Security posture: <Text strong>{posture.label}</Text>. {posture.tip}
                        </InlineHint>
                      );
                    })()}

                    <Divider className="console-margin-y-4" />

                    <div className="console-flex-between">
                      <Button size="middle" onClick={() => setActiveTab('http')}>
                        Back to Provider Config
                      </Button>
                      <Button type="primary" size="middle" onClick={() => setActiveTab('request-transform')}>
                        Continue to Request Transform
                      </Button>
                    </div>
                  </Space>
                </div>
              ),
            },
            {
              key: 'request-transform',
              label: 'Request Transform',
              icon: <GatewayIcon name="CodeOutlined" />,
              disabled: !basicComplete || !httpComplete, // Requires Basic Info and Target API to be complete
              children: (
                <div className="integration-tab-content">
                  <Space direction="vertical" size="middle" className="console-width-full">
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: spacing[3],
                        flexWrap: 'wrap',
                      }}
                    >
                      <Text strong className="console-type-section">
                        Request Transform
                      </Text>
                      <Space size="small">
                        <Text type="secondary">Enabled</Text>
                        <Switch
                          checked={requestTransformEnabled}
                          onChange={setRequestTransformEnabled}
                          size="small"
                          aria-label="Enable request transformation"
                        />
                      </Space>
                    </div>

                    {!requestTransformEnabled ? (
                      <InlineHint>
                        {actionType === 'COMMUNICATION'
                          ? 'Requests are used as-is for email content. Enable transformation to build the email fields.'
                          : 'Requests are forwarded as-is. Enable transformation to add a script.'}
                      </InlineHint>
                    ) : (
                      <>
                        {actionType === 'COMMUNICATION' ? (
                          <InlineHint>
                            Return <Text code>to</Text>, <Text code>subject</Text>, and <Text code>html</Text>;{' '}
                            <Text code>text</Text> and <Text code>attachments</Text> are optional. Delivery is
                            asynchronous.
                          </InlineHint>
                        ) : (
                          <Collapse
                            ghost
                            size="small"
                            defaultActiveKey={[]}
                            expandIconPosition="end"
                            expandIcon={({ isActive }) => (
                              <GatewayIcon name="CaretRightOutlined" rotate={isActive ? 90 : 0} />
                            )}
                            items={[
                              {
                                key: 'advanced-http',
                                label: (
                                  <Space size={8}>
                                    <GatewayIcon name="InfoCircleOutlined" />
                                    <Text strong>Advanced HTTP Transformations</Text>
                                  </Space>
                                ),
                                children: (
                                  <div>
                                    <Paragraph className="console-margin-bottom-2">
                                      Transform incoming requests with full async/await support and HTTP client access.
                                      Like <strong>Mirth Connect</strong>, you can:
                                    </Paragraph>
                                    <ul className="ui-extracted-3d770f4917">
                                      <li>
                                        <strong>Fetch lists and loop</strong> - Get patient list, iterate through each
                                        to fetch details
                                      </li>
                                      <li>
                                        <strong>Sequential API calls</strong> - Use response from one API to call
                                        another
                                      </li>
                                      <li>
                                        <strong>Conditional workflows</strong> - If eligibility passes, call
                                        authorization API
                                      </li>
                                      <li>
                                        <strong>Data aggregation</strong> - Combine multiple API responses
                                      </li>
                                    </ul>
                                    <Paragraph style={{ marginTop: spacing[2], marginBottom: 'var(--spacing-0)' }}>
                                      <Text strong>Available:</Text> <code>context.http.get()</code>,{' '}
                                      <code>context.http.post()</code>, <code>context.http.put()</code>,{' '}
                                      <code>context.http.patch()</code>, <code>context.http.delete()</code>
                                    </Paragraph>
                                  </div>
                                ),
                              },
                            ]}
                          />
                        )}

                        <div>
                          <Text strong className="console-block-margin-bottom-2">
                            JavaScript Transformation Function
                          </Text>
                          <Editor
                            height="320px"
                            language="javascript"
                            theme={mode === 'dark' ? 'vs-dark' : 'light'}
                            value={requestTransformScript}
                            onChange={(value) => setRequestTransformScript(value || '')}
                            options={{
                              minimap: { enabled: false },
                              fontSize: editorFontSize('control'),
                              lineNumbers: 'on',
                              wordWrap: 'on',
                              scrollBeyondLastLine: false,
                              automaticLayout: true,
                            }}
                          />
                        </div>
                      </>
                    )}

                    <Divider className="console-margin-y-4" />

                    <div className="console-flex-between">
                      <Button size="middle" onClick={() => setActiveTab('auth')}>
                        Back to Authentication
                      </Button>
                      <Button
                        type="primary"
                        size="middle"
                        onClick={() => setActiveTab(actionType === 'COMMUNICATION' ? 'review' : 'response-transform')}
                      >
                        {actionType === 'COMMUNICATION'
                          ? 'Continue to Review & Submit'
                          : 'Continue to Response Transform'}
                      </Button>
                    </div>
                  </Space>
                </div>
              ),
            },
            // Hide Response Transform tab for COMMUNICATION integrations
            ...(actionType !== 'COMMUNICATION'
              ? [
                  {
                    key: 'response-transform',
                    label: 'Response Transform',
                    icon: <GatewayIcon name="CodeOutlined" />,
                    disabled: !basicComplete || !httpComplete, // Requires Basic Info and Target API to be complete
                    children: (
                      <div className="integration-tab-content">
                        <Space direction="vertical" size="middle" className="console-width-full">
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: spacing[3],
                              flexWrap: 'wrap',
                            }}
                          >
                            <Text strong className="console-type-section">
                              Response Transform
                            </Text>
                            <Space size="small">
                              <Text type="secondary">Enabled</Text>
                              <Switch
                                checked={responseTransformEnabled}
                                onChange={setResponseTransformEnabled}
                                size="small"
                                disabled={streamResponse}
                                aria-label="Enable response transformation"
                              />
                            </Space>
                          </div>

                          {streamResponse ? (
                            <Banner
                              status="warning"
                              title="Disable Stream Response to transform responses"
                              description="Streaming sends the upstream response directly to the client without buffering."
                              endContent={
                                <Button size="small" onClick={() => setActiveTab('http')}>
                                  Open Target API
                                </Button>
                              }
                            />
                          ) : !responseTransformEnabled ? (
                            <InlineHint>
                              Responses are returned as-is. Enable transformation to add a script.
                            </InlineHint>
                          ) : (
                            <Space direction="vertical" size="middle" className="console-width-full">
                              <InlineHint>
                                Input is <Text code>payload.data</Text>, <Text code>payload.status</Text>, and{' '}
                                <Text code>payload.headers</Text>. The script can make additional HTTP calls.
                              </InlineHint>

                              <div>
                                <Text strong className="console-block-margin-bottom-2">
                                  JavaScript Transformation Function
                                </Text>
                                <Editor
                                  height="320px"
                                  language="javascript"
                                  theme={mode === 'dark' ? 'vs-dark' : 'light'}
                                  value={responseTransformScript}
                                  onChange={(value) => setResponseTransformScript(value || '')}
                                  options={{
                                    minimap: { enabled: false },
                                    fontSize: editorFontSize('control'),
                                    lineNumbers: 'on',
                                    wordWrap: 'on',
                                    scrollBeyondLastLine: false,
                                    automaticLayout: true,
                                  }}
                                />
                              </div>
                            </Space>
                          )}

                          <Divider className="console-margin-y-4" />

                          <div className="console-flex-between">
                            <Button size="middle" onClick={() => setActiveTab('request-transform')}>
                              Back to Request Transform
                            </Button>
                            <Button type="primary" size="middle" onClick={() => setActiveTab('review')}>
                              Continue to Review & Submit
                            </Button>
                          </div>
                        </Space>
                      </div>
                    ),
                  },
                ]
              : []),
            // Email, SMS, WhatsApp and push are deliveries like any other: the same Delivery tab.
            ...(actionType === 'COMMUNICATION'
              ? [
                  {
                    key: 'delivery',
                    label: 'Delivery',
                    icon: <GatewayIcon name="NodeIndexOutlined" />,
                    disabled: !basicComplete || !httpComplete,
                    children: null, // built by withStepEditors, once every tab's content exists
                  },
                ]
              : []),
            {
              key: 'review',
              label: 'Review & Submit',
              icon: <GatewayIcon name="EyeOutlined" />,
              disabled: !basicComplete || !httpComplete, // Requires Basic Info and Target API to be complete
              children: (
                <div className="integration-tab-content">
                  <Space direction="vertical" size="middle" className="console-width-full">
                    {/* Basic Info Summary */}
                    <div>
                      <div className="console-flex-center-gap-2-margin-bottom-3">
                        <GatewayIcon name="ApiOutlined" className="console-title-accent" />
                        <Text strong className="console-type-section">
                          Basic Information
                        </Text>
                      </div>
                      <Space direction="vertical" size="small" className="console-width-full-indent-4">
                        <div className="console-flex-gap-2">
                          <Text type="secondary" className="console-label-min-width">
                            Integration Name:
                          </Text>
                          <Text strong>{form.getFieldValue('name') || <Text type="secondary">Not set</Text>}</Text>
                        </div>
                        <div className="console-flex-gap-2">
                          <Text type="secondary" className="console-label-min-width">
                            Integration Type:
                          </Text>
                          <Text strong>
                            <code>{form.getFieldValue('type') || <Text type="secondary">Not set</Text>}</code>
                          </Text>
                        </div>
                      </Space>
                    </div>

                    <Divider className="console-margin-none" />

                    {/* Configuration Summary - HTTP or COMMUNICATION */}
                    {form.getFieldValue('actionType') === 'COMMUNICATION' ? (
                      <div>
                        <div className="console-flex-center-gap-2-margin-bottom-3">
                          <GatewayIcon name="MailOutlined" className="console-title-accent" />
                          <Text strong className="console-type-section">
                            Communication Configuration
                          </Text>
                        </div>
                        <Space direction="vertical" size="small" className="console-width-full-indent-4">
                          <div className="console-flex-gap-2">
                            <Text type="secondary" className="console-label-min-width">
                              Channel:
                            </Text>
                            <Text code>{form.getFieldValue(['communicationConfig', 'channel']) || 'EMAIL'}</Text>
                          </div>
                          <div className="console-flex-gap-2">
                            <Text type="secondary" className="console-label-min-width">
                              Provider:
                            </Text>
                            <Text code>{form.getFieldValue(['communicationConfig', 'provider']) || 'SMTP'}</Text>
                          </div>
                          <div className="console-flex-gap-2">
                            <Text type="secondary" className="console-label-min-width">
                              SMTP Host:
                            </Text>
                            <Text strong>
                              {form.getFieldValue(['communicationConfig', 'smtp', 'host']) || (
                                <Text type="secondary">Not set</Text>
                              )}
                            </Text>
                          </div>
                          <div className="console-flex-gap-2">
                            <Text type="secondary" className="console-label-min-width">
                              SMTP Port:
                            </Text>
                            <Text>
                              {form.getFieldValue(['communicationConfig', 'smtp', 'port']) || (
                                <Text type="secondary">Not set</Text>
                              )}
                            </Text>
                          </div>
                          <div className="console-flex-gap-2">
                            <Text type="secondary" className="console-label-min-width">
                              From Email:
                            </Text>
                            <Text>
                              {form.getFieldValue(['communicationConfig', 'smtp', 'fromEmail']) || (
                                <Text type="secondary">Not set</Text>
                              )}
                            </Text>
                          </div>
                        </Space>
                      </div>
                    ) : (
                      <div>
                        <div className="console-flex-center-gap-2-margin-bottom-3">
                          <GatewayIcon name="SendOutlined" className="console-title-accent" />
                          <Text strong className="console-type-section">
                            Target API Configuration
                          </Text>
                        </div>
                        <Space direction="vertical" size="small" className="console-width-full-indent-4">
                          <div className="console-flex-gap-2">
                            <Text type="secondary" className="console-label-min-width">
                              Target URL:
                            </Text>
                            <Text strong>
                              {form.getFieldValue('targetUrl') || <Text type="secondary">Not set</Text>}
                            </Text>
                          </div>
                          <div className="console-flex-gap-2">
                            <Text type="secondary" className="console-label-min-width">
                              HTTP Method:
                            </Text>
                            <Text code>{form.getFieldValue('httpMethod') || 'POST'}</Text>
                          </div>
                          <div className="console-flex-gap-2">
                            <Text type="secondary" className="console-label-min-width">
                              Timeout:
                            </Text>
                            <Text>{form.getFieldValue('timeout') || 10000}ms</Text>
                          </div>
                          <div className="console-flex-gap-2">
                            <Text type="secondary" className="console-label-min-width">
                              Retry Count:
                            </Text>
                            <Text>{form.getFieldValue('retryCount') || 3}</Text>
                          </div>
                          <div className="console-flex-gap-2">
                            <Text type="secondary" className="console-label-min-width">
                              Content-Type:
                            </Text>
                            <Text>{form.getFieldValue('contentType') || 'application/json'}</Text>
                          </div>
                          {String(form.getFieldValue('contentType') || '')
                            .toLowerCase()
                            .includes('multipart/form-data') && (
                            <div className="console-flex-gap-2">
                              <Text type="secondary" className="console-label-min-width">
                                Max File Size:
                              </Text>
                              <Text>{form.getFieldValue('maxInboundFileSizeMb') || 50} MB</Text>
                            </div>
                          )}
                          <div className="console-flex-gap-2">
                            <Text type="secondary" className="console-label-min-width">
                              Stream Response:
                            </Text>
                            <Text>{form.getFieldValue('streamResponse') ? 'Enabled' : 'Disabled'}</Text>
                          </div>
                        </Space>
                      </div>
                    )}

                    <Divider className="console-margin-none" />

                    {/* Authentication Summary */}
                    <div>
                      <div className="console-flex-center-gap-2-margin-bottom-3">
                        <GatewayIcon name="LockOutlined" className="console-title-accent" />
                        <Text strong className="console-type-section">
                          Authentication
                        </Text>
                      </div>
                      <Space direction="vertical" size="small" className="console-width-full-indent-4">
                        <div className="console-flex-gap-2">
                          <Text type="secondary" className="console-label-min-width">
                            Inbound Auth Type:
                          </Text>
                          <Text code>{authType || 'NONE'}</Text>
                        </div>
                        <div className="console-flex-gap-2">
                          <Text type="secondary" className="console-label-min-width">
                            Security Posture:
                          </Text>
                          <Tooltip title={getSecurityPosture(authType).tip}>
                            <Text>{getSecurityPosture(authType).label}</Text>
                          </Tooltip>
                        </div>
                        {form.getFieldValue('actionType') !== 'COMMUNICATION' && (
                          <div className="console-flex-gap-2">
                            <Text type="secondary" className="console-label-min-width">
                              Target API Auth Type:
                            </Text>
                            <Text code>{outgoingAuthTypeValue || 'NONE'}</Text>
                          </div>
                        )}
                      </Space>
                    </div>

                    <Divider className="console-margin-none" />

                    {/* Transformation Summary */}
                    <div>
                      <div className="console-flex-center-gap-2-margin-bottom-3">
                        <GatewayIcon name="CodeOutlined" className="console-title-accent" />
                        <Text strong className="console-type-section">
                          Transformations
                        </Text>
                      </div>
                      <Space direction="vertical" size="small" className="console-width-full-indent-4">
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: spacing[2] }}>
                          <Text type="secondary" className="console-label-min-width">
                            {form.getFieldValue('actionType') === 'COMMUNICATION'
                              ? 'Email Content Transform:'
                              : 'Request Transform:'}
                          </Text>
                          <div>
                            <Text>{requestTransformEnabled ? 'Enabled' : 'Disabled'}</Text>
                            {requestTransformEnabled && requestTransformScript && (
                              <div className="console-margin-top-1">
                                <Text code className="console-caption-secondary">
                                  {requestTransformScript.trim().split('\n').slice(0, 2).join(' ').substring(0, 80)}…
                                </Text>
                              </div>
                            )}
                          </div>
                        </div>
                        {form.getFieldValue('actionType') !== 'COMMUNICATION' && (
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: spacing[2] }}>
                            <Text type="secondary" className="console-label-min-width">
                              Response Transform:
                            </Text>
                            <div>
                              <Text>{responseTransformEnabled ? 'Enabled' : 'Disabled'}</Text>
                              {responseTransformEnabled && responseTransformScript && (
                                <div className="console-margin-top-1">
                                  <Text code className="console-caption-secondary">
                                    {responseTransformScript.trim().split('\n').slice(0, 2).join(' ').substring(0, 80)}…
                                  </Text>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </Space>
                    </div>

                    <Divider className="console-margin-none" />

                    {/* Rate Limit Summary */}
                    <ConfigSection icon={<GatewayIcon name="ThunderboltOutlined" />} title="Rate Limiting">
                      <Space direction="vertical" size="small" className="console-width-full">
                        <div className="console-flex-gap-2">
                          <Text type="secondary" className="console-label-min-width">
                            Status:
                          </Text>
                          <Text>{form.getFieldValue(['rateLimits', 'enabled']) ? 'Enabled' : 'Disabled'}</Text>
                        </div>
                        {form.getFieldValue(['rateLimits', 'enabled']) && (
                          <>
                            <div className="console-flex-gap-2">
                              <Text type="secondary" className="console-label-min-width">
                                Max Requests:
                              </Text>
                              <Text>{form.getFieldValue(['rateLimits', 'maxRequests']) || 100}</Text>
                            </div>
                            <div className="console-flex-gap-2">
                              <Text type="secondary" className="console-label-min-width">
                                Window (seconds):
                              </Text>
                              <Text>{form.getFieldValue(['rateLimits', 'windowSeconds']) || 60}</Text>
                            </div>
                          </>
                        )}
                      </Space>
                    </ConfigSection>
                  </Space>
                </div>
              ),
            },
          ])}
        />

        {/* Persistent sticky footer — always visible regardless of active tab */}
        <footer className="configuration-action-bar">
          {integration && (
            <Dropdown placement="topLeft" trigger={['click']} menu={{ items: [
              { key: 'curl', label: 'Copy curl', icon: <GatewayIcon name="CopyOutlined" />, onClick: handleCopyCurl },
              actionType === 'COMMUNICATION' || integration.actions?.length
                ? { key: 'email', label: 'Send Test Email', icon: <GatewayIcon name="MailOutlined" />, onClick: handleOpenTestEmailModal }
                : { key: 'runtime', label: 'Test runtime', icon: <GatewayIcon name="ThunderboltOutlined" />, onClick: handleTestRuntime },
            ] }}>
              <Button size="small" icon={<GatewayIcon name="ThunderboltOutlined" />}>Test tools</Button>
            </Dropdown>
          )}
          <Space className="configuration-save-actions" size="small" wrap>
            <Button size="middle" onClick={handleCancel}>
              Cancel
            </Button>
            {activeTab !== 'review' && (
              <Button size="middle" onClick={() => setActiveTab('review')} icon={<GatewayIcon name="EyeOutlined" />}>
                Review
              </Button>
            )}
            <Button
              type="primary"
              size="middle"
              icon={<GatewayIcon name="SaveOutlined" />}
              onClick={() => form.submit()}
              loading={isSaving}
              disabled={isCreate && (!isTabComplete('basic') || !isTabComplete('http'))}
            >
              {isCreate ? 'Create Integration' : 'Save Changes'}
            </Button>
          </Space>
        </footer>
      </Form>

      <Modal
        title="Copy curl command"
        open={curlModalOpen}
        onOk={handleConfirmCopyCurl}
        onCancel={() => setCurlModalOpen(false)}
        okText="Copy"
      >
        <Space direction="vertical" size="small" className="console-width-full">
          <Text type="secondary">
            This endpoint is public; add only the integration-level credentials configured for this inbound flow.
          </Text>
          {integration?.inboundAuthType === 'API_KEY' && (
            <Input.Password
              placeholder="Integration API Key"
              value={curlApiKey}
              onChange={(e) => {
                setCurlApiKey(e.target.value);
                setCurlInboundKey(e.target.value);
              }}
            />
          )}
          {curlQueryParams.length > 0 && (
            <>
              <Divider className="console-margin-y-2" />
              <Text type="secondary">Sample query parameters (editable):</Text>
              {curlQueryParams.map((param) => (
                <Input
                  key={param.name}
                  addonBefore={param.name}
                  value={param.value}
                  onChange={(e) => {
                    const value = e.target.value;
                    setCurlQueryParams((prev) =>
                      prev.map((item) => (item.name === param.name ? { ...item, value } : item))
                    );
                  }}
                />
              ))}
            </>
          )}
        </Space>
      </Modal>

      {/* Test Email Modal */}
      <Modal
        title="Send Test Email"
        open={testEmailModalOpen}
        onOk={handleSendTestEmail}
        onCancel={() => setTestEmailModalOpen(false)}
        okText={isSendingTest ? 'Sending...' : 'Send Email'}
        confirmLoading={isSendingTest}
        width={600}
      >
        <Space direction="vertical" size="middle" className="console-width-full">
          {(senderRoutingEnabled || integration?.actions?.[0]?.communicationConfig?.provider === 'ROUTED_EMAIL') && (
            <div>
              <Text strong className="console-block-margin-bottom-2">
                From Email (Sender Profile)
              </Text>
              <Select
                placeholder="Select sender profile (uses default if not specified)"
                value={testFromEmail || undefined}
                onChange={(val) => setTestFromEmail(val)}
                allowClear
                size="middle"
                disabled={isSendingTest}
                className="console-width-full"
                options={senderProfiles.map((p: any) => ({
                  label: `${p.name} <${p.fromEmail}>`,
                  value: p.fromEmail,
                }))}
              />
            </div>
          )}

          <div>
            <Text strong className="console-block-margin-bottom-2">
              Recipient Email *
            </Text>
            <Input
              type="email"
              placeholder="recipient@example.com"
              value={testEmailAddress}
              onChange={(e) => setTestEmailAddress(e.target.value)}
              size="middle"
              disabled={isSendingTest}
            />
          </div>

          <div>
            <Text strong className="console-block-margin-bottom-2">
              Subject *
            </Text>
            <Input
              placeholder="Email subject"
              value={testEmailSubject}
              onChange={(e) => setTestEmailSubject(e.target.value)}
              size="middle"
              disabled={isSendingTest}
            />
          </div>

          <div>
            <Text strong className="console-block-margin-bottom-2">
              Email Body (HTML) *
            </Text>
            <Input.TextArea
              placeholder="<h1>Hello!</h1><p>This is a test email.</p>"
              value={testEmailBody}
              onChange={(e) => setTestEmailBody(e.target.value)}
              rows={6}
              disabled={isSendingTest}
            />
          </div>

          <InlineHint tone="warning">This sends immediately using the saved SMTP configuration.</InlineHint>
        </Space>
      </Modal>
    </PageTemplate>
  );
};
