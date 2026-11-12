import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

//---------------
// Tests for PostFailureNotice (post detail, directly under the player).
// i18n echoes keys so the assertions pin structure, not copy.
//---------------

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({ locale: 'en', t: (key: string) => key }),
}));

import { PostFailureNotice } from '../post-failure-notice';

describe('PostFailureNotice', () => {
  it('renders the translated headline, the collapsed raw error and the schedule-again link', () => {
    render(<PostFailureNotice status="failed" error="LongCat job failed: torchrun exited 1" />);

    const block = document.querySelector('[data-post-failure]');
    expect(block).not.toBeNull();
    expect(screen.getByText('posts.cardFailedPermanent')).toBeInTheDocument();
    expect(screen.getByText('posts.cardDetails')).toBeInTheDocument();
    // The engine text is kept for support, but only inside the disclosure.
    const details = block?.querySelector('details');
    expect(details).not.toBeNull();
    expect(details).toHaveTextContent('LongCat job failed: torchrun exited 1');
    const link = screen.getByRole('link', { name: /posts\.cardScheduleAgain/ });
    expect(link).toHaveAttribute('href', '/recipes');
  });

  it('renders nothing about a failure while the post has not failed', () => {
    render(<PostFailureNotice status="awaiting" error="stale engine text" />);
    expect(document.querySelector('[data-post-failure]')).toBeNull();
    expect(screen.queryByText('stale engine text')).toBeNull();
  });

  it('keeps the failed state without an error message free of empty disclosure', () => {
    render(<PostFailureNotice status="failed" error={null} />);
    expect(document.querySelector('[data-post-failure]')).toBeNull();
  });

  it('renders the provider notice below the failure block', () => {
    render(
      <PostFailureNotice
        status="failed"
        error="Upload failed"
        userNotices={[
          { provider: 'youtube', accountId: 'a1', code: 'token_expired', notice: 'raw', requiresUser: true },
        ]}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('posts.userNoticeReconnect');
  });
});
