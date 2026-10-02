import { getDeployedVersion } from '@/lib/version';

//---------------
// VersionBadge — "BETA - <version>" pill next to the brand. The version is
// the deployed platform build (repo-root VERSION baked in at build time;
// 'dev' when unset), so the UI always shows what is actually running.
//---------------
export default function VersionBadge() {
  return (
    <span
      data-testid="version-badge"
      className="ml-1 inline-block rounded-full bg-[#ff544c]/10 px-2 py-0.5 align-middle text-[11px] font-bold tracking-normal text-[#ff544c]"
    >
      BETA - {getDeployedVersion()}
    </span>
  );
}
