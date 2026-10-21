import { Empty, Segmented, Table, Tag, Typography } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { DiffEditor } from '@monaco-editor/react';
import { useState } from 'react';
import type { IntegrationRevisionChange, IntegrationRevisionDiff } from '../../services/api';
import { cssVar } from '../../design-system/utils';
import { useThemeMode } from '../../app/theme-provider';

const KIND_LABEL: Record<IntegrationRevisionChange['kind'], { label: string; color: string }> = {
  added: { label: 'Added', color: 'green' },
  removed: { label: 'Removed', color: 'red' },
  changed: { label: 'Changed', color: 'blue' },
};

const formatValue = (value: unknown) => {
  if (value === undefined) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
};

const ValueCell = ({ change, value }: { change: IntegrationRevisionChange; value: unknown }) => {
  if (value === undefined) return <Typography.Text type="secondary">—</Typography.Text>;
  if (change.secret) {
    return (
      <Typography.Text type="secondary">
        <LockOutlined aria-hidden /> Hidden
      </Typography.Text>
    );
  }
  return (
    <Typography.Paragraph
      style={{ margin: 0, fontFamily: 'var(--font-mono, monospace)', fontSize: 12, whiteSpace: 'pre-wrap' }}
      ellipsis={{ rows: 4, expandable: true, symbol: 'Show all' }}
    >
      {formatValue(value)}
    </Typography.Paragraph>
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
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`${fromLabel} is identical to ${toLabel.toLowerCase()}`} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <Typography.Text code style={{ fontSize: 12 }}>
                    {path}
                  </Typography.Text>
                  <Tag color={KIND_LABEL[change.kind].color} style={{ width: 'fit-content' }}>
                    {KIND_LABEL[change.kind].label}
                  </Tag>
                </div>
              ),
            },
            { title: fromLabel, key: 'before', render: (_, change) => <ValueCell change={change} value={change.before} /> },
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
            options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, scrollBeyondLastLine: false }}
          />
        </div>
      )}
    </div>
  );
};
