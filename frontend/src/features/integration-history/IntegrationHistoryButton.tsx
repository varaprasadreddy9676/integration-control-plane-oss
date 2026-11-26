import { useState } from 'react';

import { Icon as GatewayIcon } from "../../components/common/Icon";
import { IntegrationHistoryDrawer } from './IntegrationHistoryDrawer';
import { Button } from '../../components/common/LegacyButton';

interface IntegrationHistoryButtonProps {
  /** Omit while creating: a new integration has no history yet. */
  integrationId?: string;
  label?: string;
  onRestored?: () => void;
}

/** "History" action for an integration's page header, opening its history drawer. */
export const IntegrationHistoryButton = ({ integrationId, label = 'History', onRestored }: IntegrationHistoryButtonProps) => {
  const [open, setOpen] = useState(false);
  if (!integrationId) return null;
  return (
    <>
      <Button aria-label={label} icon={<GatewayIcon name="HistoryOutlined" />} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <IntegrationHistoryDrawer
        open={open}
        integrationId={integrationId}
        onClose={() => setOpen(false)}
        onRestored={onRestored}
      />
    </>
  );
};
