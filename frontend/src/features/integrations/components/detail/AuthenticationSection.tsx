import type { FormInstance } from "@/components/common/LegacyAntdControls";
import { AuthenticationFields } from '../../../../shared/integration-forms';
import { SecureLabel } from './shared';

interface AuthenticationSectionProps {
  form: FormInstance;
  uiConfig?: any;
  selectedAuthType?: string;
  isMultiAction: boolean;
  spacing: any;
}

/**
 * Authentication of an outbound integration: the shared authentication fields
 * (the same ones inbound integrations and scheduled jobs use), with a "secure"
 * badge on every secret.
 */
export const AuthenticationSection = ({ form, uiConfig, selectedAuthType, spacing }: AuthenticationSectionProps) => (
  <AuthenticationFields
    form={form}
    uiConfig={uiConfig}
    selectedAuthType={selectedAuthType as any}
    fieldPrefix={['outgoingAuthConfig']}
    mode="outbound"
    spacing={spacing}
    secretLabel={(label) => <SecureLabel label={label} />}
  />
);
