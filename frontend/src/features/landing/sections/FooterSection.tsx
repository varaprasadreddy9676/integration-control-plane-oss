import { useRef, useLayoutEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Link } from 'react-router-dom';
import { Icon } from '../../../components/common/Icon';
import { LANDING_PUBLIC_MODE, GITHUB_URL } from '../landing-config';

interface FooterSectionProps {
  onLoginClick: () => void;
}

const footerLinks = {
  product: [
    { label: 'How it works', href: '#how-it-works' },
    { label: 'Features', href: '#features' },
    { label: 'MCP server', href: '#mcp' },
    { label: 'Compare', href: '#compare' },
    { label: 'Quickstart', href: '#quickstart' },
    { label: 'Documentation', href: '/docs' },
    // Roadmap: hidden until page exists
    // API Reference: hidden until API docs exist
  ],
  docs: [
    { label: 'Outbound Event Delivery', href: '/docs/outbound-delivery' },
    { label: 'Outbound Lifecycle & Gated Delivery', href: '/docs/outbound-lifecycle' },
    { label: 'Inbound API Proxy', href: '/docs/inbound-proxy' },
    { label: 'Scheduled Jobs & Script Jobs', href: '/docs/scheduled-jobs' },
    { label: 'Delayed Deliveries', href: '/docs/scheduled-automation' },
    { label: 'Data Transformation', href: '/docs/data-transformation' },
    { label: 'MCP Server', href: '/docs/mcp-server' },
    { label: 'API Keys & Programmatic Access', href: '/docs/api-keys' },
    { label: 'Role-Based Access Control', href: '/docs/rbac' },
    { label: 'Analytics & Reports', href: '/docs/analytics-reports' },
  ],
};

export default function FooterSection({ onLoginClick }: FooterSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const linksRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        ctaRef.current,
        { y: 30, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.9,
          ease: 'power4.out',
          scrollTrigger: {
            trigger: ctaRef.current,
            start: 'top 85%',
            toggleActions: 'play none none reverse',
          },
        }
      );

      if (LANDING_PUBLIC_MODE && linksRef.current) {
        const columns = linksRef.current.querySelectorAll('.footer-column');
        gsap.fromTo(
          columns,
          { y: 24, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.7,
            stagger: 0.08,
            ease: 'power4.out',
            scrollTrigger: {
              trigger: linksRef.current,
              start: 'top 88%',
              toggleActions: 'play none none reverse',
            },
          }
        );
      }
    }, section);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="grid-bg relative z-[70] ui-extracted-ef382eefa0" >
      {/* CTA Block */}
      <div ref={ctaRef} className="py-20 px-[6vw] text-center">
        <h2 className="font-heading font-bold text-3xl sm:text-4xl lg:text-5xl mb-4 landing-text-primary">
          {LANDING_PUBLIC_MODE ? 'Your integrations, on your servers.' : 'Get started in minutes.'}
        </h2>
        <p className="text-base lg:text-lg max-w-xl mx-auto mb-8 landing-text-secondary">
          {LANDING_PUBLIC_MODE
            ? 'Free and open source under AGPL v3. Self-host it today, and read every line of what runs your data.'
            : 'Deploy the gateway, create your first route, and start delivering events with full observability.'}
        </p>
        <div className="flex items-center justify-center gap-4">
          {LANDING_PUBLIC_MODE ? (
            <a href="#quickstart" className="btn-primary flex items-center gap-2 ui-extracted-2ae0b7079f" >
              Self-host it
              <Icon name="ArrowRightOutlined" size="sm" />
            </a>
          ) : (
            <button className="btn-primary flex items-center gap-2" onClick={onLoginClick}>
              Get started
              <Icon name="ArrowRightOutlined" size="sm" />
            </button>
          )}
          {LANDING_PUBLIC_MODE && (
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary flex items-center gap-2"
            >
              <Icon name="GithubOutlined" size="sm" />
              View on GitHub
            </a>
          )}
        </div>
      </div>

      {/* Public mode: full footer with link columns */}
      {LANDING_PUBLIC_MODE && (
        <div ref={linksRef} className="border-t py-12 px-[6vw] ui-extracted-fff256becd" >
          <div className="max-w-5xl mx-auto">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-8 mb-12">
              {/* Logo column */}
              <div className="footer-column col-span-2 md:col-span-1">
                <div className="font-heading font-bold text-lg mb-4 landing-text-primary">Integration Gateway</div>
                <p className="text-sm mb-4 landing-text-secondary">The control plane for your integrations.</p>
                <div className="flex items-center gap-3">
                  {[
                    { href: GITHUB_URL, icon: <Icon name="GithubOutlined" size="sm" />, label: 'GitHub' },
                    {
                      href: `${GITHUB_URL}/discussions`,
                      icon: <Icon name="MessageOutlined" size="sm" />,
                      label: 'GitHub Discussions',
                    },
                  ].map(({ href, label, icon }) => (
                    <a
                      key={label}
                      aria-label={label}
                      href={href}
                      className="w-8 h-8 rounded-full flex items-center justify-center transition-colors ui-extracted-3908ef1bc8"

                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = 'var(--text-primary)';
                        e.currentTarget.style.backgroundColor = 'rgba(128,128,128,0.2)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = 'var(--text-secondary)';
                        e.currentTarget.style.backgroundColor = 'rgba(128,128,128,0.1)';
                      }}
                    >
                      {icon}
                    </a>
                  ))}
                </div>
              </div>

              {/* Product column */}
              <div className="footer-column">
                <h4 className="font-heading font-semibold text-sm mb-4 landing-text-primary">Product</h4>
                <ul className="space-y-2">
                  {footerLinks.product.map((link) => (
                    <li key={link.label}>
                      {link.href.startsWith('/') ? (
                        <Link
                          to={link.href}
                          className="text-sm transition-colors console-link-muted"
                          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
                        >
                          {link.label}
                        </Link>
                      ) : (
                        <a
                          href={link.href}
                          className="text-sm transition-colors landing-text-secondary"
                          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
                        >
                          {link.label}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Docs / Features column */}
              <div className="footer-column col-span-2 md:col-span-1">
                <h4 className="font-heading font-semibold text-sm mb-4 landing-text-primary">Docs</h4>
                <ul className="space-y-2">
                  {footerLinks.docs.map((link) => (
                    <li key={link.label}>
                      <Link
                        to={link.href}
                        className="text-sm transition-colors console-link-muted"
                        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div
              className="pt-8 border-t flex flex-col sm:flex-row items-center justify-between gap-4 ui-extracted-fff256becd"

            >
              <p className="text-xs landing-text-secondary">
                © {new Date().getFullYear()} Integration Gateway — AGPL v3, open source.
              </p>
              <div className="flex items-center gap-6">
                {[
                  ['License', `${GITHUB_URL}/blob/main/LICENSE`],
                  ['Security', `${GITHUB_URL}/blob/main/SECURITY.md`],
                  ['Contributing', `${GITHUB_URL}/blob/main/CONTRIBUTING.md`],
                ].map(([label, href]) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs transition-colors landing-text-secondary"
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
                  >
                    {label}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Internal mode: simple bottom bar */}
      {!LANDING_PUBLIC_MODE && (
        <div className="border-t py-6 px-[6vw] ui-extracted-fff256becd" >
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
            <p className="font-heading font-bold text-sm landing-text-primary">Integration Gateway</p>
            <p className="text-xs landing-text-secondary">© {new Date().getFullYear()} — Built for teams who ship.</p>
          </div>
        </div>
      )}
    </section>
  );
}
