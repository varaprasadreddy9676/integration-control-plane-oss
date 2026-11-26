import { useEffect, useMemo, useState } from 'react';
import { App, Dropdown, Modal, Select, Space, Grid, Switch, Upload } from '@/components/common/LegacyAntdControls';
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { useNavigateWithParams } from '../../../utils/navigation';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { MetaTag } from '../../../components/common/MetaTag';
import { PageHeader } from '../../../components/common/PageHeader';
import { PageTemplate } from '../../../components/common/PageTemplate';
import { FilterBar } from '../../../components/common/FilterBar';
import { ListActions, SearchInput } from '../../../components/common/ListControls';
import { StatePanel } from '../../../components/common/StatePanel';
import { ModernTable } from '../../../components/common/ModernTable';
import {
  getLookups,
  deleteLookup,
  bulkDeleteLookups,
  exportLookups,
  importLookups,
  downloadLookupTemplate,
  getLookupTypes,
  updateLookup,
} from '../../../services/api';
import type { Lookup } from '../../../mocks/types';
import { formatDateTime } from '../../../utils/format';
import { cssVar } from '../../../design-system/utils';
import { createExportProgress } from '../../../utils/export-progress';
import { celebrateActivation } from '../../../design-system/delight';
import { Button } from '../../../components/common/LegacyButton';

