import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useThemeMode } from '../../app/theme-provider';
import { Icon } from '../../components/common/Icon';
import { PageTemplate } from '../../components/common/PageTemplate';
import './landing.css';

// Import markdown files as raw strings via Vite
import outboundDelivery from './docs/outbound-delivery.md?raw';
import outboundLifecycle from './docs/outbound-lifecycle.md?raw';
import inboundProxy from './docs/inbound-proxy.md?raw';
import scheduledAutomation from './docs/scheduled-automation.md?raw';
import dataTransformation from './docs/data-transformation.md?raw';
import emailNotifications from './docs/email-notifications.md?raw';
import failureAlerts from './docs/failure-alerts.md?raw';
import rbac from './docs/rbac.md?raw';
import analyticsReports from './docs/analytics-reports.md?raw';
import deadLetterQueue from './docs/dead-letter-queue.md?raw';
import lookupTables from './docs/lookup-tables.md?raw';
import webhookSecurity from './docs/webhook-security.md?raw';
import versioning from './docs/versioning.md?raw';
import eventSources from './docs/event-sources.md?raw';
import bulkOperations from './docs/bulk-operations.md?raw';
import alertCenter from './docs/alert-center.md?raw';
import scheduledJobs from './docs/scheduled-jobs.md?raw';
import apiKeys from './docs/api-keys.md?raw';
import mcpServer from './docs/mcp-server.md?raw';

const docs = [
  { slug: 'outbound-delivery', title: 'Outbound Event Delivery', content: outboundDelivery },
  { slug: 'outbound-lifecycle', title: 'Outbound Lifecycle & Gated Delivery', content: outboundLifecycle },
  { slug: 'inbound-proxy', title: 'Inbound API Proxy', content: inboundProxy },
  { slug: 'scheduled-jobs', title: 'Scheduled Jobs & Script Jobs', content: scheduledJobs },
  { slug: 'scheduled-automation', title: 'Delayed Deliveries', content: scheduledAutomation },
  { slug: 'data-transformation', title: 'Data Transformation', content: dataTransformation },
  { slug: 'dead-letter-queue', title: 'Dead Letter Queue', content: deadLetterQueue },
  { slug: 'webhook-security', title: 'Webhook Security', content: webhookSecurity },
  { slug: 'lookup-tables', title: 'Lookup Tables', content: lookupTables },
  { slug: 'versioning', title: 'Versioning & Templates', content: versioning },
  { slug: 'event-sources', title: 'Event Sources', content: eventSources },
  { slug: 'bulk-operations', title: 'Bulk Operations', content: bulkOperations },
  { slug: 'alert-center', title: 'Alert Center', content: alertCenter },
  { slug: 'email-notifications', title: 'Email Notifications', content: emailNotifications },
  { slug: 'failure-alerts', title: 'Failure Alerts', content: failureAlerts },
  { slug: 'rbac', title: 'Role-Based Access Control', content: rbac },
  { slug: 'api-keys', title: 'API Keys & Programmatic Access', content: apiKeys },
  { slug: 'mcp-server', title: 'MCP Server (AI Operations)', content: mcpServer },
  { slug: 'analytics-reports', title: 'Analytics & Reports', content: analyticsReports },
];

