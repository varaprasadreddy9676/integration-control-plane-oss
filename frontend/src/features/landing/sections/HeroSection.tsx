import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ArrowRight, BookOpen, Github } from 'lucide-react';
import { Link } from 'react-router-dom';
import HeroTrace from './HeroTrace';
import { GITHUB_URL, LANDING_PUBLIC_MODE } from '../landing-config';

interface HeroSectionProps {
  onLoginClick: () => void;
}

export default function HeroSection({ onLoginClick }: HeroSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const subheadRef = useRef<HTMLParagraphElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const pillsRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const microLabelRef = useRef<HTMLDivElement>(null);
  const primaryBtnRef = useRef<HTMLElement>(null);

  // Entrance animation
  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power4.out' } });

      tl.fromTo(microLabelRef.current, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.6 }, 0.1);

      if (headlineRef.current) {
        const words = headlineRef.current.querySelectorAll('.word');
        tl.fromTo(words, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.7, stagger: 0.03 }, 0.2);
      }

      tl.fromTo(subheadRef.current, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.6 }, 0.5);
      tl.fromTo(ctaRef.current, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5 }, 0.62);
      tl.fromTo(pillsRef.current, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5 }, 0.72);
      tl.fromTo(imageRef.current, { opacity: 0, x: 40 }, { opacity: 1, x: 0, duration: 1.0, ease: 'power3.out' }, 0.3);
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  // Magnetic button — pulls toward cursor within 90px radius
  useEffect(() => {
    const btn = primaryBtnRef.current;
    if (!btn) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = btn.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const radius = 90;
      if (dist < radius) {
        const strength = (1 - dist / radius) * 0.38;
        btn.style.transform = `translate(${dx * strength}px, ${dy * strength}px)`;
      } else {
        btn.style.transform = '';
      }
    };

    const handleMouseLeave = () => {
      btn.style.transform = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className="hero-section grid-bg flex items-center z-10"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <div className="w-full px-[6vw] pt-20">
        <div className="flex flex-col lg:flex-row items-start justify-between gap-8">
          {/* Left content */}
          <div className="w-full lg:w-[46vw] flex flex-col">
            <div ref={microLabelRef} className="micro-label mb-4 flex items-center gap-2">
              INTEGRATION GATEWAY v2.1
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  color: 'var(--accent-color)',
                  border: '1px solid var(--accent-color)',
                  borderRadius: 4,
                  padding: '1px 6px',
                  opacity: 0.85,
                }}
              >
                BETA
              </span>
            </div>

            <h1
              ref={headlineRef}
              className="font-heading font-bold text-4xl sm:text-5xl lg:text-6xl xl:text-7xl leading-[0.95] tracking-[-0.02em] mb-6"
              style={{ color: 'var(--text-primary)' }}
            >
              <span className="word inline-block">The</span> <span className="word inline-block">control</span>{' '}
              <span className="word inline-block">plane</span> <span className="word inline-block">for</span>{' '}
              <span className="word inline-block">your</span> <span className="word inline-block">integrations.</span>
            </h1>

            <p
              ref={subheadRef}
              className="text-base lg:text-lg leading-relaxed max-w-[38ch] mb-8"
              style={{ color: 'var(--text-secondary)' }}
            >
              Outbound delivery, inbound API proxy, and scheduled automation—with execution traces, dead-letter queues,
              and an MCP server so AI agents can diagnose, recover, and configure the gateway for you.
            </p>

            <div ref={ctaRef} className="flex items-center gap-4 mb-6">
              {LANDING_PUBLIC_MODE ? (
                <>
                  {/* Public visitors have no account yet: lead with self-hosting. */}
                  <a
                    ref={primaryBtnRef as React.Ref<HTMLAnchorElement>}
                    href="#quickstart"
                    className="btn-primary flex items-center gap-2"
                    style={{
                      textDecoration: 'none',
                      transition: 'background-color 0.2s ease, box-shadow 0.2s ease, transform 0.12s ease',
                    }}
                  >
                    Self-host it
                    <ArrowRight className="w-4 h-4" />
                  </a>
                  <a
                    href={GITHUB_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary flex items-center gap-2"
                    style={{ textDecoration: 'none' }}
                  >
                    <Github className="w-4 h-4" />
                    View on GitHub
                  </a>
                </>
              ) : (
                <>
                  <button
                    ref={primaryBtnRef as React.Ref<HTMLButtonElement>}
                    className="btn-primary flex items-center gap-2"
                    style={{ transition: 'background-color 0.2s ease, box-shadow 0.2s ease, transform 0.12s ease' }}
                    onClick={onLoginClick}
                  >
                    Get started
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  <Link to="/docs" className="btn-secondary flex items-center gap-2" style={{ textDecoration: 'none' }}>
                    <BookOpen className="w-4 h-4" />
                    Read docs
                  </Link>
                </>
              )}
            </div>

            {LANDING_PUBLIC_MODE && (
              <div ref={pillsRef} className="flex flex-wrap gap-3">
                <span className="trust-pill">Public Beta</span>
                <span className="trust-pill">Open source</span>
                <span className="trust-pill">AGPL v3</span>
                <span className="trust-pill-highlight">Self-hosted</span>
                <span className="trust-pill">Multi-tenant</span>
              </div>
            )}
          </div>

          {/* Right — a live delivery trace, the product doing its job */}
          <div ref={imageRef} className="w-full lg:w-[42vw] lg:mt-6">
            <HeroTrace />
          </div>
        </div>
      </div>
    </section>
  );
}
