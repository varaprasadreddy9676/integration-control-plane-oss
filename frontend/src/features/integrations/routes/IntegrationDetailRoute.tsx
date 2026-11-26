import { useEffect, useMemo, useRef, useState } from 'react';
import { Typography } from '@/components/common/LegacyTypography';
import { useParams, useLocation } from 'react-router-dom';
import { useNavigateWithParams } from '../../../utils/navigation';
import { App, Form, Space, Collapse } from "@/components/common/LegacyAntdControls";
import { InlineNotice as Notice } from '../../../components/common';
import { useQueryClient } from '@tanstack/react-query';
import { Button as AstryxButton } from '@astryxdesign/core/Button';
import {
  createIntegration,
  updateIntegration,
  rotateIntegrationSecret,
  removeIntegrationSecret,
  getIntegrationCredentials,
} from '../../../services/api';
import type {} from '../../../mocks/types';
import { IntegrationSigningSection } from '../components/IntegrationSigningSection';
import { useDesignTokens, cssVar } from '../../../design-system/utils';
import { useThemeMode } from '../../../app/theme-provider';
import { useTenant } from '../../../app/tenant-context';
import { useAuth } from '../../../app/auth-context';
import { useIntegrationForm } from '../hooks';
import { FormAlerts } from '../components/common';
import { defaultScript } from './integrationDetail/utils/constants';
import { formatScriptForDisplay } from './integrationDetail/utils/formatting';
import { useAvailableFields } from './integrationDetail/hooks/useAvailableFields';
import { useIntegrationDraft } from './integrationDetail/hooks/useIntegrationDraft';
import { useIntegrationKeyboardShortcuts } from './integrationDetail/hooks/useIntegrationKeyboardShortcuts';
import { useIntegrationQueries } from './integrationDetail/hooks/useIntegrationQueries';
import { useMultiActionValidation } from './integrationDetail/hooks/useMultiActionValidation';
import { useAutoExpandSections } from './integrationDetail/hooks/useAutoExpandSections';
import { useDeliveryModeSync } from './integrationDetail/hooks/useDeliveryModeSync';
import { useSamplePayload } from './integrationDetail/hooks/useSamplePayload';
import { useDeliveryModeSwitch } from './integrationDetail/hooks/useDeliveryModeSwitch';
import { useIntegrationTest } from './integrationDetail/hooks/useIntegrationTest';
import { useIntegrationImportExport } from './integrationDetail/hooks/useIntegrationImportExport';
import { IntegrationPageHeader } from './integrationDetail/components/IntegrationPageHeader';
import { PageHeader as SharedPageHeader } from '../../../components/common/PageHeader';
import { PageTemplate } from '../../../components/common/PageTemplate';
import { StatePanel } from '../../../components/common/StatePanel';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { RevealCredentialsButton } from '../../../components/common/RevealCredentialsButton';
import { IntegrationHistoryButton } from '../../integration-history';
import { ReviewConfirmDrawer } from './integrationDetail/components/ReviewConfirmDrawer';
import { buildIntegrationSectionItems } from './integrationDetail/components/IntegrationSectionsContent';
import { IntegrationFormContainer } from './integrationDetail/components/IntegrationFormContainer';
import { useUnsavedChangesWarning } from '../../../hooks/useUnsavedChangesWarning';
import { IntegrationFormBody } from './integrationDetail/components/IntegrationFormBody';
import { readDeliveryLayout, saveDeliveryLayout } from './integrationDetail/utils/deliveryLayout';
import { buildFollowUpStep } from '../../../services/stages-api';
import { applyClassicToSteps, classicFromSteps } from './integrationDetail/utils/classicSteps';
import type { ClassicSteps } from './integrationDetail/utils/classicSteps';
import type { DeliveryLayout } from './integrationDetail/utils/deliveryLayout';
import { TransformationDesigner } from './integrationDetail/components/TransformationDesigner';
import { buildPreviewContext } from './integrationDetail/utils/previewContext';
import { createTagTone } from './integrationDetail/utils/styles';
import { useSchedulingScripts } from './integrationDetail/hooks/useSchedulingScripts';
import { validateScheduling } from './integrationDetail/utils/validateScheduling';
import { getFormInitialValues } from './integrationDetail/utils/formDefaults';
import { getSectionCompletion } from './integrationDetail/utils/sectionCompletion';
import { buildIntegrationSavePayload } from './integrationDetail/utils/savePayload';
import { buildSubjectExtractionFromForm, subjectExtractionToFormFields } from './integrationDetail/utils/lifecycle';
import { buildConditionConfigFromForm, conditionConfigToFormFields } from './integrationDetail/utils/condition';
import {
  normalizeLifecycleRulesForForm,
  normalizeLifecycleRulesForSave,
} from './integrationDetail/utils/followUpRules';

