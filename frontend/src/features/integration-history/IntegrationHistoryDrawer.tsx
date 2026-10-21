import { useEffect, useMemo, useState } from 'react';
import { App, Alert, Button, Drawer, Empty, Grid, Select, Skeleton, Space, Tag, Typography } from 'antd';
import { HistoryOutlined, RollbackOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  getIntegrationRevisionDiff,
  getIntegrationRevisions,
  restoreIntegrationRevision,
  type IntegrationRevisionSummary,
} from '../../services/api';
import { cssVar } from '../../design-system/utils';
import { formatDateTime } from '../../utils/format';
import { RevisionChanges } from './RevisionChanges';

const SOURCE_LABEL: Record<IntegrationRevisionSummary['source'], string> = {
  BASELINE: 'Before history began',
  CREATED: 'Created',
  UPDATED: 'Edited',
  RESTORED: 'Restored',
};

const MAX_FIELD_TAGS = 3;

interface IntegrationHistoryDrawerProps {
  open: boolean;
  integrationId: string;
  onClose: () => void;
  /** Called after a restore so the page can reload the integration. */
  onRestored?: () => void;
}

const RevisionItem = ({
  revision,
  isCurrent,
  selected,
  onSelect,
}: {
  revision: IntegrationRevisionSummary;
  isCurrent: boolean;
  selected: boolean;
  onSelect: () => void;
}) => {
  const extraFields = revision.changedFields.length - MAX_FIELD_TAGS;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Revision ${revision.revision}`}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: 12,
        borderRadius: 8,
        cursor: 'pointer',
        border: `1px solid ${selected ? cssVar.primary[500] : cssVar.border.subtle}`,
        background: selected ? cssVar.primary[50] : cssVar.bg.surface,
        color: cssVar.text.primary,
        transition: 'border-color 150ms ease-out, background-color 150ms ease-out',
      }}
    >
      <Space size={6} wrap>
        <Typography.Text strong>Revision {revision.revision}</Typography.Text>
        {isCurrent && <Tag color="green">Current</Tag>}
        <Tag>
          {revision.source === 'RESTORED' && revision.restoredFrom
            ? `Restored from ${revision.restoredFrom}`
            : SOURCE_LABEL[revision.source]}
        </Tag>
      </Space>
      <div style={{ marginTop: 4, fontSize: 12, color: cssVar.text.secondary }}>
        <span title={formatDateTime(revision.createdAt)}>{dayjs(revision.createdAt).format('MMM D, HH:mm')}</span>
        {revision.changedBy?.email && (
          <>
            {' · '}
            <span>{revision.changedBy.email}</span>
          </>
        )}
      </div>
      {revision.changedFields.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {revision.changedFields.slice(0, MAX_FIELD_TAGS).map((field) => (
            <Tag key={field} style={{ margin: 0, fontSize: 11 }}>
              {field}
            </Tag>
          ))}
          {extraFields > 0 && <Tag style={{ margin: 0, fontSize: 11 }}>+{extraFields} more</Tag>}
        </div>
      )}
    </button>
  );
};

/**
 * Every saved version of an integration: who changed what, a comparison with the
 * current configuration (or another revision), and restore.
 */
export const IntegrationHistoryDrawer = ({ open, integrationId, onClose, onRestored }: IntegrationHistoryDrawerProps) => {
  const { modal, message } = App.useApp();
  const queryClient = useQueryClient();
  const screens = Grid.useBreakpoint();
  const [selected, setSelected] = useState<number | null>(null);
  const [against, setAgainst] = useState<number | 'current'>('current');

  const historyQuery = useQuery({
    queryKey: ['integration-history', integrationId],
    queryFn: () => getIntegrationRevisions(integrationId),
    enabled: open && Boolean(integrationId),
  });
  const revisions = historyQuery.data?.revisions || [];
  const latest = revisions[0]?.revision ?? null;

  // Start on the revision before the current one: the most useful comparison.
  useEffect(() => {
    if (!open || selected !== null || revisions.length === 0) return;
    setSelected(revisions[1]?.revision ?? revisions[0].revision);
  }, [open, revisions, selected]);

  const diffQuery = useQuery({
    queryKey: ['integration-history-diff', integrationId, selected, against],
    queryFn: () => getIntegrationRevisionDiff(integrationId, selected as number, against),
    enabled: open && selected !== null && selected !== against,
  });

  const restore = useMutation({
    mutationFn: (revision: number) => restoreIntegrationRevision(integrationId, revision),
    onSuccess: (result) => {
      message.success(`Restored revision ${result.restoredFrom}. Saved as revision ${result.revision}.`);
      setSelected(null);
      setAgainst('current');
      queryClient.invalidateQueries({ queryKey: ['integration-history', integrationId] });
      queryClient.invalidateQueries({ queryKey: ['integration-history-diff', integrationId] });
      onRestored?.();
    },
    onError: (error: Error) => message.error(error.message || 'Could not restore this revision'),
  });

  const confirmRestore = (revision: number) => {
    modal.confirm({
      title: `Restore revision ${revision}?`,
      content:
        'The current configuration is replaced with this revision. Whether the integration is active does not change, and the current configuration stays in history, so you can undo this.',
      okText: 'Restore',
      cancelText: 'Cancel',
      onOk: () => restore.mutateAsync(revision),
    });
  };

  const compareOptions = useMemo(
    () => [
      { label: 'Current configuration', value: 'current' as const },
      ...revisions.filter((r) => r.revision !== selected).map((r) => ({ label: `Revision ${r.revision}`, value: r.revision })),
    ],
    [revisions, selected]
  );

  const forbidden = (historyQuery.error as { statusCode?: number } | null)?.statusCode === 403;
  const integrationName = historyQuery.data?.integration.name;
  const selectedIsCurrent = selected === latest && against === 'current';

  const renderDetails = () => {
    if (selected === null) return null;
    if (selectedIsCurrent) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="This is the current configuration. Pick an earlier revision, or compare it with one."
        />
      );
    }
    if (diffQuery.isLoading) return <Skeleton active paragraph={{ rows: 6 }} />;
    if (diffQuery.isError) return <Alert type="error" showIcon message="Could not load the comparison" />;
    if (!diffQuery.data) return null;
    return (
      <RevisionChanges
        diff={diffQuery.data}
        fromLabel={`Revision ${selected}`}
        toLabel={against === 'current' ? 'Current' : `Revision ${against}`}
      />
    );
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={screens.lg ? 1080 : '100%'}
      destroyOnClose
      title={
        <Space>
          <HistoryOutlined aria-hidden />
          <span>History{integrationName ? ` · ${integrationName}` : ''}</span>
        </Space>
      }
    >
      {historyQuery.isLoading && <Skeleton active paragraph={{ rows: 8 }} />}
      {historyQuery.isError && (
        <Alert
          type={forbidden ? 'warning' : 'error'}
          showIcon
          message={forbidden ? 'You do not have access to this integration’s history.' : 'Could not load history'}
          description={forbidden ? 'Ask an organization admin for the “Access version history” permission.' : undefined}
        />
      )}
      {historyQuery.isSuccess && revisions.length === 0 && (
        <Empty description="No history yet. Each save from now on is recorded here." />
      )}
      {historyQuery.isSuccess && revisions.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: screens.md ? '300px minmax(0, 1fr)' : '1fr',
            gap: 20,
            alignItems: 'start',
          }}
        >
          <nav aria-label="Revisions" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {revisions.map((revision) => (
              <RevisionItem
                key={revision.revision}
                revision={revision}
                isCurrent={revision.revision === latest}
                selected={revision.revision === selected}
                onSelect={() => {
                  setSelected(revision.revision);
                  if (against === revision.revision) setAgainst('current');
                }}
              />
            ))}
          </nav>
          <section aria-label="Changes" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {selected !== null && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
                <Space wrap>
                  <Typography.Text strong>Revision {selected}</Typography.Text>
                  <Typography.Text type="secondary">compared with</Typography.Text>
                  <Select
                    aria-label="Compare with"
                    value={against}
                    onChange={setAgainst}
                    options={compareOptions}
                    style={{ minWidth: 200 }}
                  />
                </Space>
                {selected !== latest && (
                  <Button
                    type="primary"
                    icon={<RollbackOutlined />}
                    loading={restore.isPending}
                    onClick={() => confirmRestore(selected)}
                  >
                    Restore revision {selected}
                  </Button>
                )}
              </div>
            )}
            {renderDetails()}
          </section>
        </div>
      )}
    </Drawer>
  );
};
