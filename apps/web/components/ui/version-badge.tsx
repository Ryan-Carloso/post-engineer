'use client';

import { useEffect, useState } from 'react';
import { formatBuildInfo, parseBuildInfo } from '@/lib/version';

//---------------
// VersionBadge — "BETA - 1.28.152 (#152)" pill next to the brand. Fetches
// /api/version (which proxies the engine) so the UI shows the SAME version
// and PR the backend runs. Degrades to a bare "BETA" pill while loading or
// when the backend is unreachable — the badge must never break the page it
// sits on.
//---------------
export default function VersionBadge() {
  const [label, setLabel] = useState('BETA');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/version', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        if (cancelled) return;
        const info = parseBuildInfo(body);
        setLabel(info ? `BETA - ${formatBuildInfo(info)}` : 'BETA');
      })
      .catch(() => {
        if (!cancelled) setLabel('BETA');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <span
      data-testid="version-badge"
      className="ml-1 inline-block rounded-full bg-[#ff544c]/10 px-2 py-0.5 align-middle text-[11px] font-bold tracking-normal text-[#ff544c]"
    >
      {label}
    </span>
  );
}