// Helper component for action transformation preview
export const IntegrationDetailRoute = () => {
  const { spacing, token } = useDesignTokens();
  const { mode } = useThemeMode();
  const colors = cssVar.legacy;
  const { user } = useAuth();
  const isPortalSession = !!(user as any)?.isPortalSession;
  const { tenant } = useTenant();
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigateWithParams();
  const queryClient = useQueryClient();
  const isCreate = !id || id === 'new';
  const [form] = Form.useForm();
  // The script is the transformation; empty means the event is sent as it is.
  const [scriptValue, setScriptValue] = useState('');
  // For an integration that runs on steps: what the classic tabs showed when it loaded, to write back only what changes.
  const classicOnLoad = useRef<ClassicSteps | null>(null);
  const [deliveryLayout, setDeliveryLayout] = useState<DeliveryLayout>(readDeliveryLayout);
  const changeDeliveryLayout = (layout: DeliveryLayout) => {
    saveDeliveryLayout(layout);
    setDeliveryLayout(layout);
  };
  const [responseTransformEnabled, setResponseTransformEnabled] = useState(false);
  const [responseTransformScript, setResponseTransformScript] = useState(`// Inspect the remote API's response body.
// Call skip(reason) to signal a business-level failure.
// Call skip(reason, { shouldRetry: true }) to also schedule a retry.
// Return undefined (or any value) to let the delivery succeed.
//
// Example — Pathkind-style { statusCode: "0" } success envelope:
// if (responseBody?.statusCode !== '0') {
//   return skip(responseBody?.message || 'Remote API returned failure', { shouldRetry: true });
// }
`);
  const { message: messageApi, modal } = App.useApp();

  // Watch form fields to trigger re-render and unlock tabs dynamically
  const formName = Form.useWatch('name', form);
  const formEventType = Form.useWatch('eventType', form);
  const formTargetUrl = Form.useWatch('targetUrl', form);

  // Use custom integration form hook for all form state and watches
  const formState = useIntegrationForm(form);

  const [schedulingScriptValidation, setSchedulingScriptValidation] = useState<{
    status: 'idle' | 'success' | 'error';
    message?: string;
  }>({ status: 'idle' });
  const [isValidatingScript, setIsValidatingScript] = useState(false);
  const [multiActionValidationErrors, setMultiActionValidationErrors] = useState<string[]>([]);

  // Track saving state (prevent double-submission)
  const [isSaving, setIsSaving] = useState(false);

  // View/Edit mode state (professional enterprise pattern)
  const [isEditMode, setIsEditMode] = useState(isCreate); // Create mode = always editable, Edit mode = start in view

  // Collapsible sections state
  const [activePanels, setActivePanels] = useState<string[]>(['configuration']);

  // Reset component state when navigating between different integrations or create/edit modes
  useEffect(() => {
    // Reset all state when id changes (e.g., from /integrations/123 to /integrations/new)
    const currentIsCreate = !id || id === 'new';
    setIsEditMode(currentIsCreate);

    // Reset form and state
    form.resetFields();
    setScriptValue('');
    setActivePanels(currentIsCreate ? ['configuration'] : []);
    setMultiActionMode(false);
    setSchedulingScriptValidation({ status: 'idle' });
    setIsValidatingScript(false);
    setMultiActionValidationErrors([]);
    setSampleInput('');
    setSampleOutput('Awaiting preview…');
    setDeliveryModeChoice('single');
    setResponseTransformEnabled(false);
  }, [id]);

  const [sampleInput, setSampleInput] = useState<string>('');
  const [sampleOutput, setSampleOutput] = useState<string>('Awaiting preview…');
  const [isSigningModalOpen, setIsSigningModalOpen] = useState(false);
  const [isReviewDrawerOpen, setIsReviewDrawerOpen] = useState(false);
  const prevSingleConfigRef = useRef<{ targetUrl?: string; httpMethod?: string } | null>(null);
  const prevSingleTransformRef = useRef<{ script?: string } | null>(null);
  const [deliveryModeChoice, setDeliveryModeChoice] = useState<'single' | 'multi'>('single');
  const [multiActionMode, setMultiActionMode] = useState(false);

  // CleverTap template helper
  const loadCleverTapTemplate = () => {
    const cleverTapActions = [
      {
        name: 'Profile Upload',
        targetUrl: 'https://api.clevertap.com/1/upload',
        httpMethod: 'POST',
        condition: 'eventType === "PATIENT_REGISTRATION"',
        transformationMode: 'SCRIPT',
        transformation: {
          script: `function transform(payload, context) {
  // Resolve identity: MRN → Phone → Email fallback
  const identity = payload.recordId || payload.phone || payload.email || 'unknown';

  // Format phone with +91 prefix
  let phone = payload.phone || '';
  if (phone && !phone.startsWith('+91')) {
    phone = phone.startsWith('91') ? '+' + phone : '+91' + phone;
  }

  return {
    d: [{
      identity: identity,
      type: 'profile',
      profileData: {
        Name: payload.name,
        MRN: payload.recordId,
        Phone: phone,
        Email: payload.email,
        Address: payload.patientAddress,
        Age: payload.patientAge,
        Gender: payload.patientGender,
        RegistrationDate: new Date().toISOString()
      }
    }]
  };
}`,
        },
      },
      {
        name: 'Event Upload',
        targetUrl: 'https://api.clevertap.com/1/upload',
        httpMethod: 'POST',
        transformationMode: 'SCRIPT',
        transformation: {
          script: `function transform(payload, context) {
  const identity = payload.recordId || payload.phone || payload.email || 'unknown';

  return {
    d: [{
      identity: identity,
      type: 'event',
      evtName: 'Patient Registered',
      evtData: {
        recordId: payload.recordId,
        registrationDate: new Date().toISOString(),
        orgName: context.entityName || 'Organization',
        source: 'source-system'
      }
    }]
  };
}`,
        },
      },
    ];

    form.setFieldsValue({
      actions: cleverTapActions,
      outgoingAuthType: 'CUSTOM_HEADERS',
      outgoingAuthConfig: {
        headers: [
          { key: 'X-CleverTap-Account-Id', value: 'YOUR_ACCOUNT_ID' },
          { key: 'X-CleverTap-Passcode', value: 'YOUR_PASSCODE' },
        ],
      },
      httpMethod: 'POST',
      timeoutMs: 30000,
      retryCount: 3,
    });

    messageApi.success('CleverTap template loaded! Update credentials and event type as needed.');
  };

  const {
    existingIntegration,
    integrationLoading,
    integrationLoadFailed,
    refetchIntegration,
    allIntegrations,
    eventTypes,
    eventTypesLoading,
    uiConfig,
    eventOptions,
    selectedEventTypeData,
  } = useIntegrationQueries(id, formState.selectedEventType);

  // Compute isActive value with fallback (form value takes precedence, then DB value, then default to true)
  const isActiveValue =
    formState.isActiveWatchValue !== undefined ? formState.isActiveWatchValue : (existingIntegration?.isActive ?? true);
  const isDetailLoading = !isCreate && integrationLoading && !existingIntegration;
  const transformationHasContent = scriptValue.trim().length > 0;

  // Determine if this is a multi-action integration
  const hasActions = Array.isArray(formState.actions) && formState.actions.length > 0;
  const isMultiAction = multiActionMode;

  useDeliveryModeSync({ isMultiAction, setDeliveryModeChoice });

  // Available fields for transformation (dynamic based on selected event type)
  // Transform backend schema to UI format
  const { availableFields, availableFieldTree } = useAvailableFields(selectedEventTypeData);

  useSamplePayload({
    selectedEventType: formState.selectedEventType,
    selectedEventTypeData,
    setSampleInput,
  });

  // Dynamic form initial values based on server config
  const formInitialValues = useMemo(() => getFormInitialValues(uiConfig), [uiConfig]);

  const tagTone = createTagTone(spacing);

  useEffect(() => {
    if (existingIntegration) {
      setMultiActionMode(Boolean(existingIntegration.actions && existingIntegration.actions.length > 0));
      // Transform CUSTOM_HEADERS object format to array format for Form.List
      let outgoingAuthConfig = existingIntegration.outgoingAuthConfig;
      if (
        existingIntegration.outgoingAuthType === 'CUSTOM_HEADERS' &&
        existingIntegration.outgoingAuthConfig?.headers
      ) {
        const headersObject = existingIntegration.outgoingAuthConfig.headers;
        if (typeof headersObject === 'object' && !Array.isArray(headersObject)) {
          const headersArray = Object.entries(headersObject).map(([key, value]) => ({
            key,
            value,
          }));
          outgoingAuthConfig = { headers: headersArray };
        }
      }

      const normalizedTransformation = existingIntegration.transformation
        ? {
            ...existingIntegration.transformation,
            script: formatScriptForDisplay((existingIntegration.transformation as any).script),
          }
        : existingIntegration.transformation;

      const normalizedActions = existingIntegration.actions?.map((action: any) => ({
        ...action,
        // Restore UI toggle + placeholdersJson from stored providerRef
        useProviderRef: !!(action.providerRef?.providerKey && action.providerRef?.operationKey),
        providerRef: action.providerRef
          ? {
              ...action.providerRef,
              placeholdersJson: action.providerRef.placeholders
                ? JSON.stringify(action.providerRef.placeholders, null, 2)
                : '',
            }
          : action.providerRef,
        transformation: action?.transformation
          ? {
              ...action.transformation,
              script: formatScriptForDisplay((action.transformation as any).script),
            }
          : action.transformation,
      }));

      const subjectExtractionFields = subjectExtractionToFormFields(existingIntegration.subjectExtraction);
      const conditionFields = conditionConfigToFormFields(existingIntegration.conditionConfig);
      // Prefer lifecycleRules; fall back to legacy cancelOnEvents so existing integrations display correctly
      const hasLifecycleRules = (existingIntegration.lifecycleRules?.length ?? 0) > 0;
      const legacyCancelRules =
        !hasLifecycleRules && (existingIntegration.cancelOnEvents?.length ?? 0) > 0
          ? [
              {
                eventTypes: existingIntegration.cancelOnEvents as string[],
                action: 'CANCEL_PENDING' as const,
                matchKeys: [] as string[],
                ruleMode: 'SIMPLE' as const,
                script: '',
              },
            ]
          : [];
      const normalizedLifecycleRules = hasLifecycleRules
        ? normalizeLifecycleRulesForForm(existingIntegration.lifecycleRules)
        : legacyCancelRules;

      const existingCustomHeaders = (existingIntegration as any).customHeaders;
      const customHeadersJson =
        existingCustomHeaders && typeof existingCustomHeaders === 'object'
          ? JSON.stringify(existingCustomHeaders, null, 2)
          : existingCustomHeaders || undefined;

      form.setFieldsValue({
        ...existingIntegration,
        ...subjectExtractionFields,
        ...conditionFields,
        lifecycleRules: normalizedLifecycleRules,
        outgoingAuthConfig,
        customHeaders: customHeadersJson,
        auth: {},
        transformationMode: existingIntegration.transformationMode,
        transformation: normalizedTransformation,
        actions: normalizedActions,
      });
      if ((existingIntegration.transformation as any)?.script) {
        setScriptValue(formatScriptForDisplay((existingIntegration.transformation as any).script));
      }

      // Load response transformation
      const responseScript = (existingIntegration as any).responseTransformation?.script;
      if (responseScript && responseScript.trim()) {
        setResponseTransformScript(responseScript);
        setResponseTransformEnabled(true);
      }

      // On steps already (old settings cleared): the classic tabs show and edit its steps.
      const onSteps =
        (existingIntegration as any).stageMigration?.state === 'SWITCHED' &&
        !((existingIntegration.actions?.length ?? 0) > 0);
      if (onSteps) {
        const classic = classicFromSteps((existingIntegration as any).stages);
        classicOnLoad.current = classic;
        setResponseTransformEnabled(classic.response.on);
        if (classic.response.script) setResponseTransformScript(classic.response.script);
        form.setFieldsValue({
          deliveryFollowUp: {
            enabled: classic.followUp.on,
            script: classic.followUp.script,
            checkAfterSeconds: classic.followUp.checkAfterSeconds,
          },
        });
      } else {
        classicOnLoad.current = null;
      }
    }
  }, [existingIntegration, form]);

  useEffect(() => {
    if (hasActions) {
      setMultiActionMode(true);
    }
  }, [hasActions]);

  // Pre-fill eventType from URL query parameter when creating new integration
  useEffect(() => {
    if (isCreate && location.search) {
      const params = new URLSearchParams(location.search);
      const eventTypeParam = params.get('eventType');

      if (eventTypeParam) {
        form.setFieldsValue({
          eventType: eventTypeParam,
        });
      }
    }
  }, [isCreate, location.search, form]);

  // Auto-fill valid scheduling scripts when delivery mode changes
  useEffect(() => {
    const currentScript = form.getFieldValue(['schedulingConfig', 'script']);

    // Only set default if script is empty or undefined
    if ((formState.deliveryModeValue === 'DELAYED' || formState.deliveryModeValue === 'RECURRING') && !currentScript) {
      const defaultScript =
        formState.deliveryModeValue === 'DELAYED'
          ? `// Example: Send 24 hours before appointment
const appointmentTime = parseDate(event.appointmentDateTime);
const scheduledTime = subtractHours(appointmentTime, 24);
toTimestamp(scheduledTime);`
          : `// Example: Send every 6 hours, 3 times starting 1 hour from now
const firstTime = addHours(now(), 1);
({
  firstOccurrence: toTimestamp(firstTime),
  intervalMs: 6 * 60 * 60 * 1000,
  maxOccurrences: 3
});`;

      form.setFieldsValue({
        schedulingConfig: {
          ...form.getFieldValue('schedulingConfig'),
          script: defaultScript,
        },
      });
    }
  }, [formState.deliveryModeValue, form]);

  useMultiActionValidation({
    form,
    actions: formState.actions,
    setErrors: setMultiActionValidationErrors,
  });

  const { handleCopyExampleScript } = useSchedulingScripts(messageApi);

  const handleValidateSchedulingScript = async () => {
    await validateScheduling({
      script: form.getFieldValue(['schedulingConfig', 'script']),
      deliveryMode: form.getFieldValue('deliveryMode'),
      timezone: form.getFieldValue(['schedulingConfig', 'timezone']) || 'UTC',
      eventType: form.getFieldValue('eventType'),
      setSchedulingScriptValidation,
      setIsValidatingScript,
      messageApi,
    });
  };

  const handleSubmit = async (submittedValues: any) => {
    setIsSaving(true);
    try {
      // Tabs may preserve fields that are not currently mounted. Read the
      // complete store so a collapsed or unvisited section is still saved.
      // Actions always come from the store: fields of an action registered on
      // another tab (its stages, on the Delivery tab) would submit as partial actions.
      const store = form.getFieldsValue(true);
      const values = { ...store, ...submittedValues, actions: store.actions ?? submittedValues.actions };
      const urlPattern = /^https?:\/\/.+/i;
      const isMultiActionSubmit = isMultiAction;
      const formActions = form.getFieldValue('actions');
      const resolvedActions =
        Array.isArray(values.actions) && values.actions.length > 0
          ? values.actions
          : Array.isArray(formActions)
            ? formActions
            : [];

      // Validate single-action integration
      if (!isMultiActionSubmit) {
        if (!values.targetUrl || !urlPattern.test(values.targetUrl)) {
          messageApi.error('Enter a valid HTTP/HTTPS target URL.');
          return;
        }
      }

      // Validate multi-action integration
      if (isMultiActionSubmit) {
        if (!resolvedActions || !Array.isArray(resolvedActions) || resolvedActions.length === 0) {
          messageApi.error(
            'Multi-action event rule must have at least one action. Either add an action or use single-action mode.'
          );
          return;
        }
        // Check if all actions have required fields
        for (let i = 0; i < resolvedActions.length; i++) {
          const action = resolvedActions[i];

          // Validate action name
          if (!action.name || !action.name.trim()) {
            messageApi.error(`Action ${i + 1}: Name is required`);
            return;
          }

          const actionKind = action.kind || 'HTTP';
          if (actionKind === 'HL7_MLLP') {
            const host = String(action.hl7Config?.host || '').trim();
            const port = Number(action.hl7Config?.port);
            if (!host) {
              messageApi.error(`Action ${i + 1} (${action.name}): MLLP host is required`);
              return;
            }
            if (!Number.isInteger(port) || port < 1 || port > 65535) {
              messageApi.error(`Action ${i + 1} (${action.name}): MLLP port must be between 1 and 65535`);
              return;
            }
          } else if (action.useProviderRef) {
            // Provider template — validate required keys
            if (!action.providerRef?.providerKey?.trim()) {
              messageApi.error(
                `Action ${i + 1} (${action.name}): Provider key is required when using a provider template`
              );
              return;
            }
            if (!action.providerRef?.operationKey?.trim()) {
              messageApi.error(
                `Action ${i + 1} (${action.name}): Operation key is required when using a provider template`
              );
              return;
            }
            // Validate placeholdersJson if provided
            if (action.providerRef?.placeholdersJson?.trim()) {
              try {
                JSON.parse(action.providerRef.placeholdersJson);
              } catch {
                messageApi.error(`Action ${i + 1} (${action.name}): Placeholders must be valid JSON`);
                return;
              }
            }
          } else if (!action.targetUrl || !urlPattern.test(action.targetUrl)) {
            messageApi.error(`Action ${i + 1} (${action.name}): Valid target URL is required`);
            return;
          }

          // Validate transformation mode
          const actionMode = action.transformationMode || 'SCRIPT';

          if (actionMode === 'SCRIPT') {
            // Validate SCRIPT mode has script
            if (!action.transformation || !action.transformation.script || !action.transformation.script.trim()) {
              messageApi.error(`Action ${i + 1} (${action.name}): Transformation script is required`);
              return;
            }
          }
        }
      }

      if (values.timeoutMs < 500 || values.timeoutMs > 60000) {
        messageApi.error('Timeout must be between 500 and 60000 ms.');
        return;
      }
      if (values.retryCount < 0 || values.retryCount > 10) {
        messageApi.error('Retry count must be between 0 and 10.');
        return;
      }
      try {
        // Transform CUSTOM_HEADERS array format to object format
        let outgoingAuthConfig = values.outgoingAuthConfig;
        if (values.outgoingAuthType === 'CUSTOM_HEADERS' && Array.isArray(values.outgoingAuthConfig?.headers)) {
          const headersObject: Record<string, string> = {};
          values.outgoingAuthConfig.headers.forEach((header: any) => {
            if (header.key && header.value) {
              headersObject[header.key] = header.value;
            }
          });
          outgoingAuthConfig = { headers: headersObject };
        }

        // Build the payload based on single-action or multi-action mode
        const subjectExtraction = buildSubjectExtractionFromForm(values);
        const lifecycleRules = normalizeLifecycleRulesForSave(values.lifecycleRules);
        const conditionConfig = buildConditionConfigFromForm(values);
        const hasFollowUpConfig =
          lifecycleRules.length > 0 ||
          Boolean(conditionConfig?.releaseRules?.length) ||
          Boolean(conditionConfig?.discardRules?.length);

        if (hasFollowUpConfig && (!values.resourceType || !String(values.resourceType).trim() || !subjectExtraction)) {
          messageApi.error(
            'Follow-up rules need a specific event schema. Select a concrete event type so matching can be prepared automatically.'
          );
          return;
        }

        const payload = buildIntegrationSavePayload({
          values,
          existingIntegration,
          outgoingAuthConfig,
          subjectExtraction,
          lifecycleRules,
          conditionConfig,
          transformationMode: transformationHasContent ? 'SCRIPT' : 'NONE',
        });

        const normalizedActions = (resolvedActions ?? []).map((action: any) => {
          const actionKind = action.kind || 'HTTP';
          if (actionKind === 'HL7_MLLP') {
            const tls = action.hl7Config?.tls || {};
            return {
              ...action,
              kind: 'HL7_MLLP',
              hl7Config: {
                ...(action.hl7Config || {}),
                host: String(action.hl7Config?.host || '').trim(),
                port: Number(action.hl7Config?.port),
                connectTimeoutMs: Number(action.hl7Config?.connectTimeoutMs || 5000),
                ackTimeoutMs: Number(action.hl7Config?.ackTimeoutMs || 15000),
                ackRequired: action.hl7Config?.ackRequired !== false,
                keepAlive: Boolean(action.hl7Config?.keepAlive),
                idleTimeoutMs: Number(action.hl7Config?.idleTimeoutMs || 60000),
                tls: {
                  ...tls,
                  enabled: Boolean(tls.enabled),
                  requestCert: Boolean(tls.requestCert),
                  rejectUnauthorized: tls.rejectUnauthorized !== false,
                },
              },
            };
          }
          // HTTP action — handle providerRef conversion
          if (action.useProviderRef && action.providerRef) {
            let placeholders: Record<string, string> = {};
            try {
              placeholders = action.providerRef.placeholdersJson?.trim()
                ? JSON.parse(action.providerRef.placeholdersJson)
                : {};
            } catch {
              /* already validated above — safe to ignore */
            }
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { useProviderRef: _upr, providerRef: _pref, ...actionRest } = action;
            return {
              ...actionRest,
              kind: 'HTTP',
              providerRef: {
                providerKey: action.providerRef.providerKey,
                operationKey: action.providerRef.operationKey,
                placeholders,
              },
            };
          }
          // Plain HTTP action — strip UI-only fields
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { useProviderRef: _upr2, ...plainAction } = action;
          return {
            ...plainAction,
            kind: 'HTTP',
          };
        });

        // Add fields based on mode
        // Parse customHeaders JSON string → object
        if (values.customHeaders) {
          try {
            (payload as any).customHeaders = JSON.parse(values.customHeaders);
          } catch {
            // invalid JSON — form validator already caught this, skip
          }
        } else {
          (payload as any).customHeaders = {};
        }

        if (isMultiActionSubmit) {
          // Multi-action integration: include actions array
          payload.actions = normalizedActions;
          // targetUrl is optional for multi-action but backend might still expect it
          payload.targetUrl =
            normalizedActions.find((action: any) => action.kind !== 'HL7_MLLP')?.targetUrl || 'https://placeholder.com';
        } else {
          // Single-action integration: include targetUrl and transformation
          payload.targetUrl = values.targetUrl;
          payload.transformation = {
            mode: transformationHasContent ? 'SCRIPT' : 'NONE',
            script: scriptValue,
          };
          (payload as any).responseTransformation = {
            mode: 'SCRIPT',
            script: responseTransformEnabled ? responseTransformScript : '',
          };
          if (classicOnLoad.current) {
            // The classic tabs edited its steps: write what changed into them, and keep the old settings switched
            // off (a follow-up or response check on both paths would run twice).
            // The whole form store, not `values`: a tab that was never opened has no registered fields.
            const loaded = classicOnLoad.current;
            const followUp = form.getFieldValue('deliveryFollowUp');
            // Switched on with no step yet: the server builds it (the provider's script and schedule, the hosts it may call).
            const newFollowUp =
              !loaded.followUp.exists && followUp?.enabled === true
                ? await buildFollowUpStep({
                    integrationId: existingIntegration?.id,
                    integration: { targetUrl: values.targetUrl },
                    script: followUp.script || '',
                    checkAfterSeconds: followUp.checkAfterSeconds,
                  })
                : undefined;
            payload.stages = applyClassicToSteps(
              (form.getFieldValue('stages') || []) as any[],
              {
                response: { exists: true, on: responseTransformEnabled, script: responseTransformScript },
                followUp: followUp
                  ? {
                      exists: true,
                      on: followUp.enabled === true,
                      script: followUp.script || '',
                      checkAfterSeconds: followUp.checkAfterSeconds,
                    }
                  : loaded.followUp,
              },
              loaded,
              newFollowUp
            );
            (payload as any).deliveryFollowUp = { enabled: false, script: '' };
            (payload as any).responseTransformation = { mode: 'SCRIPT', script: '' };
          }
        }

        if (isCreate) {
          await createIntegration(payload);
          clearDraft(); // clears the legacy draft key left by older builds
          messageApi.success('Event rule created');
          queryClient.invalidateQueries({ queryKey: ['integrations'] });
          navigate('/integrations');
        } else if (existingIntegration) {
          await updateIntegration(existingIntegration.id, payload);
          messageApi.success('Event rule updated');
          // Exit edit mode and return to view mode (professional enterprise pattern)
          setIsEditMode(false);
          setActivePanels([]);
          queryClient.invalidateQueries({ queryKey: ['integrations'] });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to save event rule';
        messageApi.error(errorMessage);
      }
    } catch (validationError) {
      // Validation errors (early returns) will hit this catch
      // Error message already shown by validation logic
    } finally {
      setIsSaving(false);
    }
  };

  const { handleTest } = useIntegrationTest({
    existingIntegration,
    messageApi,
  });

  // View/Edit mode handlers
  const handleEnterEditMode = () => {
    setIsEditMode(true);
    // Expand all panels in edit mode for easier editing
    const panels = ['configuration', 'authentication', 'delivery'];
    if (isMultiAction) {
      panels.splice(1, 0, 'multiAction');
    } else {
      panels.push('transformation');
    }
    panels.splice(panels.indexOf('delivery') + 1, 0, 'lifecycle');
    setActivePanels(panels);
  };

  // A long form that silently loses everything on refresh is the most
  // expensive failure this screen has. Cancel already confirms; this covers
  // closing or reloading the tab. Asked of the form at unload time rather than
  // tracked in state — see the hook for why a flag latches on here.
  useUnsavedChangesWarning(() => isEditMode && form.isFieldsTouched());

  const handleCancelEdit = () => {
    if (form.isFieldsTouched()) {
      modal.confirm({
        title: 'Discard unsaved changes?',
        content: 'You have unsaved changes. Discarding will reset all fields to their last saved values.',
        okText: 'Discard changes',
        okButtonProps: { danger: true },
        cancelText: 'Keep editing',
        onOk: () => {
          form.resetFields();
          setIsEditMode(false);
          setActivePanels([]);
        },
      });
    } else {
      form.resetFields();
      setIsEditMode(false);
      setActivePanels([]);
    }
  };

  // Collapse/Expand all handlers
  const handleExpandAll = () => {
    const allPanels = ['configuration', 'authentication', 'delivery'];
    if (isMultiAction) {
      allPanels.splice(1, 0, 'multiAction');
    } else {
      allPanels.push('transformation');
    }
    allPanels.splice(allPanels.indexOf('delivery') + 1, 0, 'lifecycle');
    setActivePanels(allPanels);
  };

  const handleCollapseAll = () => {
    setActivePanels([]);
  };

  // Review & Confirm handlers
  const handleOpenReview = () => {
    setIsReviewDrawerOpen(true);
  };

  const handlePrimarySave = () => {
    if (isCreate) {
      handleOpenReview();
      return;
    }
    form.submit();
  };

  const handleConfirmReview = async (action: 'activate' | 'draft') => {
    // Set the isActive field based on the action choice
    form.setFieldsValue({ isActive: action === 'activate' });

    // Submit the form
    await form.submit();

    // Close the drawer after successful submission
    if (!isSaving) {
      setIsReviewDrawerOpen(false);
    }
  };

  const { handleDuplicate, handleExport, handleImport } = useIntegrationImportExport({
    existingIntegration,
    form,
    messageApi,
    isCreate,
    navigate,
    allIntegrations,
    modal,
    queryClient,
  });

  // Calculate section completion for collapsible panels
  const sectionCompletion = useMemo(
    () =>
      getSectionCompletion({
        nameValue: formState.nameValue,
        eventTypeValue: formState.eventTypeValue,
        targetUrlValue: formState.targetUrlValue,
        httpMethodValue: formState.httpMethodValue,
        scopeValue: formState.scopeValue,
        authTypeValue: formState.authTypeValue,
        timeoutValue: formState.timeoutValue,
        retryValue: formState.retryValue,
        isMultiAction,
        hasActions,
        multiActionValidationErrors,
        transformationHasContent,
      }),
    [
      formState.nameValue,
      formState.eventTypeValue,
      formState.targetUrlValue,
      formState.httpMethodValue,
      formState.scopeValue,
      formState.authTypeValue,
      formState.timeoutValue,
      formState.retryValue,
      isMultiAction,
      hasActions,
      multiActionValidationErrors,
      transformationHasContent,
    ]
  );

  const { handleSwitchMode } = useDeliveryModeSwitch({
    form,
    deliveryModeChoice,
    isMultiAction,
    scriptValue,
    setDeliveryModeChoice,
    setMultiActionMode,
    setActivePanels,
    prevSingleConfigRef,
    prevSingleTransformRef,
    modal,
  });

  const transformationEditor = (
    <TransformationDesigner
      scriptValue={scriptValue}
      onScriptChange={setScriptValue}
      sampleInput={sampleInput}
      onSampleInputChange={setSampleInput}
      sampleOutput={sampleOutput}
      onSampleOutputChange={setSampleOutput}
      availableFields={availableFields as any[]}
      eventPayload={selectedEventTypeData?.samplePayload}
      onUseEventPayload={(payloadText) => setSampleInput(payloadText)}
      getPreviewContext={() => buildPreviewContext(form)}
      onValidateScript={() => messageApi.success('Script validated')}
      eventTypes={eventTypes.map((et) => et.eventType)}
      currentEventType={form.getFieldValue('eventType')}
    />
  );

  useAutoExpandSections({
    isCreate,
    activePanels,
    isMultiAction,
    sectionCompletion,
    setActivePanels,
  });

  useIntegrationKeyboardShortcuts({
    isCreate,
    isEditMode,
    form,
    onCancelEdit: handleCancelEdit,
  });

  const { clearDraft } = useIntegrationDraft({
    isCreate,
    existingIntegration,
    form,
    messageApi,
  });

  if (!isCreate && !integrationLoading && !existingIntegration) {
    const loadFailed = integrationLoadFailed;
    return (
      <PageTemplate
        as="main"
        className="integration-detail-template"
        contentClassName="integration-detail-template__content"
      >
        <div className="ui-extracted-d77a9b9b67">
          <SharedPageHeader
            title={loadFailed ? 'Integration unavailable' : 'Integration not found'}
            breadcrumb={[{ label: 'Configuration' }, { label: 'Integrations', path: '/integrations' }]}
            compact
          />
          <StatePanel
            glyph={loadFailed ? 'disrupted' : 'searching'}
            tone={loadFailed ? 'critical' : 'neutral'}
            title={loadFailed ? 'Could not load integration' : 'Integration not found'}
            description={loadFailed ? 'The request failed.' : 'This integration may have been removed.'}
            actions={
              loadFailed ? (
                <AstryxButton label="Retry" variant="secondary" onClick={() => void refetchIntegration()} />
              ) : (
                <AstryxButton
                  label="Back to integrations"
                  variant="primary"
                  onClick={() => navigate('/integrations')}
                />
              )
            }
          />
        </div>
      </PageTemplate>
    );
  }

  return (
    <PageTemplate
      as="main"
      className="integration-detail-template"
      contentClassName="integration-detail-template__content"
    >
      <div className="ui-extracted-d77a9b9b67">
        <IntegrationFormContainer
          form={form}
          initialValues={formInitialValues}
          onFinish={handleSubmit}
          onValidationFailed={(errorFields) =>
            messageApi.error(
              errorFields.length === 1
                ? 'One field needs attention before this can be saved.'
                : `${errorFields.length} fields need attention before this can be saved.`
            )
          }
        >
          {isDetailLoading ? (
            <StatePanel glyph="connecting" tone="busy" title="Loading integration" size="compact" />
          ) : (
            <IntegrationPageHeader
              isCreate={isCreate}
              isEditMode={isEditMode}
              existingIntegration={existingIntegration}
              isMultiAction={isMultiAction}
              deliveryModeValue={formState.deliveryModeValue}
              isActiveValue={isActiveValue}
              isSaving={isSaving}
              spacing={spacing}
              colors={colors}
              onSave={handlePrimarySave}
              onTest={handleTest}
              onCancelEdit={handleCancelEdit}
              onEnterEditMode={handleEnterEditMode}
              onDuplicate={handleDuplicate}
              onExport={handleExport}
              onImport={handleImport}
              isPortalSession={isPortalSession}
              extraActions={
                <>
                  <IntegrationHistoryButton
                    integrationId={isCreate ? undefined : id}
                    onRestored={() => queryClient.invalidateQueries({ queryKey: ['integration', id] })}
                  />
                  <RevealCredentialsButton
                    integrationId={isCreate ? undefined : id}
                    form={form}
                    fetchCredentials={getIntegrationCredentials}
                    toFormValues={(document) => ({
                      outgoingAuthConfig: document.outgoingAuthConfig,
                      actions: document.actions,
                      customHeaders: document.customHeaders,
                    })}
                  />
                </>
              }
            />
          )}
          {isDetailLoading ? (
            <StatePanel glyph="connecting" tone="busy" title="Loading configuration" size="regular" />
          ) : (
            <IntegrationFormBody
              isCreate={isCreate}
              isEditMode={isEditMode}
              isMultiAction={isMultiAction}
              isSaving={isSaving}
              isActiveValue={isActiveValue}
              canTest={!isCreate}
              canSave={isMultiAction ? multiActionValidationErrors.length === 0 && hasActions : true}
              spacing={spacing}
              token={token}
              colors={colors}
              deliveryModeChoice={deliveryModeChoice}
              onChangeDeliveryMode={handleSwitchMode}
              deliveryLayout={deliveryLayout}
              onChangeDeliveryLayout={changeDeliveryLayout}
              onExpandAll={handleExpandAll}
              onCollapseAll={handleCollapseAll}
              activePanels={activePanels}
              onPanelsChange={(keys) => setActivePanels(keys)}
              onSave={handlePrimarySave}
              onTest={handleTest}
              onCancel={() => {
                if (form.isFieldsTouched()) {
                  modal.confirm({
                    title: isCreate ? 'Discard draft?' : 'Discard unsaved changes?',
                    content: isCreate
                      ? 'Your draft will be lost. Are you sure you want to leave?'
                      : 'You have unsaved changes. Discarding will reset all fields to their last saved values.',
                    okText: isCreate ? 'Discard draft' : 'Discard changes',
                    okButtonProps: { danger: true },
                    cancelText: 'Keep editing',
                    onOk: () => {
                      if (isEditMode) {
                        form.resetFields();
                        setIsEditMode(false);
                        setActivePanels([]);
                      } else {
                        navigate('/integrations');
                      }
                    },
                  });
                } else {
                  if (isEditMode) {
                    form.resetFields();
                    setIsEditMode(false);
                    setActivePanels([]);
                  } else {
                    navigate('/integrations');
                  }
                }
              }}
              saveText={isCreate ? 'Review & Create' : 'Save Changes'}
              testText="Test Event Rule"
              formAlerts={
                <FormAlerts
                  isDisabled={isActiveValue === false}
                  disabledReason="This integration is paused. Enable it to process events."
                  spacing={spacing}
                />
              }
              validationErrors={multiActionValidationErrors}
              onActivate={() => {
                form.setFieldsValue({ isActive: true });
                form.submit();
              }}
              sectionItems={buildIntegrationSectionItems({
                form,
                tenant,
                eventTypes,
                uiConfig,
                isMultiAction,
                isCreate,
                isEditMode,
                eventTypesLoading,
                scopeValue: formState.scopeValue,
                excludedOrgUnits: formState.excludedOrgUnits,
                actionsCount: formState.actions?.length ?? 0,
                existingActionsCount: existingIntegration?.actions?.length ?? 0,
                selectedEventTypeData,
                availableFields,
                spacing,
                token,
                editorTheme: mode === 'dark' ? 'vs-dark' : 'light',
                colors,
                loadCleverTapTemplate,
                multiActionValidationErrors,
                formatScriptForDisplay,
                selectedAuthType: formState.selectedAuthType,
                deliveryModeValue: formState.deliveryModeValue,
                samplePayload: sampleInput,
                schedulingScriptValidation,
                isValidatingScript,
                onValidateScript: handleValidateSchedulingScript,
                onCopyExampleScript: handleCopyExampleScript,
                onValidationClose: () => setSchedulingScriptValidation({ status: 'idle' }),
                selectedEventType: formState.selectedEventType || existingIntegration?.eventType,
                scriptValue,
                transformationEditor,
                deliveryLayout,
                isReadOnly: !isCreate && !isEditMode,
                isLoading: isDetailLoading,
                integrationId: existingIntegration?.id,
                onOpenTab: (key: string) => setActivePanels([key]),
                hasPersistedFollowUpConfig: Boolean(
                  existingIntegration?.resourceType ||
                    existingIntegration?.subjectExtraction ||
                    (existingIntegration?.lifecycleRules?.length ?? 0) > 0 ||
                    (existingIntegration?.cancelOnEvents?.length ?? 0) > 0 ||
                    (existingIntegration as any)?.conditionConfig
                ),
                onSave: handlePrimarySave,
                onCancel: isCreate ? () => navigate('/integrations') : handleCancelEdit,
                isSaving,
                isActiveValue,
                responseTransformEnabled,
                responseTransformScript,
                onResponseTransformEnabledChange: setResponseTransformEnabled,
                onResponseTransformScriptChange: setResponseTransformScript,
              })}
            />
          )}
        </IntegrationFormContainer>

        {/* Review & Confirm Drawer */}
        <ReviewConfirmDrawer
          open={isReviewDrawerOpen}
          onClose={() => setIsReviewDrawerOpen(false)}
          onConfirm={handleConfirmReview}
          isCreating={isCreate}
          ruleName={formState.nameValue || 'Untitled Rule'}
          eventType={formState.eventTypeValue || 'Not configured'}
          targetUrl={formState.targetUrlValue || 'Not configured'}
          httpMethod={formState.httpMethodValue || 'POST'}
          scope={formState.scopeValue || 'ALL'}
          deliveryMode={formState.deliveryModeValue || 'IMMEDIATE'}
          retryPolicy={`${formState.retryValue ?? 3} retries, ${formState.timeoutValue ?? 30000}ms timeout`}
          authMethod={formState.authTypeValue || 'NONE'}
          transformationType={transformationHasContent ? 'JavaScript Transform' : 'None'}
          readinessChecks={[
            {
              label: 'Rule name and event type configured',
              isComplete: !!(formState.nameValue && formState.eventTypeValue),
              warning: !formState.nameValue || !formState.eventTypeValue ? 'Required field missing' : undefined,
            },
            {
              label: 'Target endpoint configured',
              isComplete: !!(formState.targetUrlValue && formState.httpMethodValue),
              warning: !formState.targetUrlValue || !formState.httpMethodValue ? 'Required field missing' : undefined,
            },
            {
              label: 'Authentication configured',
              isComplete: !!formState.authTypeValue,
              warning: !formState.authTypeValue ? 'Authentication method not selected' : undefined,
            },
            {
              label: 'Transformation configured',
              isComplete: transformationHasContent || isMultiAction,
              // Without a transformation the event payload is sent as-is, which is valid.
              advisory: true,
              warning:
                !transformationHasContent && !isMultiAction
                  ? 'No transformation: the event payload is sent as-is'
                  : undefined,
            },
            {
              label: 'No validation errors',
              isComplete: multiActionValidationErrors.length === 0,
              warning:
                multiActionValidationErrors.length > 0
                  ? `${multiActionValidationErrors.length} errors to fix`
                  : undefined,
            },
          ]}
          isSaving={isSaving}
        />

        {/* Integration Signing Modal - TEMPORARILY HIDDEN */}
        {/*
        <Modal
          title={
            <Space>
              <LockOutlined />
              <span>Manage Signing Secrets & Configuration</span>
              {!isCreate && !isEditMode && (
                <StatusBadge label="View only" variant="neutral" showIcon={false} />
              )}
            </Space>
          }
          open={isSigningModalOpen}
          onCancel={() => setIsSigningModalOpen(false)}
          footer={
            !isCreate && !isEditMode ? (
              <Button onClick={() => setIsSigningModalOpen(false)}>Close</Button>
            ) : null
          }
          width={900}
          style={{ top: 20 }}
        >
          {!isCreate && !isEditMode && (
            <Notice
              type="info"
              message="View Only Mode"
              description="Click the Edit button in the top right to modify integration signing configuration."
              style={{ marginBottom: spacing[4] }}
            />
          )}
          <fieldset disabled={!isCreate && !isEditMode} style={{ border: 'none', padding: 0, margin: 0 }}>
            <IntegrationSigningSection
              integration={existingIntegration}
              form={form}
              isCreate={isCreate}
              spacing={spacing}
              colors={colors}
              token={token}
              hideToggle={true}
              showConfigAlways={true}
              onRotateSecret={async () => {
                if (!existingIntegration?.id) return;
                try {
                  const result = await rotateIntegrationSecret(existingIntegration.id);
                  form.setFieldsValue({
                    signingSecret: result.newSecret,
                    signingSecrets: result.signingSecrets
                  });
                  messageApi.success('New signing secret generated successfully!');
                  queryClient.invalidateQueries({ queryKey: ['integration', id] });
                } catch (error: any) {
                  messageApi.error(error.message || 'Failed to rotate secret');
                }
              }}
              onRemoveSecret={async (secret) => {
                if (!existingIntegration?.id) return;
                try {
                  const result = await removeIntegrationSecret(existingIntegration.id, secret);
                  form.setFieldsValue({
                    signingSecrets: result.signingSecrets
                  });
                  messageApi.success('Secret removed successfully!');
                  queryClient.invalidateQueries({ queryKey: ['integration', id] });
                } catch (error: any) {
                  messageApi.error(error.message || 'Failed to remove secret');
                }
              }}
            />
          </fieldset>
        </Modal>
        */}
      </div>
    </PageTemplate>
  );
};
