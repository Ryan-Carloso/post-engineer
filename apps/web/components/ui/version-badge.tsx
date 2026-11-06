'use client';

import { useEffect, useState } from 'react';
import { formatBuildInfo, parseBuildInfo } from '@/lib/version';
import { fetchVersionBadgeBody, VERSION_BADGE_FALLBACK_LABEL } from '@/lib/version-badge-fetch';

//---------------
// VersionBadge — "BETA - 1.28.152 (#152)" pill next to the brand. Reads
// /api/version (which proxies the engine) so the UI shows the SAME version
// and PR the backend runs; several copies mount per page (sidebar,
// mobile header, /account) and share one request through
// fetchVersionBadgeBody. Degrades to a bare "BETA" pill while loading or
// when the backend is unreachable — the badge must never break the page it
// sits on.
//---------------
export default function VersionBadge() {
  const [label, setLabel] = useState(VERSION_BADGE_FALLBACK_LABEL);

  useEffect(() => {
    let cancelled = false;
    fetchVersionBadgeBody()
      .then((body) => {
        if (cancelled) return;
        const info = parseBuildInfo(body);
        setLabel(info ? `BETA - ${formatBuildInfo(info)}` : VERSION_BADGE_FALLBACK_LABEL);
      })
      .catch(() => {
        if (!cancelled) setLabel(VERSION_BADGE_FALLBACK_LABEL);
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