export const LookupsRoute = () => {
  const navigate = useNavigateWithParams();
  const location = useLocation();
  const orgId = Number(new URLSearchParams(location.search).get('orgId') || 0);
  const queryClient = useQueryClient();

  const {
    data: lookupsData,
    refetch,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['lookups', orgId],
    queryFn: () => getLookups(),
    staleTime: 60_000,
  });

  const { data: typesData } = useQuery({
    queryKey: ['lookup-types', orgId],
    queryFn: getLookupTypes,
    staleTime: 5 * 60 * 1000,
  });

  const [typeFilter, setTypeFilter] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | undefined>();
  const [hierarchyFilter, setHierarchyFilter] = useState<'parent' | 'entity' | undefined>();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [importType, setImportType] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const { message: msgApi, modal } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;

  // Refetch on navigate (sidebar click)
  useEffect(() => {
    refetch();
  }, [location.key]);

  useEffect(() => {
    setSelectedRowKeys([]);
  }, [typeFilter, statusFilter, hierarchyFilter, searchQuery]);

  const lookups = lookupsData?.lookups || [];
  const types = typesData?.types || [];

  const filtered = useMemo(() => {
    return lookups.filter((item) => {
      // Filter by type
      if (typeFilter && item.type !== typeFilter) return false;

      // Filter by status
      if (statusFilter === 'active' && !item.isActive) return false;
      if (statusFilter === 'inactive' && item.isActive) return false;

      // Filter by hierarchy level
      if (hierarchyFilter === 'parent' && item.orgUnitRid !== null) return false;
      if (hierarchyFilter === 'entity' && item.orgUnitRid === null) return false;

      // Search across source, target, type
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSource = item.source?.id?.toLowerCase().includes(query);
        const matchesTarget = item.target?.id?.toLowerCase().includes(query);
        const matchesType = item.type?.toLowerCase().includes(query);
        const matchesSourceLabel = item.source.label?.toLowerCase().includes(query);
        const matchesTargetLabel = item.target.label?.toLowerCase().includes(query);

        if (!matchesSource && !matchesTarget && !matchesType && !matchesSourceLabel && !matchesTargetLabel)
          return false;
      }

      return true;
    });
  }, [lookups, typeFilter, statusFilter, hierarchyFilter, searchQuery]);

  const onDelete = async (record: Lookup) => {
    modal.confirm({
      title: `Delete this mapping?`,
      content: `This will remove the mapping from ${record.source.id} to ${record.target.id}. This action cannot be undone.`,
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteLookup(record.id);
          msgApi.success('Mapping deleted');
          refetch();
          queryClient.invalidateQueries({ queryKey: ['lookup-types'] });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to delete mapping';
          msgApi.error(errorMessage);
        }
      },
    });
  };

  // Quick toggle active/inactive
  const onQuickToggle = (record: Lookup, checked: boolean, origin?: Element) => {
    modal.confirm({
      title: checked ? 'Activate this mapping?' : 'Deactivate this mapping?',
      content: checked
        ? 'This will make the mapping available for lookups.'
        : 'This will make the mapping unavailable for lookups.',
      okButtonProps: checked ? {} : { danger: true },
      onOk: async () => {
        try {
          await updateLookup(record.id, { ...record, isActive: checked });
          if (checked) celebrateActivation(origin);
          msgApi.success(checked ? 'Mapping activated' : 'Mapping deactivated');
          refetch();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to update mapping';
          msgApi.error(errorMessage);
        }
      },
    });
  };

  // Bulk delete
  const handleBulkDelete = async () => {
    if (selectedRowKeys.length === 0) {
      msgApi.warning('Please select at least one mapping');
      return;
    }

    modal.confirm({
      title: `Delete ${selectedRowKeys.length} mapping(s)?`,
      content: 'This action cannot be undone.',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const result = await bulkDeleteLookups(selectedRowKeys as string[]);
          msgApi.success(`Deleted ${result.deletedCount} mapping(s)`);
          setSelectedRowKeys([]);
          refetch();
          queryClient.invalidateQueries({ queryKey: ['lookup-types'] });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Bulk delete failed';
          msgApi.error(errorMessage);
        }
      },
    });
  };

  // Export
  const handleExport = async () => {
    const { onProgress, finish } = createExportProgress(msgApi, 'Export XLSX');
    try {
      await exportLookups(
        {
          type: typeFilter,
          isActive: statusFilter === 'active' ? true : statusFilter === 'inactive' ? false : undefined,
        },
        { onProgress }
      );
      finish('Export complete');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Export failed';
      finish(errorMessage, true);
    }
  };

  // Import
  const handleImport = async (file: File, type: string) => {
    setIsImporting(true);
    try {
      const result = await importLookups(file, { type });
      setImportOpen(false);
      setImportFile(null);

      modal.success({
        title: 'Import Complete',
        content: (
          <div>
            <p>Imported: {result.imported}</p>
            {result.updated > 0 && <p>Updated: {result.updated}</p>}
            {result.skipped > 0 && <p>Skipped: {result.skipped}</p>}
            {result.errors.length > 0 && (
              <div>
                <p style={{ color: cssVar.error.text, marginTop: 'var(--spacing-2)' }}>
                  Errors: {result.errors.length}
                </p>
                <div className="console-code-scroll-margin-top-2">
                  {result.errors.slice(0, 10).map((err, idx) => (
                    <div key={idx} className="console-type-caption">
                      Row {err.row}: {err.error}
                    </div>
                  ))}
                  {result.errors.length > 10 && (
                    <div className="ui-extracted-2bb6c88a1d">
                      ...and {result.errors.length - 10} more
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ),
      });

      refetch();
      queryClient.invalidateQueries({ queryKey: ['lookup-types'] });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Import failed';
      msgApi.error(errorMessage);
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportClick = () => {
    setImportType(typeFilter || types[0] || '');
    setImportFile(null);
    setImportOpen(true);
  };

  const clearFilters = () => {
    setTypeFilter(undefined);
    setStatusFilter(undefined);
    setHierarchyFilter(undefined);
    setSearchQuery('');
  };

  const hasFilters = typeFilter || statusFilter || hierarchyFilter || searchQuery;
  const activeCount = lookups.filter((item) => item.isActive).length;

  const columns = [
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 120,
      render: (type: string) => <MetaTag>{type}</MetaTag>,
      sorter: (a: Lookup, b: Lookup) => a.type.localeCompare(b.type),
    },
    {
      title: 'Source Code',
      dataIndex: ['source', 'id'],
      key: 'sourceId',
      width: 150,
      render: (id: string | undefined, record: Lookup) => (
        <div>
          <Text weight="semibold" maxLines={1} hasTruncateTooltip="above">
            {id || '—'}
          </Text>
          {record.source.label && (
            <Text type="supporting" color="secondary" size="sm" display="block" maxLines={1} hasTruncateTooltip="above">
              {record.source.label}
            </Text>
          )}
        </div>
      ),
    },
    {
      title: 'Target Code',
      dataIndex: ['target', 'id'],
      key: 'targetId',
      width: 150,
      render: (id: string | undefined, record: Lookup) => (
        <div>
          <Text weight="semibold" maxLines={1} hasTruncateTooltip="above">
            {id || '—'}
          </Text>
          {record.target.label && (
            <Text type="supporting" color="secondary" size="sm" display="block" maxLines={1} hasTruncateTooltip="above">
              {record.target.label}
            </Text>
          )}
        </div>
      ),
    },
    {
      title: 'Level',
      dataIndex: 'orgUnitRid',
      key: 'level',
      width: 90,
      render: (orgUnitRid: number | null) => <MetaTag>{orgUnitRid === null ? 'Parent' : 'Entity'}</MetaTag>,
      sorter: (a: Lookup, b: Lookup) => {
        if (a.orgUnitRid === null && b.orgUnitRid !== null) return -1;
        if (a.orgUnitRid !== null && b.orgUnitRid === null) return 1;
        return 0;
      },
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 110,
      render: (isActive: boolean, record: Lookup) => (
        <Space size={6}>
          <StatusBadge
            status={isActive ? 'SUCCESS' : 'SKIPPED'}
            label={isActive ? 'Active' : 'Inactive'}
            showIcon={false}
            size="small"
          />
          <Switch
            aria-label={`${isActive ? 'Deactivate' : 'Activate'} mapping ${record.source.id}`}
            checked={isActive}
            size="small"
            onChange={(checked, event) => onQuickToggle(record, checked, event.currentTarget)}
          />
        </Space>
      ),
      sorter: (a: Lookup, b: Lookup) => Number(b.isActive) - Number(a.isActive),
    },
    {
      title: 'Usage',
      dataIndex: 'usageCount',
      key: 'usageCount',
      width: 75,
      render: (count: number) => <Text>{count.toLocaleString()}</Text>,
      sorter: (a: Lookup, b: Lookup) => a.usageCount - b.usageCount,
    },
    {
      title: 'Last Used',
      dataIndex: 'lastUsedAt',
      key: 'lastUsedAt',
      width: 140,
      render: (date: string | null) =>
        date ? (
          formatDateTime(date)
        ) : (
          <Text type="supporting" color="secondary">
            Never
          </Text>
        ),
      sorter: (a: Lookup, b: Lookup) => {
        if (!a.lastUsedAt) return 1;
        if (!b.lastUsedAt) return -1;
        return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime();
      },
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 140,
      render: (date: string) => formatDateTime(date),
      sorter: (a: Lookup, b: Lookup) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 64,
      render: (_: any, record: Lookup) => (
        <Dropdown
          menu={{
            items: [
              {
                key: 'edit',
                label: 'Edit',
                onClick: () => navigate(`/lookups/${record.id}`),
              },
              {
                key: 'delete',
                label: 'Delete',
                danger: true,
                onClick: () => onDelete(record),
              },
            ],
          }}
          trigger={['click']}
        >
          <Button type="text" size="small" icon={<GatewayIcon name="MoreOutlined" />} />
        </Dropdown>
      ),
    },
  ];

  return (
    <PageTemplate
      as="main"
      className="lookup-workspace"
      contentClassName="lookup-workspace__content"
      header={
        <PageHeader
          title="Lookup tables"
          description={
            <>
              Manage code mappings between systems. <a onClick={() => navigate('/help/lookup-guide')}>View guide</a>
            </>
          }
          actions={
            <Space wrap size={8}>
              <Button
                icon={<GatewayIcon name="DownloadOutlined" />}
                onClick={handleExport}
                disabled={lookups.length === 0}
              >
                Export
              </Button>
              <Button icon={<GatewayIcon name="UploadOutlined" />} onClick={handleImportClick}>
                Import
              </Button>
              <Button
                type="primary"
                icon={<GatewayIcon name="PlusOutlined" />}
                onClick={() => navigate('/lookups/new')}
              >
                New mapping
              </Button>
            </Space>
          }
        />
      }
    >
      <section className="lookup-summary" aria-label="Lookup table summary">
        <div className="lookup-summary-item">
          <span>Total mappings</span>
          <strong>{lookups.length.toLocaleString()}</strong>
        </div>
        <div className="lookup-summary-item">
          <span>Showing</span>
          <strong>{filtered.length.toLocaleString()}</strong>
        </div>
        <div className="lookup-summary-item">
          <span>Active</span>
          <strong>{activeCount.toLocaleString()}</strong>
        </div>
        <div className="lookup-summary-item">
          <span>Mapping types</span>
          <strong>{types.length.toLocaleString()}</strong>
        </div>
      </section>

      <FilterBar
        rightSlot={
          <ListActions onReset={clearFilters} onRefresh={() => refetch()} refreshLabel="Refresh lookup tables" />
        }
      >
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          isNarrow={isNarrow}
          label="Search lookup mappings"
          placeholder="Search source, target, label, or type"
          width={280}
        />
        <Select
          aria-label="Filter by mapping type"
          placeholder="All types"
          style={{ width: isNarrow ? '100%' : 170 }}
          value={typeFilter}
          onChange={setTypeFilter}
          allowClear
          options={types.map((type) => ({ label: type, value: type }))}
        />
        <Select
          aria-label="Filter by status"
          placeholder="Any status"
          style={{ width: isNarrow ? '100%' : 140 }}
          value={statusFilter}
          onChange={setStatusFilter}
          allowClear
          options={[
            { label: 'Active', value: 'active' },
            { label: 'Inactive', value: 'inactive' },
          ]}
        />
        <Select
          aria-label="Filter by mapping level"
          placeholder="Any level"
          style={{ width: isNarrow ? '100%' : 140 }}
          value={hierarchyFilter}
          onChange={setHierarchyFilter}
          allowClear
          options={[
            { label: 'Parent level', value: 'parent' },
            { label: 'Entity level', value: 'entity' },
          ]}
        />
      </FilterBar>

      {hasFilters && (
        <div className="lookup-filter-status" role="status">
          Showing {filtered.length.toLocaleString()} of {lookups.length.toLocaleString()} mappings
        </div>
      )}

      {selectedRowKeys.length > 0 && (
        <div className="lookup-selection-bar">
          <Text weight="semibold">{selectedRowKeys.length} mappings selected</Text>
          <Space size={8}>
            <Button danger icon={<GatewayIcon name="DeleteOutlined" />} onClick={handleBulkDelete}>
              Delete selected
            </Button>
            <Button type="text" onClick={() => setSelectedRowKeys([])}>
              Clear selection
            </Button>
          </Space>
        </div>
      )}

      {isError ? (
        <div className="lookup-table-surface">
          <StatePanel
            glyph="disrupted"
            tone="critical"
            title="Lookup tables could not be loaded"
            description={error instanceof Error ? error.message : 'The service returned an unexpected error.'}
            actions={<Button onClick={() => refetch()}>Try again</Button>}
          />
        </div>
      ) : (
        <div className="lookup-table-surface">
          <ModernTable<Lookup>
            dataSource={filtered}
            columns={columns}
            rowKey="id"
            loading={isLoading}
            rowSelection={{
              selectedRowKeys,
              onChange: setSelectedRowKeys,
            }}
            pagination={{
              pageSize: 50,
              showSizeChanger: true,
              showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} mappings`,
            }}
            emptyState={
              lookups.length === 0
                ? {
                    title: 'No lookup mappings yet',
                    description: 'Create a mapping or import a spreadsheet to get started.',
                    action: (
                      <Button
                        type="primary"
                        icon={<GatewayIcon name="PlusOutlined" />}
                        onClick={() => navigate('/lookups/new')}
                      >
                        New mapping
                      </Button>
                    ),
                  }
                : {
                    title: 'No mappings match these filters',
                    description: 'Try a different search or clear the active filters.',
                    action: hasFilters ? <Button onClick={clearFilters}>Clear filters</Button> : undefined,
                  }
            }
          />
        </div>
      )}

      <Modal
        title="Import lookup mappings"
        open={importOpen}
        onCancel={() => {
          if (!isImporting) {
            setImportOpen(false);
            setImportFile(null);
          }
        }}
        footer={[
          <Button key="template" disabled={!importType} onClick={() => downloadLookupTemplate(importType)}>
            Download template
          </Button>,
          <Button key="cancel" disabled={isImporting} onClick={() => setImportOpen(false)}>
            Cancel
          </Button>,
          <Button
            key="import"
            type="primary"
            loading={isImporting}
            disabled={!importType.trim() || !importFile}
            onClick={() => importFile && handleImport(importFile, importType.trim())}
          >
            Import file
          </Button>,
        ]}
        destroyOnHidden
      >
        <div className="lookup-import-form">
          <Text type="supporting" color="secondary">
            Choose a mapping type and a CSV or Excel file. Existing entries may be updated by the import.
          </Text>
          <label className="lookup-import-label" htmlFor="lookup-import-type">
            Mapping type
          </label>
          <Select
            id="lookup-import-type"
            aria-label="Mapping type"
            mode="tags"
            maxCount={1}
            tokenSeparators={[',']}
            value={importType ? [importType] : []}
            onChange={(values) => setImportType(values[0] || '')}
            options={types.map((type) => ({ label: type, value: type }))}
            placeholder="Select an existing type or enter a new one"
            className="console-width-full"
          />
          <Upload
            accept=".xlsx,.xls,.csv"
            maxCount={1}
            beforeUpload={(file) => {
              setImportFile(file);
              return false;
            }}
            onRemove={() => {
              setImportFile(null);
              return true;
            }}
            disabled={isImporting}
          >
            <Button icon={<GatewayIcon name="UploadOutlined" />} disabled={isImporting}>
              Choose file
            </Button>
          </Upload>
          <Text type="supporting" color="secondary" className="lookup-import-file-hint">
            {importFile ? importFile.name : 'Accepted formats: .csv, .xls, .xlsx'}
          </Text>
        </div>
      </Modal>
    </PageTemplate>
  );
};
