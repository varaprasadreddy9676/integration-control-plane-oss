import type { ReactNode } from 'react';
/**
 * Shared types for integration forms
 */
export type AuthType = 'NONE' | 'API_KEY' | 'BASIC' | 'BEARER' | 'HMAC' | 'OAUTH1' | 'OAUTH2' | 'CUSTOM' | 'CUSTOM_HEADERS';


export type IntegrationMode = 'inbound' | 'outbound' | 'scheduled';

export interface AuthenticationFieldsProps {
  /**
   * Ant Design form instance
   */
  form: any;

  /**
   * UI configuration from backend (auth types, etc.)
   */
  uiConfig?: any;

  /**
   * Currently selected authentication type
   */
  selectedAuthType?: AuthType;

  /**
   * Field prefix for nested form paths
   * e.g., ['outgoingAuthConfig'] for outbound, ['inboundAuthConfig'] for inbound
   */
  fieldPrefix: string[];

  /**
   * Integration mode for context-aware labels
   */
  mode: IntegrationMode;

  /**
   * Spacing tokens from design system
   */
  spacing: any;

  /**
   * Form field name for auth type selection
   * Defaults to 'outgoingAuthType' for backward compatibility
   */
  authTypeFieldName?: string;

  /**
   * How the label of a secret field is drawn (a "secure" badge, for example).
   * Plain text when not given.
   */
  secretLabel?: (label: string) => ReactNode;
}

export interface HttpConfigFieldsProps {
  /**
   * Ant Design form instance
   */
  form: any;

  /**
   * UI configuration from backend (HTTP methods, etc.)
   */
  uiConfig?: any;

  /**
   * Integration mode for context-aware labels
   */
  mode: IntegrationMode;

  /**
   * Design system tokens
   */
  spacing: any;
  colors: any;

  /**
   * Whether this is multi-action mode (for outbound integrations)
   */
  isMultiAction?: boolean;
}
