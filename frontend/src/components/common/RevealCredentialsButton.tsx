import { useState } from 'react';
import { App, Button, Tooltip } from 'antd';
import type { FormInstance } from 'antd';
import { EyeOutlined } from '@ant-design/icons';
import { useAuth } from '../../app/auth-context';
import { fillMaskedValues, hasMaskedValues } from '../../utils/credentials';

interface RevealCredentialsButtonProps {
  integrationId?: string;
  form: FormInstance;
  /** Calls the super-admin-only, audited credentials endpoint. */
  fetchCredentials: (id: string) => Promise<unknown>;
  /** Shapes the revealed document the way this page's form holds it. */
  toFormValues: (document: any) => Record<string, unknown>;
}

/**
 * Stored credentials are masked for everyone. Super admins can reveal them
 * into the open form; the server records every reveal in the audit log.
 */
export const RevealCredentialsButton = ({
  integrationId,
  form,
  fetchCredentials,
  toFormValues,
}: RevealCredentialsButtonProps) => {
  const { user } = useAuth();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);

  if (user?.role !== 'SUPER_ADMIN' || !integrationId) return null;

  const reveal = async () => {
    const current = form.getFieldsValue(true);
    if (!hasMaskedValues(current)) {
      message.info('There are no hidden credentials on this integration.');
      return;
    }
    setLoading(true);
    try {
      const document = await fetchCredentials(integrationId);
      form.setFieldsValue(fillMaskedValues(current, toFormValues(document)));
      message.success('Credentials revealed. This view has been recorded in the audit log.');
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not reveal credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Tooltip title="Show the stored passwords, keys and tokens (super admin only, audited)">
      <Button icon={<EyeOutlined />} onClick={reveal} loading={loading}>
        Reveal credentials
      </Button>
    </Tooltip>
  );
};
