import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { ThemeProvider } from '../../hooks/useTheme';
import Navigation from './sections/Navigation';
import HeroSection from './sections/HeroSection';
import { LoginModal } from './LoginModal';
import HowItWorksSection from './sections/HowItWorksSection';
import CapabilitiesSection from './sections/CapabilitiesSection';
import ProductSplit from './sections/ProductSplit';
import { DeliveryLogVisual, TenancyVisual } from './sections/ProductVisuals';
import McpSection from './sections/McpSection';
import NumbersSection from './sections/NumbersSection';
import CompareSection from './sections/CompareSection';
import QuickstartSection from './sections/QuickstartSection';
import FaqSection from './sections/FaqSection';
import FooterSection from './sections/FooterSection';
import { LANDING_PUBLIC_MODE } from './landing-config';
import './landing.css';
import './sections/public.css';

gsap.registerPlugin(ScrollTrigger);

function LandingPageContent() {
  const [loginOpen, setLoginOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const lenisRef = useRef<Lenis | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  // Scroll progress bar
  useEffect(() => {
    const update = () => {
      const scrolled = window.scrollY;
      const total = document.documentElement.scrollHeight - window.innerHeight;
      const pct = total > 0 ? (scrolled / total) * 100 : 0;

      if (progressRef.current) {
        progressRef.current.style.width = `${pct}%`;
      }
    };
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  // Lenis smooth scrolling
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: 'vertical',
      gestureOrientation: 'vertical',
      smoothWheel: true,
      wheelMultiplier: 1.0,
      syncTouch: false,
      touchMultiplier: 1.2,
    });

    lenisRef.current = lenis;
    lenis.on('scroll', ScrollTrigger.update);

    const tickerFn = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tickerFn);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(tickerFn);
      lenisRef.current = null;
      lenis.destroy();
    };
  }, []);

  // URL hash handling
  useEffect(() => {
    const handleHash = () => {
      if (window.location.hash && lenisRef.current) {
        const target = document.querySelector(window.location.hash) as HTMLElement;
        if (target) {
          setTimeout(() => {
            lenisRef.current?.scrollTo(target, {
              offset: 0,
              immediate: true,
              onComplete: () => ScrollTrigger.refresh(true),
            });
          }, 100);
        }
      } else {
        setTimeout(() => ScrollTrigger.refresh(true), 100);
      }
    };

    handleHash();
    window.addEventListener('load', () => ScrollTrigger.refresh(true));
    window.addEventListener('hashchange', handleHash);

    return () => {
      window.removeEventListener('load', () => ScrollTrigger.refresh(true));
      window.removeEventListener('hashchange', handleHash);
    };
  }, []);

  // Kill all ScrollTriggers on unmount
  useEffect(() => {
    return () => {
      ScrollTrigger.getAll().forEach((st) => st.kill());
    };
  }, []);

  return (
    <div ref={containerRef} className="landing-page relative">
      {/* Scroll progress bar */}
      <div ref={progressRef} className="scroll-progress" />

      {/* Grain overlay */}
      <div className="grain-overlay" />

      {/* Navigation */}
      <Navigation onLoginClick={() => setLoginOpen(true)} />

      {/* Main content */}
      <main className="relative">
        <HeroSection onLoginClick={() => setLoginOpen(true)} />
        {LANDING_PUBLIC_MODE && (
          <>
            <HowItWorksSection />
            <CapabilitiesSection />
            <ProductSplit
              id="observability"
              title="When something breaks, the answer is one click away."
              lead="Every run keeps its full story: what came in, which rules matched, what was sent, what came back, and how long each step took."
              points={[
                { strong: 'Traces per run.', rest: 'Step by step, with payloads, responses and timings.' },
                {
                  strong: 'Source events attached.',
                  rest: 'See the event that triggered a delivery without leaving it.',
                },
                { strong: 'Replay after a fix.', rest: 'Send failed deliveries again once the destination recovers.' },
              ]}
              visual={<DeliveryLogVisual />}
            />
            <McpSection />
            <NumbersSection />
            <ProductSplit
              id="multi-tenant"
              flipped
              title="Built for platforms with many customers."
              lead="Run one installation for every customer, team or region, each with its own integrations, credentials and people."
              points={[
                { strong: 'Isolated by organization.', rest: 'Data, credentials and configuration never cross over.' },
                { strong: 'Nested organizations.', rest: 'Model parent companies, branches and regions.' },
                { strong: 'Roles that fit.', rest: 'Seven built-in roles, from viewer to super admin.' },
              ]}
              visual={<TenancyVisual />}
            />
            <CompareSection />
            <QuickstartSection />
            <FaqSection />
          </>
        )}
        <FooterSection onLoginClick={() => setLoginOpen(true)} />
      </main>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}

export function LandingPage() {
  return (
    <ThemeProvider>
      <LandingPageContent />
    </ThemeProvider>
  );
}
