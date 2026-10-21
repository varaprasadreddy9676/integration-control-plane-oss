import { useState } from 'react';
import { Button } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import { IntegrationHistoryDrawer } from './IntegrationHistoryDrawer';

interface IntegrationHistoryButtonProps {
  /** Omit while creating: a new integration has no history yet. */
  integrationId?: string;
  onRestored?: () => void;
}

/** "History" action for an integration's page header, opening its history drawer. */
export const IntegrationHistoryButton = ({ integrationId, onRestored }: IntegrationHistoryButtonProps) => {
  const [open, setOpen] = useState(false);
  if (!integrationId) return null;
  return (
    <>
      <Button icon={<HistoryOutlined />} onClick={() => setOpen(true)}>
        History
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
