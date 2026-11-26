import { useEffect, useMemo, useState } from 'react';
import { App, Drawer, Grid, Select, Space } from '@/components/common/LegacyAntdControls';
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../components/common/Icon';
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
import { StatePanel } from '../../components/common/StatePanel';
import { Button } from '../../components/common/LegacyButton';
import { MetaTag } from '../../components/common/MetaTag';
import { StatusBadge } from '../../components/common/StatusBadge';

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
        padding: 'var(--spacing-3)',
        borderRadius: 8,
        cursor: 'pointer',
        border: `1px solid ${selected ? cssVar.primary[500] : cssVar.border.subtle}`,
        background: selected ? cssVar.primary[50] : cssVar.bg.surface,
        color: cssVar.text.primary,
        transition: 'border-color 150ms ease-out, background-color 150ms ease-out',
      }}
    >
      <Space size={6} wrap>
        <Text weight="semibold">Revision {revision.revision}</Text>
        {isCurrent && <StatusBadge label="Current" variant="success" size="small" showIcon={false} />}
        <Text as="span" type="supporting" color="secondary">
          {revision.source === 'RESTORED' && revision.restoredFrom
            ? `Restored from ${revision.restoredFrom}`
            : SOURCE_LABEL[revision.source]}
        </Text>
      </Space>
      <Text as="div" display="block" type="supporting" color="secondary" className="console-margin-top-1">
        <span title={formatDateTime(revision.createdAt)}>{dayjs(revision.createdAt).format('MMM D, HH:mm')}</span>
        {revision.changedBy?.email && (
          <>
            {' · '}
            <span>{revision.changedBy.email}</span>
          </>
        )}
      </Text>
      {revision.changedFields.length > 0 && (
        <div className="ui-extracted-4dd65c232f">
          {revision.changedFields.slice(0, MAX_FIELD_TAGS).map((field) => (
            <MetaTag key={field} variant="neutral" size="small">
              {field}
            </MetaTag>
          ))}
          {extraFields > 0 && <MetaTag size="small">+{extraFields} more</MetaTag>}
        </div>
      )}
    </button>
  );
};

/**
 * Every saved version of an integration: who changed what, a comparison with the
 * current configuration (or another revision), and restore.
 */
export const IntegrationHistoryDrawer = ({
  open,
  integrationId,
  onClose,
  onRestored,
}: IntegrationHistoryDrawerProps) => {
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
      ...revisions
        .filter((r) => r.revision !== selected)
        .map((r) => ({ label: `Revision ${r.revision}`, value: r.revision })),
    ],
    [revisions, selected]
  );

  const forbidden = (historyQuery.error as { statusCode?: number } | null)?.statusCode === 403;
  const integrationName = historyQuery.data?.integration?.name;
  const selectedIsCurrent = selected === latest && against === 'current';

  const renderDetails = () => {
    if (selected === null) return null;
    if (selectedIsCurrent) {
      return (
        <StatePanel
          size="compact"
          glyph="searching"
          title="Current configuration"
          description="Select an earlier revision to compare."
        />
      );
    }
    if (diffQuery.isLoading)
      return <StatePanel glyph="connecting" tone="busy" title="Loading comparison" size="compact" />;
    if (diffQuery.isError)
      return <StatePanel glyph="disrupted" tone="critical" title="Comparison unavailable" size="compact" />;
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
          <GatewayIcon name="HistoryOutlined" aria-hidden />
          <span>History{integrationName ? ` · ${integrationName}` : ''}</span>
        </Space>
      }
    >
      {historyQuery.isLoading && <StatePanel glyph="connecting" tone="busy" title="Loading history" />}
      {historyQuery.isError && (
        <StatePanel
          glyph={forbidden ? undefined : 'disrupted'}
          tone={forbidden ? 'neutral' : 'critical'}
          size="compact"
          title={forbidden ? 'History access required' : 'Could not load history'}
          description={
            forbidden
              ? 'Ask an organization admin for the “Access version history” permission.'
              : 'Check your connection and try again.'
          }
          actions={
            forbidden ? undefined : (
              <Button type="primary" onClick={() => historyQuery.refetch()} loading={historyQuery.isFetching}>
                Retry
              </Button>
            )
          }
        />
      )}
      {historyQuery.isSuccess && revisions.length === 0 && (
        <StatePanel size="compact" glyph="searching" title="No revision history yet" />
      )}
      {historyQuery.isSuccess && revisions.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: screens.md ? '300px minmax(0, 1fr)' : '1fr',
            gap: 'var(--spacing-5)',
            alignItems: 'start',
          }}
        >
          <nav aria-label="Revisions" className="console-stack-vertical-gap-2">
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
          <section
            aria-label="Changes"
            className="ui-extracted-e71c651d0b"
          >
            {selected !== null && (
              <div
                className="ui-extracted-7a2d2b9b1c"
              >
                <Space wrap>
                  <Text weight="semibold">Revision {selected}</Text>
                  <Text type="supporting" color="secondary">
                    compared with
                  </Text>
                  <Select
                    aria-label="Compare with"
                    value={against}
                    onChange={setAgainst}
                    options={compareOptions}
                    className="ui-extracted-e90dbd8593"
                  />
                </Space>
                {selected !== latest && (
                  <Button
                    type="primary"
                    icon={<GatewayIcon name="RollbackOutlined" />}
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
