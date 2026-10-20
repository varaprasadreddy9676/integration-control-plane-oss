'use strict';

// Default console UI configuration. The backend inserts it on first start;
// scripts/populate-ui-config.js resets to it.
const defaultUIConfig = {
  _id: 'default', // Single document with fixed ID

  // HTTP Methods for integrations
  httpMethods: [
    { value: 'POST', label: 'POST' },
    { value: 'PUT', label: 'PUT' },
    { value: 'GET', label: 'GET' },
    { value: 'DELETE', label: 'DELETE' },
    { value: 'PATCH', label: 'PATCH' }
  ],

  // Authentication types
  authTypes: [
    { value: 'NONE', label: 'None - No authentication' },
    { value: 'API_KEY', label: 'API Key - Custom header' },
    { value: 'BASIC', label: 'Basic Auth - Username & password' },
    { value: 'BEARER', label: 'Bearer Token - Authorization header' },
    { value: 'OAUTH1', label: 'OAuth 1.0a - Signature-based auth (NetSuite, Twitter)' },
    { value: 'OAUTH2', label: 'OAuth 2.0 - Token-based auth' },
    { value: 'CUSTOM', label: 'Custom - Advanced configuration' },
    { value: 'CUSTOM_HEADERS', label: 'Custom Headers - Multiple headers' }
  ],

  // Entity scope options
  scopeTypes: [
    { value: 'ENTITY_ONLY', label: 'This entity only' },
    { value: 'INCLUDE_CHILDREN', label: 'Include child entities' }
  ],

  // Delivery status values
  deliveryStatuses: [
    { value: 'PENDING', label: 'Pending' },
    { value: 'SUCCESS', label: 'Success' },
    { value: 'FAILED', label: 'Failed' },
    { value: 'RETRYING', label: 'Retrying' },
    { value: 'ABANDONED', label: 'Abandoned' }
  ],

  // Transformation modes
  transformationModes: [
    { value: 'SIMPLE', label: 'Simple Mapping' },
    { value: 'SCRIPT', label: 'JavaScript Script' }
  ],

  // Transformation functions (for SIMPLE mode)
  transformationFunctions: [
    { value: 'none', label: 'None' },
    { value: 'trim', label: 'Trim whitespace' },
    { value: 'upper', label: 'Uppercase' },
    { value: 'lower', label: 'Lowercase' },
    { value: 'date', label: 'Format as date' },
    { value: 'default', label: 'Default value if empty' }
  ],

  // Validation rules
  validationRules: {
    timeout: {
      min: 500,
      max: 60000,
      default: 3000,
      step: 500,
      label: 'Timeout (ms)',
      description: 'Request timeout in milliseconds'
    },
    retry: {
      min: 0,
      max: 10,
      default: 3,
      step: 1,
      label: 'Retry Count',
      description: 'Number of retry attempts on failure'
    }
  },

  // Pagination defaults
  pagination: {
    defaultPageSize: 10,
    pageSizeOptions: [10, 20, 50, 100]
  },

  // Analytics time ranges
  analytics: {
    timeRangeOptions: [
      { value: 7, label: 'Last 7 days' },
      { value: 30, label: 'Last 30 days' },
      { value: 90, label: 'Last 90 days' }
    ]
  },

  // Feature flags
  features: {
    advancedTransformations: true,
    multiActionIntegrations: true,
    scheduledDelivery: true,
    integrationSigning: true,
    circuitBreaker: true
  },

  // System limits
  limits: {
    maxIntegrationsPerEntity: 100,
    maxActionsPerIntegration: 10,
    maxTransformationSize: 100000,
    maxRetryAttempts: 5,
    maxScheduledIntegrations: 1000
  },

  // Worker configuration
  worker: {
    multiActionDelayMs: 10000
  },

  // Notification settings
  notifications: {
    failureEmailReports: {
      enabled: true,
      email: 'dev@example.com',
      intervalMinutes: 15,
      lookbackMinutes: 60,
      minFailures: 1,
      maxItems: 25
    }
  },

  // Metadata
  version: '1.0.0',
  createdAt: new Date(),
  updatedAt: new Date(),
  updatedBy: 'system'
};

module.exports = { defaultUIConfig };
