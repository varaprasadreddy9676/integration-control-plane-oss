import { useState, useMemo } from 'react';
import { Space, Collapse, Grid, Popconfirm, Tooltip, message } from "@/components/common/LegacyAntdControls";
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from "../../../components/common/Icon";
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAllEventTypes, deleteEventType, importEventTemplates } from '../../../services/api';
import type { EventType } from '../../../services/api';
import { useNavigateWithParams } from '../../../utils/navigation';
import { EventDetailDrawer } from '../components/EventDetailDrawer';
import { PermissionGuard } from '../../../components/common/PermissionGuard';
import { FEATURES } from '../../../utils/permissions';
import { EventTypeEditorModal } from './EventTypeEditorModal';
import { useTenant } from '../../../app/tenant-context';
import { PageHeader } from '../../../components/common/PageHeader';
import { PageTemplate } from '../../../components/common/PageTemplate';
import { FilterBar } from '../../../components/common/FilterBar';
import { SearchInput } from '../../../components/common/ListControls';
import { MetaTag } from '../../../components/common/MetaTag';
import { StatePanel } from '../../../components/common/StatePanel';
import { Button } from '../../../components/common/LegacyButton';

const EVENT_TYPE_CATALOG_QUERY_KEY = 'eventTypeCatalog';

const getEventDisplayLabel = (event: Partial<EventType>) =>
  event.label?.trim() || event.eventType?.trim() || 'Untitled event';

const getEventCategoryLabel = (event: Partial<EventType>) => event.category?.trim() || 'Uncategorized';

const getEventDescription = (event: Partial<EventType>) => event.description?.trim() || '';

