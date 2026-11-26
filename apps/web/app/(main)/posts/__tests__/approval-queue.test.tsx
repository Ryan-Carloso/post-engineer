import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ScheduledSlot } from '@/lib/api';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({ locale: 'en', t: (key: string) => key }),
}));

const queueState = vi.hoisted(() => ({
  slots: [] as ScheduledSlot[],
  isLoading: false,
  isError: false,
}));
vi.mock('@/lib/approval-queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/approval-queue')>();
  return {
    ...actual,
    useApprovalQueue: vi.fn(() => ({
      slots: queueState.slots,
      count: queueState.slots.length,
      isLoading: queueState.isLoading,
      isError: queueState.isError,
    })),
  };
});

const detailById = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/lib/api', () => ({
  usePostDetailQuery: vi.fn((id: string) => ({ data: detailById.get(id) ?? null, isLoading: false })),
}));

const approveMutate = vi.hoisted(() => vi.fn());
const rejectMutate = vi.hoisted(() => vi.fn());
const approvalErrors = vi.hoisted(() => ({ approve: false, reject: false }));
vi.mock('@/lib/api-approval', () => ({
  useApproveSlotMutation: () => ({ mutate: approveMutate, isPending: false, isError: approvalErrors.approve }),
  useRejectSlotMutation: () => ({ mutate: rejectMutate, isPending: false, isError: approvalErrors.reject }),
}));

const rescheduleMutate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-slot-reschedule', () => ({
  useRescheduleSlotMutation: () => ({ mutate: rescheduleMutate, isPending: false, isError: false }),
}));

import { ApprovalQueue } from '../approval-queue';
import type { PostJoins } from '../post-joins';

const FRESH_AT = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const EXPIRED_AT = new Date(Date.now() - 10 * 60 * 1000).toISOString();

function slot(partial: Partial<ScheduledSlot> = {}): ScheduledSlot {
  return {
    id: 'slot-1',
    scheduleId: 's1',
    slotAt: FRESH_AT,
    status: 'awaiting_approval',
    title: 'Held video',
    ...partial,
  };
}

function detailFor(slotId: string, media: unknown, description: string | null) {
  return {
    slot: {
      id: slotId,
      scheduleId: 's1',
      slotAt: FRESH_AT,
      status: 'awaiting_approval',
      title: 'Held video',
      description,
      error: null,
      publishedAt: null,
      publishLinks: [],
      media,
    },
    schedule: {
      id: 's1',
      personaId: 'p1',
      providers: ['youtube'],
      youtubeAccountIds: ['ch1'],
      instagramAccountIds: [],
      linkedinAccountIds: [],
      blueskyAccountIds: [],
      threadsAccountIds: [],
      facebookAccountIds: [],
      pinterestAccountIds: [],
      pinterestBoardId: null,
      threespeakAccountIds: [],
      rumbleAccountIds: [],
      fanvueAccountIds: [],
      telegramAccountIds: [],
      timezone: 'UTC',
      publishMode: 'scheduled',
    },
    persona: { id: 'p1', name: 'Viva Leve' },
    prompt: null,
  };
}

const JOINS: PostJoins = {
  scheduleById: new Map([
    [
      's1',
      {
        id: 's1',
        personaId: 'p1',
        providers: ['youtube'],
        youtubeAccountIds: ['ch1'],
        instagramAccountIds: [],
        linkedinAccountIds: [],
        blueskyAccountIds: [],
        threadsAccountIds: [],
        facebookAccountIds: [],
        pinterestAccountIds: [],
        pinterestBoardId: null,
        threespeakAccountIds: [],
        rumbleAccountIds: [],
        fanvueAccountIds: [],
        telegramAccountIds: [],
        daysOfWeek: [1],
        startHour: 9,
        endHour: 17,
        postsPerDay: 1,
        timezone: 'UTC',
        active: true,
        publishMode: 'scheduled',
      },
    ],
    [
      's2',
      {
        id: 's2',
        personaId: null,
        providers: ['youtube'],
        youtubeAccountIds: ['ch1'],
        instagramAccountIds: [],
        linkedinAccountIds: [],
        blueskyAccountIds: [],
        threadsAccountIds: [],
        facebookAccountIds: [],
        pinterestAccountIds: [],
        pinterestBoardId: null,
        threespeakAccountIds: [],
        rumbleAccountIds: [],
        fanvueAccountIds: [],
        telegramAccountIds: [],
        daysOfWeek: [1],
        startHour: 9,
        endHour: 17,
        postsPerDay: 1,
        timezone: 'UTC',
        active: true,
        publishMode: 'asap',
      },
    ],
  ]),
  personaNameById: new Map([['p1', 'Viva Leve']]),
  personaPhotoById: new Map(),
  accountOptions: [{ id: 'ch1', provider: 'youtube', label: 'E2E Channel' }],
  isLoading: false,
  isError: false,
  refetch: () => {},
};

