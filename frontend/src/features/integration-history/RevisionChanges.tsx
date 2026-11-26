import { Segmented, Table } from '@/components/common/LegacyAntdControls';
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../components/common/Icon';
import { DiffEditor } from '@monaco-editor/react';
import { useState } from 'react';
import { Button } from '../../components/common/LegacyButton';
import type { IntegrationRevisionChange, IntegrationRevisionDiff } from '../../services/api';
import { cssVar } from '../../design-system/utils';
import { useThemeMode } from '../../app/theme-provider';
import { StatePanel } from '../../components/common/StatePanel';

const KIND_LABEL: Record<IntegrationRevisionChange['kind'], string> = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
};

const formatValue = (value: unknown) => {
  if (value === undefined) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
};

const ValueCell = ({ change, value }: { change: IntegrationRevisionChange; value: unknown }) => {
  const [expanded, setExpanded] = useState(false);
  if (value === undefined)
    return (
      <Text type="supporting" color="secondary">
        —
      </Text>
    );
  if (change.secret) {
    return (
      <Text type="supporting" color="secondary">
        <GatewayIcon name="LockOutlined" aria-hidden /> Hidden
      </Text>
    );
  }
  return (
    <>
      <Text
        as="p"
        display="block"
        type="code"
        size="sm"
        className="console-code-reset-wrap"
        maxLines={expanded ? 0 : 4}
      >
        {formatValue(value)}
      </Text>
      {String(formatValue(value)).split('\n').length > 4 && (
        <Button size="small" type="link" onClick={() => setExpanded((current) => !current)}>
          {expanded ? 'Show less' : 'Show all'}
        </Button>
      )}
    </>
  );
};

interface RevisionChangesProps {
  diff: IntegrationRevisionDiff;
  /** Labels for the two sides, e.g. "Revision 2" and "Current". */
  fromLabel: string;
  toLabel: string;
}

/** What differs between two configurations: a field list, or the full JSON side by side. */
export const RevisionChanges = ({ diff, fromLabel, toLabel }: RevisionChangesProps) => {
  const [view, setView] = useState<'fields' | 'side-by-side'>('fields');
  const { mode } = useThemeMode();

  if (diff.changes.length === 0) {
    return (
      <StatePanel
        size="compact"
        glyph="searching"
        title="No configuration changes"
        description={`${fromLabel} is identical to ${toLabel.toLowerCase()}.`}
      />
    );
  }

  return (
    <div className="ui-extracted-99f7e0d87d">
      <Segmented
        value={view}
        onChange={(value) => setView(value as typeof view)}
        options={[
          { label: `Changed fields (${diff.changes.length})`, value: 'fields' },
          { label: 'Side by side', value: 'side-by-side' },
        ]}
        aria-label="How to show the changes"
      />
      {view === 'fields' ? (
        <Table<IntegrationRevisionChange>
          size="small"
          rowKey="path"
          pagination={false}
          dataSource={diff.changes}
          scroll={{ x: 640 }}
          columns={[
            {
              title: 'Field',
              dataIndex: 'path',
              width: 220,
              render: (path: string, change) => (
                <div className="ui-extracted-30ed93c9fe">
                  <Text type="code" size="sm">
                    {path}
                  </Text>
                  <Text type="supporting" color="secondary">
                    {KIND_LABEL[change.kind]}
                  </Text>
                </div>
              ),
            },
            {
              title: fromLabel,
              key: 'before',
              render: (_, change) => <ValueCell change={change} value={change.before} />,
            },
            { title: toLabel, key: 'after', render: (_, change) => <ValueCell change={change} value={change.after} /> },
          ]}
        />
      ) : (
        <div style={{ border: `1px solid ${cssVar.border.default}`, borderRadius: 8, overflow: 'hidden' }}>
          <DiffEditor
            height={480}
            language="json"
            theme={mode === 'dark' ? 'vs-dark' : 'light'}
            original={JSON.stringify(diff.fromSnapshot, null, 2)}
            modified={JSON.stringify(diff.toSnapshot, null, 2)}
            options={{
              readOnly: true,
              renderSideBySide: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
            }}
          />
        </div>
      )}
    </div>
  );
};
