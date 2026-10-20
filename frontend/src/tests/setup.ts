import '@testing-library/jest-dom';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// findBy*/waitFor give up after 1s by default, which a busy CI runner can
// exceed while React Query settles; the per-test timeout (20s) still applies.
configure({ asyncUtilTimeout: 5000 });

const createMemoryStorage = (): Storage => {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(String(key)) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(String(key)),
    setItem: (key, value) => values.set(String(key), String(value)),
  };
};

const hasUsableStorage = (storage: Storage | undefined): storage is Storage => {
  try {
    if (!storage) return false;
    const probe = '__integration_gateway_storage_probe__';
    storage.setItem(probe, probe);
    storage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
};

if (!hasUsableStorage(window.localStorage)) {
  const localStorage = createMemoryStorage();
  Object.defineProperty(window, 'localStorage', { configurable: true, value: localStorage });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorage });
}

if (!hasUsableStorage(window.sessionStorage)) {
  const sessionStorage = createMemoryStorage();
  Object.defineProperty(window, 'sessionStorage', { configurable: true, value: sessionStorage });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: sessionStorage });
}

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}