function renderQueue() {
  cleanup();
  return render(<ApprovalQueue joins={JOINS} />);
}

describe('ApprovalQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueState.slots = [];
    queueState.isLoading = false;
    queueState.isError = false;
    approvalErrors.approve = false;
    approvalErrors.reject = false;
    detailById.clear();
  });

  it('renders nothing when no slot awaits approval', () => {
    renderQueue();

    expect(screen.queryByTestId('approval-queue')).not.toBeInTheDocument();
  });

  it('shows the title, description, accounts, slot time and the decision buttons', () => {
    queueState.slots = [slot()];
    detailById.set('slot-1', detailFor('slot-1', { kind: 'upload', url: null, contentType: 'video/mp4' }, 'Edited outside.'));
    renderQueue();

    expect(screen.getByTestId('approval-queue')).toBeInTheDocument();
    expect(screen.getByTestId('approval-queue-count')).toHaveTextContent('1');
    expect(screen.getByText('Held video')).toBeInTheDocument();
    expect(screen.getByText('Edited outside.')).toBeInTheDocument();
    expect(screen.getByText('Viva Leve')).toBeInTheDocument();
    expect(screen.getByTestId('approval-approve')).toBeInTheDocument();
    expect(screen.getByTestId('approval-reject')).toBeInTheDocument();
  });

  it('shows the media kind when no signed preview URL exists yet', () => {
    queueState.slots = [slot()];
    detailById.set('slot-1', detailFor('slot-1', { kind: 'image', url: null, contentType: 'image/jpeg' }, null));
    renderQueue();

    const tile = screen.getByRole('img', { name: 'posts.approvalMediaImage' });
    expect(tile).toHaveAttribute('data-media-kind', 'image');
    expect(screen.getByText('posts.unknownCaption')).toBeInTheDocument();
  });

  it('shows the signed image when the detail carries a preview URL', () => {
    queueState.slots = [slot()];
    detailById.set(
      'slot-1',
      detailFor('slot-1', { kind: 'image', url: 'https://example.com/signed.jpg', contentType: 'image/jpeg' }, null),
    );
    renderQueue();

    const image = screen.getByRole('img', { name: 'Held video' });
    expect(image).toHaveAttribute('src', 'https://example.com/signed.jpg');
  });

  it('calls the approve mutation with the slot id', async () => {
    const user = userEvent.setup();
    queueState.slots = [slot()];
    detailById.set('slot-1', detailFor('slot-1', null, null));
    renderQueue();

    await user.click(screen.getByTestId('approval-approve'));

    expect(approveMutate).toHaveBeenCalledWith('slot-1');
    expect(rejectMutate).not.toHaveBeenCalled();
  });

  it('calls the reject mutation with the slot id', async () => {
    const user = userEvent.setup();
    queueState.slots = [slot()];
    detailById.set('slot-1', detailFor('slot-1', null, null));
    renderQueue();

    await user.click(screen.getByTestId('approval-reject'));

    expect(rejectMutate).toHaveBeenCalledWith('slot-1');
    expect(approveMutate).not.toHaveBeenCalled();
  });

  it('shows the approve error copy when the approve mutation fails', () => {
    approvalErrors.approve = true;
    queueState.slots = [slot()];
    detailById.set('slot-1', detailFor('slot-1', null, null));
    renderQueue();

    expect(screen.getByRole('alert')).toHaveTextContent('posts.approvalApproveError');
  });

  it('marks an expired slot, disables approve and offers reschedule', async () => {
    const user = userEvent.setup();
    queueState.slots = [slot({ id: 'slot-late', slotAt: EXPIRED_AT, title: 'Late video' })];
    detailById.set('slot-late', detailFor('slot-late', { kind: 'upload', url: null, contentType: 'video/mp4' }, null));
    renderQueue();

    expect(screen.getByTestId('approval-expired')).toHaveTextContent('posts.approvalExpired');
    expect(screen.getByTestId('approval-approve')).toBeDisabled();
    expect(screen.getByTestId('approval-reschedule')).toBeInTheDocument();

    await user.click(screen.getByTestId('approval-reschedule'));

    expect(document.querySelector('input[type="datetime-local"]')).toBeInTheDocument();
  });

  it('does not offer reschedule for an expired ASAP holding row', () => {
    queueState.slots = [slot({ id: 'slot-asap', scheduleId: 's2', slotAt: EXPIRED_AT, title: 'ASAP hold' })];
    detailById.set('slot-asap', detailFor('slot-asap', { kind: 'upload', url: null, contentType: 'video/mp4' }, null));
    renderQueue();

    expect(screen.getByTestId('approval-expired')).toBeInTheDocument();
    expect(screen.queryByTestId('approval-reschedule')).not.toBeInTheDocument();
  });
});
