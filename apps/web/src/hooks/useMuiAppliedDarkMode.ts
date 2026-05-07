import { useSyncExternalStore } from 'react';

const MUI_COLOR_SCHEME_ATTR = 'data-mui-color-scheme';

function subscribeAppliedScheme(onStoreChange: () => void): () => void {
  if (typeof document === 'undefined') {
    return () => {};
  }
  const el = document.documentElement;
  const mo = new MutationObserver(onStoreChange);
  mo.observe(el, { attributes: true, attributeFilter: [MUI_COLOR_SCHEME_ATTR] });
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', onStoreChange);
  return () => {
    mo.disconnect();
    mq.removeEventListener('change', onStoreChange);
  };
}

function snapshotAppliedScheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') {
    return 'light';
  }
  const attr = document.documentElement.getAttribute(MUI_COLOR_SCHEME_ATTR);
  if (attr === 'dark') return 'dark';
  if (attr === 'light') return 'light';
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/**
 * True when the **rendered** MUI appearance is dark (`data-mui-color-scheme` or system preference).
 * Prefer this over `theme.palette.mode` / `useColorScheme()` when those can lag CSS-driven dark UI.
 */
export function useMuiAppliedDarkMode(): boolean {
  const effective = useSyncExternalStore(
    subscribeAppliedScheme,
    snapshotAppliedScheme,
    () => 'light',
  );
  return effective === 'dark';
}
