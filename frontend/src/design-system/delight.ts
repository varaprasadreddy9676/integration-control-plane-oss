/**
 * Moments of delight, kept to the few places where something ends or begins:
 * a record dissolving when it is deleted, a short burst when an integration
 * goes live, a secret decoding into view. Each one respects reduced motion.
 */

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const DISSOLVE_MS = 650;
const PARTICLE_SPACING = 6;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  delay: number;
}

/**
 * Breaks an element into drifting dust (the "Thanos snap"), then resolves.
 * The element itself fades and blurs away while particles in its text color
 * scatter up and to the right, starting from its left edge.
 * Callers remove the element (usually by refetching) once this resolves.
 */
export function dissolve(element: Element | null): Promise<void> {
  if (!element || !(element instanceof HTMLElement)) return Promise.resolve();
  const rect = element.getBoundingClientRect();
  const offscreen = rect.bottom < 0 || rect.top > window.innerHeight;
  // Off-screen rows (a large bulk delete) just fade; only what is seen gets particles.
  if (prefersReducedMotion() || rect.width === 0 || rect.height === 0 || offscreen) {
    element.style.transition = 'opacity 120ms';
    element.style.opacity = '0';
    return new Promise((resolve) => window.setTimeout(resolve, 120));
  }

  const color = getComputedStyle(element).color || 'rgb(120,120,120)';
  const canvas = document.createElement('canvas');
  const ratio = window.devicePixelRatio || 1;
  const pad = 80;
  Object.assign(canvas.style, {
    position: 'fixed',
    left: `${rect.left - pad}px`,
    top: `${rect.top - pad}px`,
    width: `${rect.width + pad * 2}px`,
    height: `${rect.height + pad * 2}px`,
    pointerEvents: 'none',
    zIndex: '2000',
  });
  canvas.width = (rect.width + pad * 2) * ratio;
  canvas.height = (rect.height + pad * 2) * ratio;
  document.body.appendChild(canvas);
  const context = canvas.getContext('2d');
  if (!context) {
    canvas.remove();
    return Promise.resolve();
  }
  context.scale(ratio, ratio);
  context.fillStyle = color;

  const particles: Particle[] = [];
  for (let x = 0; x < rect.width; x += PARTICLE_SPACING) {
    for (let y = 0; y < rect.height; y += PARTICLE_SPACING) {
      if (Math.random() > 0.55) continue;
      particles.push({
        x: pad + x,
        y: pad + y,
        vx: 20 + Math.random() * 60,
        vy: -(10 + Math.random() * 50),
        size: 1 + Math.random() * 1.6,
        // Sweep left to right, like the element is being blown away.
        delay: (x / rect.width) * 0.45 + Math.random() * 0.1,
      });
    }
  }

  element.style.transition = `opacity ${DISSOLVE_MS * 0.7}ms ease-in, filter ${DISSOLVE_MS * 0.7}ms ease-in`;
  element.style.filter = 'blur(2px)';
  element.style.opacity = '0';

  return new Promise((resolve) => {
    const start = performance.now();
    const frame = (now: number) => {
      const progress = Math.min(1, (now - start) / DISSOLVE_MS);
      context.clearRect(0, 0, rect.width + pad * 2, rect.height + pad * 2);
      for (const particle of particles) {
        const local = Math.max(0, (progress - particle.delay) / (1 - particle.delay));
        if (local <= 0 || local >= 1) continue;
        context.globalAlpha = 1 - local;
        context.fillRect(
          particle.x + particle.vx * local,
          particle.y + particle.vy * local,
          particle.size,
          particle.size
        );
      }
      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        canvas.remove();
        resolve();
      }
    };
    requestAnimationFrame(frame);
  });
}

/**
 * A short, small confetti burst for "it's live" moments: switching something
 * on, single or in bulk. Bursts from `element`, or from whatever has focus
 * (the toggle or button just clicked). Never throws.
 */
export function celebrateActivation(element: Element | null = document.activeElement): void {
  celebrateFrom(element).catch(() => undefined);
}

async function celebrateFrom(element: Element | null): Promise<void> {
  if (prefersReducedMotion()) return;
  const { default: confetti } = await import('canvas-confetti');
  const rect = element?.getBoundingClientRect();
  const origin = rect
    ? { x: (rect.left + rect.width / 2) / window.innerWidth, y: (rect.top + rect.height / 2) / window.innerHeight }
    : { x: 0.5, y: 0.4 };
  const styles = getComputedStyle(document.documentElement);
  const brand = ['--color-primary-500', '--color-success-text', '--color-primary-300']
    .map((name) => styles.getPropertyValue(name).trim())
    .filter(Boolean);
  await confetti({
    origin,
    particleCount: 40,
    spread: 60,
    startVelocity: 22,
    gravity: 1.1,
    ticks: 120,
    scalar: 0.7,
    colors: brand.length ? brand : undefined,
    disableForReducedMotion: true,
  });
}

const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Calls onFrame with the text resolving left to right out of random characters,
 * ending on the exact value. Returns a cancel function.
 */
export function scrambleReveal(value: string, onFrame: (text: string) => void, durationMs = 600): () => void {
  if (prefersReducedMotion() || !value) {
    onFrame(value);
    return () => undefined;
  }
  let frame = 0;
  const start = performance.now();
  const tick = (now: number) => {
    const progress = Math.min(1, (now - start) / durationMs);
    const settled = Math.floor(value.length * progress);
    let text = value.slice(0, settled);
    for (let i = settled; i < value.length; i += 1) {
      text += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
    }
    onFrame(text);
    if (progress < 1) frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    onFrame(value);
  };
}