function SidebarNav({
  currentSlug,
  navigate,
  handleNavClick,
}: {
  currentSlug: string;
  navigate: (path: string) => void;
  handleNavClick: () => void;
  onSelect?: () => void;
}) {
  return (
    <>
      <p className="px-5 pb-2 text-xs font-heading font-semibold landing-text-secondary">Features</p>
      <nav>
        {docs.map((doc) => {
          const isActive = doc.slug === currentSlug;
          return (
            <button
              key={doc.slug}
              onClick={() => {
                navigate(`/docs/${doc.slug}`);
                handleNavClick();
              }}
              className="w-full text-left px-5 py-2 text-sm transition-colors"
              style={{
                color: isActive ? 'var(--accent-color)' : 'var(--text-secondary)',
                backgroundColor: isActive ? 'rgba(79, 110, 247, 0.08)' : 'transparent',
                borderLeft: isActive ? '2px solid var(--accent-color)' : '2px solid transparent',
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.color = 'var(--text-primary)';
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              {doc.title}
            </button>
          );
        })}
      </nav>
    </>
  );
}

function DocsPageContent() {
  const { slug } = useParams<{ slug?: string }>();
  const navigate = useNavigate();
  const { mode, toggleMode } = useThemeMode();
  const theme = mode;
  const toggleTheme = toggleMode;
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const currentDoc = docs.find((d) => d.slug === slug) ?? docs[0];

  // Scroll to top on doc change
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [currentDoc.slug]);

  // Close mobile sidebar when a link is clicked
  const handleNavClick = () => {
    setSidebarOpen(false);
  };

  const idx = docs.findIndex((d) => d.slug === currentDoc.slug);
  const prev = docs[idx - 1];
  const next = docs[idx + 1];

  // Sidebar content shared between desktop + mobile
  const sidebarContent = (
    <SidebarNav currentSlug={currentDoc.slug} navigate={navigate} handleNavClick={handleNavClick} />
  );

  return (
    // landing-page gives us CSS vars + fonts. We override overflow-x so
    // position:fixed sidebar is never clipped by the ancestor.
    <PageTemplate as="div" className="landing-page docs-page" contentClassName="docs-page__content">
      {/* ── Fixed header ─────────────────────────────────────────────────── */}
      <header
        className="ui-extracted-5cbfabc471"
      >
        <div className="ui-extracted-ad0bfe38ad">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm transition-colors console-link-muted"
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
          >
            <Icon name="ArrowLeftOutlined" size="sm" />
            <span className="hidden sm:inline">Home</span>
          </Link>
          <span className="ui-extracted-233a2de124">|</span>
          <span className="font-heading font-bold text-sm landing-text-primary">Documentation</span>
        </div>

        <div className="ui-extracted-9c8768d7ac">
          <button
            onClick={toggleTheme}
            className="theme-toggle"
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {theme === 'light' ? <Icon name="MoonOutlined" size="md" /> : <Icon name="SunOutlined" size="md" />}
          </button>
          <button
            className="lg:hidden theme-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle navigation"
          >
            {sidebarOpen ? <Icon name="CloseOutlined" size="md" /> : <Icon name="MenuOutlined" size="md" />}
          </button>
        </div>
      </header>

      {/* ── Desktop sidebar — truly fixed, always visible ─────────────────── */}
      <aside
        className="hidden lg:block overflow-y-auto ui-extracted-af4ccd2d81"

      >
        {sidebarContent}
      </aside>

      {/* ── Mobile: backdrop ──────────────────────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden ui-extracted-638bbb2c13"

          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Mobile: sliding sidebar ───────────────────────────────────────── */}
      <aside
        className={[`lg:hidden overflow-y-auto transition-transform duration-200
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`, "ui-extracted-6e2b144012"].filter(Boolean).join(" ")}

      >
        {sidebarContent}
      </aside>

      {/* ── Main content — offset right so it's never under the sidebar ───── */}
      <main className="docs-main py-10">
        <div className="docs-main-content">
          <div className="docs-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentDoc.content}</ReactMarkdown>
          </div>

          {/* Prev / Next */}
          <div
            className="flex items-center justify-between mt-16 pt-6 ui-extracted-82f87d9558"

          >
            {prev ? (
              <button
                onClick={() => navigate(`/docs/${prev.slug}`)}
                className="flex items-center gap-2 text-sm transition-colors landing-text-secondary"
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
              >
                <Icon name="ArrowLeftOutlined" size="sm" />
                {prev.title}
              </button>
            ) : (
              <span />
            )}
            {next ? (
              <button
                onClick={() => navigate(`/docs/${next.slug}`)}
                className="flex items-center gap-2 text-sm transition-colors landing-text-secondary"
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
              >
                {next.title}
                <Icon name="ArrowLeftOutlined" size="sm" rotate={180} />
              </button>
            ) : (
              <span />
            )}
          </div>
        </div>
      </main>
    </PageTemplate>
  );
}

export function DocsPage() {
  return <DocsPageContent />;
}
