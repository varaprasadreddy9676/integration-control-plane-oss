import { useState } from 'react';
import { Card, Divider, Space } from '@/components/common/LegacyAntdControls';
import { Text as AstryxText } from '@astryxdesign/core/Text';
import { Heading } from '@astryxdesign/core/Heading';
import { Tab, TabList } from '@astryxdesign/core';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { PageTemplate } from '../../../components/common/PageTemplate';
import { InlineHint } from '../../../components/common/InlineHint';

export const LookupGuideRoute = () => {
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <PageTemplate
      title="Lookup tables"
      description="Reference for mapping source codes to target values in integration payloads."
      breadcrumb={[{ label: 'Help', path: '/help' }, { label: 'Lookup tables' }]}
      compact
      contentClassName="lookup-guide-content"
    >
      <div className="lookup-guide-inner">
        <div className="console-margin-bottom-5">
          <div className="console-margin-bottom-5">
            <InlineHint>
              <strong>What are lookup tables?</strong> Translate codes and identifiers between source and external
              systems. They run after transformations, before delivery.
            </InlineHint>
          </div>
        </div>

        {(() => {
          const items = [
            {
              key: 'overview',
              label: 'Overview',
              icon: <GatewayIcon name="DatabaseOutlined" aria-hidden="true" />,
              children: (
                <div>
                  {/* How It Works */}
                  <div className="console-margin-bottom-5">
                    <Heading level={4}>
                      <GatewayIcon name="ThunderboltOutlined" className="console-text-info console-margin-right-2" />
                      How It Works
                    </Heading>
                    <AstryxText as="p" display="block">
                      Lookup tables follow a simple three-step execution process:
                    </AstryxText>
                    <div className="lookup-guide-info-panel">
                      <Space direction="vertical" className="console-width-full" size="middle">
                        <div className="console-flex-baseline-wrap">
                          <AstryxText type="supporting" color="secondary">
                            Step 1
                          </AstryxText>
                          <AstryxText weight="semibold">Standard Transformation Runs First</AstryxText>
                          <AstryxText as="p" display="block" className="console-margin-top-1-reset-bottom">
                            Your transformation script executes and generates the output payload
                          </AstryxText>
                        </div>
                        <div className="console-flex-baseline-wrap">
                          <AstryxText type="supporting" color="secondary">
                            Step 2
                          </AstryxText>
                          <AstryxText weight="semibold">Lookup Mappings Apply</AstryxText>
                          <AstryxText as="p" display="block" className="console-margin-top-1-reset-bottom">
                            The system finds fields specified in your lookup configs and translates the codes
                          </AstryxText>
                        </div>
                        <div className="console-flex-baseline-wrap">
                          <AstryxText type="supporting" color="secondary">
                            Step 3
                          </AstryxText>
                          <AstryxText weight="semibold">Final Payload Delivered</AstryxText>
                          <AstryxText as="p" display="block" className="console-margin-top-1-reset-bottom">
                            The transformed payload with mapped codes is sent to the target endpoint
                          </AstryxText>
                        </div>
                      </Space>
                    </div>
                  </div>

                  {/* Key Concepts */}
                  <div className="console-margin-bottom-5">
                    <Heading level={4}>
                      <GatewayIcon name="BulbOutlined" className="console-text-warning console-margin-right-2" />
                      Key Concepts
                    </Heading>

                    <Space direction="vertical" size="large" className="console-width-full">
                      <div>
                        <AstryxText weight="semibold" className="console-type-section">
                          Lookup Type
                        </AstryxText>
                        <AstryxText as="p" display="block">
                          A category of code mapping (e.g., <code>SERVICE_CODE</code>, <code>DIAGNOSIS_CODE</code>,{' '}
                          <code>PROVIDER_ID</code>). You can create any type names that make sense for your integration.
                        </AstryxText>
                      </div>

                      <div>
                        <AstryxText weight="semibold" className="console-type-section">
                          Source & Target Codes
                        </AstryxText>
                        <AstryxText as="p" display="block">
                          <strong>Source:</strong> The code from your source system (e.g., <code>SVC001</code>)<br />
                          <strong>Target:</strong> The code expected by the external system (e.g.,{' '}
                          <code>EXT_SVC_001</code>)
                        </AstryxText>
                      </div>

                      <div>
                        <AstryxText weight="semibold" className="console-type-section">
                          Hierarchical Override
                        </AstryxText>
                        <AstryxText as="p" display="block">
                          Lookups support a two-level hierarchy:
                        </AstryxText>
                        <ul className="console-margin-top-1">
                          <li>
                            <strong>Parent Level:</strong> Default mappings that apply to all entities
                          </li>
                          <li>
                            <strong>Entity-Specific:</strong> Override mappings for specific child entities
                          </li>
                        </ul>
                        <AstryxText
                          as="p"
                          display="block"
                          type="supporting"
                          color="secondary"
                          className="console-type-body"
                        >
                          When resolving a code, the system checks entity-specific mappings first, then falls back to
                          parent-level mappings.
                        </AstryxText>
                      </div>

                      <div>
                        <AstryxText weight="semibold" className="console-type-section">
                          Unmapped Behavior
                        </AstryxText>
                        <AstryxText as="p" display="block">
                          Controls what happens when no mapping exists:
                        </AstryxText>
                        <ul className="console-margin-top-1">
                          <li>
                            <code>PASSTHROUGH</code> Keep the original value unchanged
                          </li>
                          <li>
                            <code>FAIL</code> Block the integration delivery and mark it failed
                          </li>
                          <li>
                            <code>DEFAULT</code> Use a default value you specify
                          </li>
                        </ul>
                      </div>
                    </Space>
                  </div>

                  {/* Use Cases */}
                  <div className="console-margin-bottom-5">
                    <Heading level={4}>
                      <GatewayIcon name="CheckCircleOutlined" className="console-text-success console-margin-right-2" />
                      Common Use Cases
                    </Heading>

                    <Space direction="vertical" size="middle" className="console-width-full">
                      <Card size="small" className="console-bg-subtle">
                        <AstryxText weight="semibold">Service Code Mapping</AstryxText>
                        <AstryxText as="p" display="block" className="console-margin-top-1">
                          Map your internal service codes to external billing codes (e.g., source system{' '}
                          <code>CONSULT_001</code> → Insurance <code>99213</code>)
                        </AstryxText>
                      </Card>

                      <Card size="small" className="console-bg-subtle">
                        <AstryxText weight="semibold">Provider ID Translation</AstryxText>
                        <AstryxText as="p" display="block" className="console-margin-top-1">
                          Translate doctor IDs between systems (e.g., source system <code>DOC_123</code> → CRM{' '}
                          <code>PROV_XYZ</code>)
                        </AstryxText>
                      </Card>

                      <Card size="small" className="console-bg-subtle">
                        <AstryxText weight="semibold">Diagnosis Code Conversion</AstryxText>
                        <AstryxText as="p" display="block" className="console-margin-top-1">
                          Convert diagnosis codes to ICD-10 or other standard formats
                        </AstryxText>
                      </Card>

                      <Card size="small" className="console-bg-subtle">
                        <AstryxText weight="semibold">Location/Facility Mapping</AstryxText>
                        <AstryxText as="p" display="block" className="console-margin-top-1">
                          Map clinic locations to external facility identifiers
                        </AstryxText>
                      </Card>
                    </Space>
                  </div>
                </div>
              ),
            },
            {
              key: 'integration-config',
              label: 'Integration Configuration',
              icon: <GatewayIcon name="CodeOutlined" aria-hidden="true" />,
              children: (
                <div>
                  {/* Configuring in Integrations */}
                  <div className="console-margin-bottom-5">
                    <Heading level={4}>Adding Lookups to a Integration</Heading>
                    <AstryxText as="p" display="block">
                      When creating or editing a integration, scroll to the <strong>"Code Mappings (Lookups)"</strong>{' '}
                      section and click "Add Mapping" to configure automatic code translation.
                    </AstryxText>

                    <InlineHint tone="warning">
                      Lookups run after transformations. Make sure your script outputs the fields you want to map.
                    </InlineHint>

                    <Heading level={5}>Example Configuration</Heading>
                    <AstryxText as="p" display="block">
                      Let's say you want to map service codes in an appointment event:
                    </AstryxText>

                    <Card size="small" className="console-bg-subtle console-margin-bottom-4">
                      <Space direction="vertical" size="small" className="console-width-full">
                        <div>
                          <AstryxText weight="semibold">Mapping Type:</AstryxText> <code>SERVICE_CODE</code>
                        </div>
                        <div>
                          <AstryxText weight="semibold">Source Field:</AstryxText> <code>serviceCode</code>
                        </div>
                        <div>
                          <AstryxText weight="semibold">Target Field:</AstryxText> <code>externalServiceCode</code>
                        </div>
                        <div>
                          <AstryxText weight="semibold">Unmapped Behavior:</AstryxText> <code>PASSTHROUGH</code>
                        </div>
                      </Space>
                    </Card>

                    <AstryxText weight="semibold">Before Lookup:</AstryxText>
                    <pre className="lookup-guide-code">{`{
  "name": "John Doe",
  "serviceCode": "CONSULT_001",
  "appointmentDate": "2026-02-01"
}`}</pre>

                    <AstryxText weight="semibold">After Lookup:</AstryxText>
                    <pre className="lookup-guide-code">{`{
  "name": "John Doe",
  "serviceCode": "CONSULT_001",
  "externalServiceCode": "99213",  // ← Added by lookup
  "appointmentDate": "2026-02-01"
}`}</pre>
                  </div>

                  {/* Array Fields */}
                  <div className="console-margin-bottom-5">
                    <Heading level={4}>Mapping Array Fields</Heading>
                    <AstryxText as="p" display="block">
                      Lookups support array notation using <code>[]</code> to map codes within arrays:
                    </AstryxText>

                    <Card size="small" className="console-bg-subtle console-margin-bottom-4">
                      <Space direction="vertical" size="small" className="console-width-full">
                        <div>
                          <AstryxText weight="semibold">Mapping Type:</AstryxText> <code>ITEM_CODE</code>
                        </div>
                        <div>
                          <AstryxText weight="semibold">Source Field:</AstryxText> <code>items[].code</code>
                        </div>
                        <div>
                          <AstryxText weight="semibold">Target Field:</AstryxText> <code>items[].externalCode</code>
                        </div>
                      </Space>
                    </Card>

                    <AstryxText weight="semibold">Before Lookup:</AstryxText>
                    <pre className="lookup-guide-code">{`{
  "billNumber": "BILL-001",
  "items": [
    { "code": "MED_123", "quantity": 2 },
    { "code": "MED_456", "quantity": 1 }
  ]
}`}</pre>

                    <AstryxText weight="semibold">After Lookup:</AstryxText>
                    <pre className="lookup-guide-code">{`{
  "billNumber": "BILL-001",
  "items": [
    { "code": "MED_123", "externalCode": "EXT_MED_123", "quantity": 2 },
    { "code": "MED_456", "externalCode": "EXT_MED_456", "quantity": 1 }
  ]
}`}</pre>
                  </div>
                </div>
              ),
            },
            {
              key: 'scripts',
              label: 'Using in Scripts',
              icon: <GatewayIcon name="CodeOutlined" aria-hidden="true" />,
              children: (
                <div>
                  {/* lookup() Function */}
                  <div className="console-margin-bottom-5">
                    <Heading level={4}>
                      The <code>lookup()</code> Function
                    </Heading>
                    <AstryxText as="p" display="block">
                      In SCRIPT transformations, you can use the <code>lookup(code, type)</code> function to perform
                      lookups directly in your JavaScript code.
                    </AstryxText>

                    <InlineHint>
                      Function signature: <code>lookup(sourceCode: string, mappingType: string): string | null</code>
                    </InlineHint>

                    <Heading level={5}>Basic Usage</Heading>
                    <pre className="lookup-guide-code">{`// Simple lookup
const externalServiceCode = lookup(payload.serviceCode, 'SERVICE_CODE');

return {
  ...payload,
  externalServiceCode: externalServiceCode
};`}</pre>

                    <Heading level={5}>With Fallback</Heading>
                    <pre className="lookup-guide-code">{`// Provide a default if lookup fails
const externalCode = lookup(payload.diagnosisCode, 'DIAGNOSIS_CODE') || 'UNKNOWN';

return {
  ...payload,
  externalDiagnosisCode: externalCode
};`}</pre>

                    <Heading level={5}>Conditional Logic</Heading>
                    <pre className="lookup-guide-code">{`const externalCode = lookup(payload.serviceCode, 'SERVICE_CODE');

if (!externalCode) {
  // Handle unmapped code
  logger.warn(\`No mapping found for service code: \${payload.serviceCode}\`);
  return null; // This will skip the integration
}

return {
  ...payload,
  serviceCode: externalCode
};`}</pre>

                    <Heading level={5}>Mapping Arrays</Heading>
                    <pre className="lookup-guide-code">{`// Map codes in an array using .map()
return {
  ...payload,
  items: payload.items.map(item => ({
    ...item,
    externalCode: lookup(item.code, 'ITEM_CODE'),
    externalCategory: lookup(item.category, 'CATEGORY_CODE')
  }))
};`}</pre>

                    <Heading level={5}>Complex Transformation</Heading>
                    <pre className="lookup-guide-code">{`// Combine multiple lookups with logic
const providerCode = lookup(payload.doctorId, 'PROVIDER_ID');
const locationCode = lookup(payload.clinicId, 'LOCATION_ID');
const serviceCode = lookup(payload.serviceType, 'SERVICE_CODE');

// Only proceed if all critical mappings exist
if (!providerCode || !serviceCode) {
  logger.error('Missing critical mappings');
  return null;
}

return {
  provider: {
    id: providerCode,
    name: payload.doctorName
  },
  location: locationCode || 'DEFAULT_LOCATION',
  service: {
    code: serviceCode,
    description: payload.serviceDescription
  },
  appointment: {
    date: payload.appointmentDate,
    time: payload.appointmentTime
  }
};`}</pre>
                  </div>

                  {/* Best Practices */}
                  <div className="console-margin-bottom-5">
                    <Heading level={4}>
                      <GatewayIcon name="BulbOutlined" className="console-text-warning console-margin-right-2" />
                      Best Practices
                    </Heading>

                    <Space direction="vertical" size="middle" className="console-width-full">
                      <Card size="small" className="lookup-guide-rule lookup-guide-rule--success">
                        <AstryxText weight="semibold" className="console-text-success">
                          DO
                        </AstryxText>
                        <AstryxText as="p" display="block" className="console-margin-top-1">
                          Use meaningful lookup type names like <code>SERVICE_CODE</code>, not generic names like{' '}
                          <code>CODE_1</code>
                        </AstryxText>
                      </Card>

                      <Card size="small" className="lookup-guide-rule lookup-guide-rule--success">
                        <AstryxText weight="semibold" className="console-text-success">
                          DO
                        </AstryxText>
                        <AstryxText as="p" display="block" className="console-margin-top-1">
                          Always handle null returns from <code>lookup()</code> - not all codes may have mappings
                        </AstryxText>
                      </Card>

                      <Card size="small" className="lookup-guide-rule lookup-guide-rule--success">
                        <AstryxText weight="semibold" className="console-text-success">
                          DO
                        </AstryxText>
                        <AstryxText as="p" display="block" className="console-margin-top-1">
                          Use the logger to track unmapped codes for troubleshooting: <code>logger.warn()</code>
                        </AstryxText>
                      </Card>

                      <Card size="small" className="lookup-guide-rule lookup-guide-rule--error">
                        <AstryxText weight="semibold" className="console-text-error">
                          AVOID
                        </AstryxText>
                        <AstryxText as="p" display="block" className="console-margin-top-1">
                          Don't use lookups for complex transformations - use them only for simple code mapping
                        </AstryxText>
                      </Card>

                      <Card size="small" className="lookup-guide-rule lookup-guide-rule--error">
                        <AstryxText weight="semibold" className="console-text-error">
                          AVOID
                        </AstryxText>
                        <AstryxText as="p" display="block" className="console-margin-top-1">
                          Don't create duplicate lookup types with different names - keep naming consistent
                        </AstryxText>
                      </Card>
                    </Space>
                  </div>
                </div>
              ),
            },
            {
              key: 'examples',
              label: 'Real-World Examples',
              icon: <GatewayIcon name="ThunderboltOutlined" aria-hidden="true" />,
              children: (
                <div>
                  {/* CleverTap Integration */}
                  <div className="console-margin-bottom-5">
                    <Heading level={4}>Example 1: CleverTap CRM Integration</Heading>
                    <AstryxText as="p" display="block">
                      Mapping appointment types to CleverTap event categories:
                    </AstryxText>

                    <AstryxText weight="semibold">Lookup Table Setup:</AstryxText>
                    <div className="console-margin-vertical-3">
                      <Card size="small" className="console-bg-subtle">
                        <AstryxText>
                          Type: <code>APPOINTMENT_TYPE</code>
                        </AstryxText>
                      </Card>
                      <ul className="console-margin-top-2">
                        <li>
                          <code>NEW_PATIENT</code> → <code>first_visit</code>
                        </li>
                        <li>
                          <code>FOLLOW_UP</code> → <code>follow_up_visit</code>
                        </li>
                        <li>
                          <code>EMERGENCY</code> → <code>emergency_visit</code>
                        </li>
                      </ul>
                    </div>

                    <AstryxText weight="semibold">Transformation Script:</AstryxText>
                    <pre className="lookup-guide-code">{`const eventCategory = lookup(payload.appointmentType, 'APPOINTMENT_TYPE');

return {
  identity: payload.email,
  ts: Date.now(),
  type: "event",
  evtName: "Appointment Scheduled",
  evtData: {
    category: eventCategory || 'general_visit',
    doctorName: payload.doctorName,
    appointmentDate: payload.scheduledDate,
    clinicLocation: payload.clinicName
  }
};`}</pre>
                  </div>

                  {/* Billing Integration */}
                  <div className="console-margin-bottom-5">
                    <Heading level={4}>Example 2: Insurance Billing Integration</Heading>
                    <AstryxText as="p" display="block">
                      Converting internal service codes to CPT codes for insurance claims:
                    </AstryxText>

                    <AstryxText weight="semibold">Lookup Table Setup:</AstryxText>
                    <div className="console-margin-vertical-3">
                      <Card size="small" className="console-bg-subtle">
                        <AstryxText>
                          Type: <code>CPT_CODE</code>
                        </AstryxText>
                      </Card>
                      <ul className="console-margin-top-2">
                        <li>
                          <code>GENERAL_CONSULT</code> → <code>99213</code> (Office visit)
                        </li>
                        <li>
                          <code>DETAILED_EXAM</code> → <code>99215</code> (Comprehensive)
                        </li>
                        <li>
                          <code>LAB_CBC</code> → <code>85025</code> (Complete Blood Count)
                        </li>
                      </ul>
                    </div>

                    <AstryxText weight="semibold">Transformation Script:</AstryxText>
                    <pre className="lookup-guide-code">{`const cptCode = lookup(payload.serviceCode, 'CPT_CODE');

if (!cptCode) {
  logger.error(\`Missing CPT mapping for: \${payload.serviceCode}\`);
  return null; // Block submission if CPT code required
}

return {
  claimId: payload.billNumber,
  entityId: payload.entityId,
  services: [{
    code: cptCode,
    description: payload.serviceDescription,
    quantity: 1,
    charges: payload.amount
  }],
  providerNPI: payload.doctorNPI,
  dateOfService: payload.billDate
};`}</pre>
                  </div>

                  {/* Multi-Location Scenario */}
                  <div className="console-margin-bottom-5">
                    <Heading level={4}>Example 3: Multi-Location Provider Network</Heading>
                    <AstryxText as="p" display="block">
                      Different clinics may use different external system IDs. Use entity-specific overrides:
                    </AstryxText>

                    <AstryxText weight="semibold">Setup:</AstryxText>
                    <div className="console-margin-vertical-3">
                      <div>
                        <AstryxText weight="semibold">Parent-level mapping</AstryxText>
                        <div>
                          <AstryxText>
                            Type: <code>PROVIDER_NETWORK_ID</code>
                          </AstryxText>
                        </div>
                        <AstryxText type="supporting" color="secondary">
                          Default clinic mapping: <code>CLINIC_MAIN</code> → <code>NETWORK_001</code>
                        </AstryxText>
                      </div>
                      <div className="console-margin-top-3">
                        <AstryxText weight="semibold">Entity override for Clinic #2</AstryxText>
                        <div>
                          <AstryxText type="supporting" color="secondary">
                            Entity RID: 150
                          </AstryxText>
                        </div>
                        <AstryxText type="supporting" color="secondary">
                          <code>CLINIC_MAIN</code> → <code>NETWORK_BRANCH_05</code>
                        </AstryxText>
                      </div>
                    </div>

                    <AstryxText weight="semibold">Result:</AstryxText>
                    <AstryxText as="p" display="block">
                      When events come from Clinic #2 (entity RID 150), the lookup will use{' '}
                      <code>NETWORK_BRANCH_05</code> instead of the parent-level <code>NETWORK_001</code>.
                    </AstryxText>
                  </div>
                </div>
              ),
            },
          ];
          return (
            <>
              <TabList
                role="tablist"
                aria-label="Lookup guide sections"
                value={activeTab}
                onChange={setActiveTab}
                hasDivider
              >
                {items.map((item) => (
                  <Tab
                    key={item.key}
                    id={`lookup-guide-${item.key}-tab`}
                    value={item.key}
                    label={item.label}
                    icon={item.icon}
                    panelId={`lookup-guide-${item.key}-panel`}
                  />
                ))}
              </TabList>
              {items.map((item) => (
                <div
                  key={item.key}
                  id={`lookup-guide-${item.key}-panel`}
                  role="tabpanel"
                  aria-labelledby={`lookup-guide-${item.key}-tab`}
                  hidden={activeTab !== item.key}
                  tabIndex={0}
                >
                  {item.children}
                </div>
              ))}
            </>
          );
        })()}

        <Divider />

        {/* Footer Help */}
        <div>
          <Heading level={4}>Need help?</Heading>
          <AstryxText as="p" display="block">
            If you need assistance with lookup setup or code mappings:
          </AstryxText>
          <ul>
            <li>
              Check <strong>Lookup Tables</strong> to view and manage mappings
            </li>
            <li>
              Use <strong>Stats</strong> to see which mappings are used most
            </li>
            <li>
              Review <strong>Delivery Logs</strong> to verify lookup results
            </li>
          </ul>
        </div>
      </div>
    </PageTemplate>
  );
};
