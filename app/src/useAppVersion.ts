import { useEffect, useState } from 'react';
declare const __BUILD_ID__: string;

/** True when a newer build is live than the one running in this tab. Checked on focus and every 5 minutes. */
export function useAppVersion() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (typeof __BUILD_ID__ === 'undefined' || __BUILD_ID__ === 'dev') return;
    const check = () => fetch('version.json', { cache: 'no-store' }).then(r => r.json()).then(v => { if (v.build && v.build !== __BUILD_ID__) setStale(true); }).catch(() => {});
    check(); const t = setInterval(check, 300_000); addEventListener('focus', check);
    return () => { clearInterval(t); removeEventListener('focus', check); };
  }, []);
  return stale;
}
