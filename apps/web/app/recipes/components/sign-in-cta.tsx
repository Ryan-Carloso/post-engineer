import Link from 'next/link';
import { KeyIcon } from '@/lib/ui';

//---------------
// SignInCta — step 1 of the prompts hub for a signed-out visitor: the
// key manager needs an account, so this links to the login page and
// brings the visitor back to the hub afterwards. Presentational.
//---------------

export const SIGN_IN_HREF = '/login?next=/recipes';

export default function SignInCta({
  label,
  hint,
}: {
  label: string;
  hint: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-[#dfe5ec] bg-white p-4 sm:flex-row sm:items-center sm:justify-between lg:p-6">
      <div className="flex min-w-0 items-center gap-3.5">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-[#edf0f4] bg-white shadow-[0_4px_12px_rgba(16,23,40,0.06)]">
          <KeyIcon />
        </span>
        <p className="text-sm leading-6 text-[#414d63]">{hint}</p>
      </div>
      <Link
        href={SIGN_IN_HREF}
        data-testid="recipes-sign-in-cta"
        className="shrink-0 self-start rounded-xl bg-[#101728] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1e293b] sm:self-auto"
      >
        {label}
      </Link>
    </div>
  );
}