export const EventCatalogRoute = () => {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const navigate = useNavigateWithParams();
  const queryClient = useQueryClient();
  const { orgId } = useTenant();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<EventType | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventType | null>(null);
  const [importing, setImporting] = useState(false);

  // Fetch all event types
  const { data: eventTypes = [], isLoading, error, refetch } = useQuery({
    queryKey: [EVENT_TYPE_CATALOG_QUERY_KEY, orgId],
    queryFn: getAllEventTypes,
    staleTime: 10 * 60 * 1000 // 10 minutes
  });

  // Collect categories for the editor modal
  const categories = useMemo(
    () => Array.from(new Set(eventTypes.map(getEventCategoryLabel).filter(Boolean))),
    [eventTypes]
  );

  // Group events by category
  const eventsByCategory = useMemo(() => {
    const filtered = eventTypes.filter((event) => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        (event.eventType || '').toLowerCase().includes(query) ||
        getEventDisplayLabel(event).toLowerCase().includes(query) ||
        getEventDescription(event).toLowerCase().includes(query) ||
        getEventCategoryLabel(event).toLowerCase().includes(query)
      );
    });

    const grouped = filtered.reduce((acc, event) => {
      const category = getEventCategoryLabel(event);
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(event);
      return acc;
    }, {} as Record<string, EventType[]>);

    // Sort categories and events
    const sorted: Record<string, EventType[]> = {};
    Object.keys(grouped).sort().forEach((category) => {
      sorted[category] = grouped[category].sort((a, b) =>
        getEventDisplayLabel(a).localeCompare(getEventDisplayLabel(b))
      );
    });

    return sorted;
  }, [eventTypes, searchQuery]);

  const totalEvents = useMemo(() => {
    return Object.values(eventsByCategory).reduce((sum, events) => sum + events.length, 0);
  }, [eventsByCategory]);

  const handleEventClick = (event: EventType) => {
    setSelectedEvent(event);
    setDrawerOpen(true);
  };

  const handleCreateIntegration = (eventType: string) => {
    navigate(`/integrations/new?eventType=${encodeURIComponent(eventType)}`);
  };

  const handleEdit = (event: EventType, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingEvent(event);
    setEditorOpen(true);
  };

  const handleDelete = async (event: EventType) => {
    try {
      await deleteEventType(event.eventType);
      message.success(`Event type "${getEventDisplayLabel(event)}" deleted`);
      queryClient.invalidateQueries({ queryKey: [EVENT_TYPE_CATALOG_QUERY_KEY] });
    } catch (err: any) {
      message.error(err?.message || 'Failed to delete event type');
    }
  };

  const handleImportTemplates = async () => {
    setImporting(true);
    try {
      const result = await importEventTemplates();
      message.success(result.message);
      queryClient.invalidateQueries({ queryKey: [EVENT_TYPE_CATALOG_QUERY_KEY] });
    } catch (err: any) {
      message.error(err?.message || 'Failed to import templates');
    } finally {
      setImporting(false);
    }
  };

  const handleAddNew = () => {
    setEditingEvent(null);
    setEditorOpen(true);
  };

  const isOrgSpecific = (event: EventType) => event.orgId !== null && event.orgId !== undefined;

  const renderEventRow = (event: EventType) => (
    <article
      key={event.eventType}
      data-record-id={event.eventType}
      className="event-catalog-row"
    >
      <div className="event-catalog-row-main">
        <div className="event-catalog-row-heading">
          <div className="event-catalog-row-title">
            <Button
              type="link"
              className="event-catalog-view-button"
              onClick={() => handleEventClick(event)}
              aria-label={`View details for ${getEventDisplayLabel(event)}`}
            >
              {getEventDisplayLabel(event)}
            </Button>
            <MetaTag size="small" variant={isOrgSpecific(event) ? 'event' : 'neutral'}>
              {isOrgSpecific(event) ? 'Custom' : 'Global template'}
            </MetaTag>
          </div>
          <Text color="secondary" className="event-catalog-description">
            {getEventDescription(event) || 'No description available'}
          </Text>
          <Space size={6} wrap>
            <MetaTag size="small" variant="neutral">{event.eventType}</MetaTag>
            <MetaTag size="small" variant="category">{event.fields?.length || 0} fields</MetaTag>
            {event.samplePayload && <MetaTag size="small" variant="neutral">Sample available</MetaTag>}
          </Space>
        </div>
        <div className="event-catalog-row-actions">
          {/* Edit/Delete — only for org-specific events */}
          <PermissionGuard feature={FEATURES.EVENT_CATALOGUE} operation="write">
            {isOrgSpecific(event) && (
              <>
                <Tooltip title="Edit">
                  <Button
                    icon={<GatewayIcon name="EditOutlined" />}
                    size="small"
                    onClick={(e) => handleEdit(event, e)}
                  />
                </Tooltip>
                <Popconfirm
                  title={`Delete "${getEventDisplayLabel(event)}"?`}
                  description="This will permanently remove this event type from your catalogue."
                  onConfirm={(e) => { e?.stopPropagation(); handleDelete(event); }}
                  onCancel={(e) => e?.stopPropagation()}
                  okText="Delete"
                  okButtonProps={{ danger: true }}
                >
                  <Tooltip title="Delete">
                    <Button
                      icon={<GatewayIcon name="DeleteOutlined" />}
                      size="small"
                      danger
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Tooltip>
                </Popconfirm>
              </>
            )}
          </PermissionGuard>

          {!isMobile && (
            <Button
              type="primary"
              size="small"
              icon={<GatewayIcon name="ThunderboltOutlined" />}
              onClick={(e) => {
                e.stopPropagation();
                handleCreateIntegration(event.eventType);
              }}
            >
              Create Integration
            </Button>
          )}
        </div>
      </div>
    </article>
  );

  return (
    <PageTemplate
      className="event-catalog-workspace"
      header={
        <PageHeader
          title="Event catalog"
          description="Browse shared event templates and organization-specific event types."
          actions={
            <PermissionGuard feature={FEATURES.EVENT_CATALOGUE} operation="write">
              <Space wrap size={8}>
                <Button icon={<GatewayIcon name="DownloadOutlined" />} loading={importing} onClick={handleImportTemplates}>
                  Import templates
                </Button>
                <Button type="primary" icon={<GatewayIcon name="PlusOutlined" />} onClick={handleAddNew}>
                  Add event type
                </Button>
              </Space>
            </PermissionGuard>
          }
        />
      }
    >

      <FilterBar rightSlot={
        <Button onClick={() => refetch()} aria-label="Refresh event catalog">Refresh</Button>
      }>
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          isNarrow={isMobile}
          label="Search event catalog"
          placeholder="Search name, event type, description, or category"
          width={360}
        />
      </FilterBar>

      <section className="event-catalog-summary" aria-label="Event catalog summary">
        <div><span>Total event types</span><strong>{eventTypes.length.toLocaleString()}</strong></div>
        <div><span>Categories shown</span><strong>{Object.keys(eventsByCategory).length.toLocaleString()}</strong></div>
        <div><span>Organization-specific</span><strong>{eventTypes.filter(isOrgSpecific).length.toLocaleString()}</strong></div>
        {searchQuery && <div><span>Matching events</span><strong>{totalEvents.toLocaleString()}</strong></div>}
      </section>

      {isLoading ? (
        <StatePanel glyph="connecting" title="Loading event catalog" size="compact" />
      ) : error ? (
        <StatePanel
          glyph="disrupted"
          tone="critical"
          title="Event catalog could not be loaded"
          description={error instanceof Error ? error.message : 'The request failed. Try again.'}
          actions={<Button onClick={() => refetch()}>Retry</Button>}
        />
      ) : totalEvents === 0 ? (
        <StatePanel
          glyph="searching"
          title={searchQuery ? 'No event types match this search' : 'No event types available'}
          description={searchQuery ? 'Try another term or clear the search.' : 'Add a custom event type or import the shared templates.'}
          actions={searchQuery ? <Button onClick={() => setSearchQuery('')}>Clear search</Button> : undefined}
        />
      ) : (
        <Collapse
          className="event-catalog-categories"
          defaultActiveKey={Object.keys(eventsByCategory)}
          ghost
          expandIconPosition="end"
          items={Object.entries(eventsByCategory).map(([category, events]) => ({
            key: category,
            label: (
              <div className="event-catalog-category-heading">
                <GatewayIcon name="FolderOpenOutlined" aria-hidden="true" />
                <Text weight="semibold">{category}</Text>
                <MetaTag size="small" variant="neutral">{events.length} {events.length === 1 ? 'event' : 'events'}</MetaTag>
              </div>
            ),
            children: <div className="event-catalog-category-list">{events.map(renderEventRow)}</div>,
          }))}
        />
      )}

      {/* Event Detail Drawer */}
      <EventDetailDrawer
        event={selectedEvent}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setSelectedEvent(null);
        }}
        onCreateIntegration={handleCreateIntegration}
      />

      {/* Add / Edit Event Type Modal */}
      <EventTypeEditorModal
        open={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          setEditingEvent(null);
        }}
        existing={editingEvent}
        categories={categories}
      />
    </PageTemplate>
  );
};
