'use client';

import { useEffect, useState } from 'react';
import { formatBuildInfo, parseBuildInfo } from '@/lib/version';
import { fetchVersionBadgeBody, VERSION_BADGE_FALLBACK_LABEL } from '@/lib/version-badge-fetch';

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
      className="ml-1 inline-block rounded-full bg-brand/10 px-2 py-0.5 align-middle text-[11px] font-bold tracking-normal text-brand"
    >
      {label}
    </span>
  );
}
