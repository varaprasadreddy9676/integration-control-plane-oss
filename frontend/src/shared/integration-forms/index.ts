/**
 * Shared integration form components
 *
 * These components are used across:
 * - Outbound Integrations (event-driven integrations)
 * - Inbound Integrations (real-time API proxy)
 * - Scheduled Jobs (cron/interval triggered)
 *
 * By centralizing these components, we ensure:
 * - Consistent UX across all integration types
 * - DRY principle (no code duplication)
 * - Easy maintenance and updates
 */

// Authentication
export { AuthenticationFields, HelpPopover } from './authentication';

// HTTP Configuration
export { HttpConfigFields } from './http';

// Types
export type {
  AuthType,
  IntegrationMode,
  AuthenticationFieldsProps,
  HttpConfigFieldsProps
} from './types';
