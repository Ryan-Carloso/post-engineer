import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ApiKeysSection from '@/components/ui/api-keys-section';

vi.mock('@/lib/api', () => ({
  useApiKeysQuery: vi.fn(),
  useCreateApiKeyMutation: vi.fn(),
  useRevokeApiKeyMutation: vi.fn(),
  useUpdateApiKeyMutation: vi.fn(),
  usePersonasQuery: vi.fn(),
}));

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) =>
      vars === undefined ? key : `${key}${JSON.stringify(vars)}`,
    locale: 'en',
    setLocale: vi.fn(),
  }),
}));

import {
  useApiKeysQuery,
  useCreateApiKeyMutation,
  usePersonasQuery,
  useRevokeApiKeyMutation,
  useUpdateApiKeyMutation,
} from '@/lib/api';

const SECRET = 'pe_live_abcdef1234567890abcdef1234567890';
const PERSONAS = [
  { id: 'persona-a', name: 'Ana' },
  { id: 'persona-b', name: 'Bia' },
];

interface TestKey {
  id: string;
  name: string;
  keyPrefix: string;
  personaIds: string[] | null;
  approvalMode: 'yolo' | 'approval';
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

function makeKey(index: number, overrides: Partial<TestKey> = {}): TestKey {
  return {
    id: `key-${index}`,
    name: `Agent ${index}`,
    keyPrefix: `pe_live_test${index}...`,
    personaIds: null,
    approvalMode: 'yolo',
    createdAt: '2026-09-18T10:00:00.000Z',
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function mockKeys(keys: TestKey[]): void {
  vi.mocked(useApiKeysQuery).mockReturnValue({ data: keys, isLoading: false, isError: false } as never);
}

function mockPersonas(personas: typeof PERSONAS, isError = false): void {
  vi.mocked(usePersonasQuery).mockReturnValue({ data: personas, isError } as never);
}

function mockCreate(overrides: Record<string, unknown> = {}): ReturnType<typeof vi.fn> {
  const mutate = vi.fn((_vars: unknown, options?: { onSuccess?: (result: unknown) => void }) => {
    options?.onSuccess?.({ id: 'key-new', name: 'created', key: SECRET });
  });
  vi.mocked(useCreateApiKeyMutation).mockReturnValue({
    mutate,
    reset: vi.fn(),
    isPending: false,
    isError: false,
    ...overrides,
  } as never);
  return mutate;
}

function mockUpdate(overrides: Record<string, unknown> = {}): ReturnType<typeof vi.fn> {
  const mutate = vi.fn((_vars: unknown, options?: { onSuccess?: () => void }) => {
    options?.onSuccess?.();
  });
  vi.mocked(useUpdateApiKeyMutation).mockReturnValue({
    mutate,
    reset: vi.fn(),
    isPending: false,
    isError: false,
    ...overrides,
  } as never);
  return mutate;
}

function mockRevoke(overrides: Record<string, unknown> = {}): ReturnType<typeof vi.fn> {
  const mutate = vi.fn();
  vi.mocked(useRevokeApiKeyMutation).mockReturnValue({
    mutate,
    isPending: false,
    isError: false,
    ...overrides,
  } as never);
  return mutate;
}

describe('ApiKeysSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKeys([]);
    mockPersonas(PERSONAS);
    mockCreate();
    mockUpdate();
    mockRevoke();
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  describe('create form', () => {
    it('starts open with an optional name and no generate button to click first', () => {
      render(<ApiKeysSection />);
      expect(screen.getByTestId('create-api-key-form')).toBeInTheDocument();
      expect(screen.getByTestId('api-key-name-input')).toHaveValue('');
      expect(screen.getByTestId('api-key-name-input')).toHaveAttribute('placeholder', 'apiKeys.defaultKeyName');
      expect(screen.getByTestId('submit-create-key-btn')).toBeEnabled();
      expect(screen.queryByTestId('generate-api-key-btn')).not.toBeInTheDocument();
    });

    it('creates with the localized default name, approval mode and every persona when nothing is touched', () => {
      const mutate = mockCreate();
      render(<ApiKeysSection />);
      fireEvent.click(screen.getByTestId('submit-create-key-btn'));
      expect(mutate).toHaveBeenCalledWith(
        { name: 'apiKeys.defaultKeyName', approvalMode: 'approval', personaIds: null },
        expect.any(Object),
      );
    });

    it('sends the trimmed name and the chosen yolo mode', () => {
      const mutate = mockCreate();
      render(<ApiKeysSection />);
      expect(screen.getByTestId('api-key-mode-approval')).toBeChecked();
      fireEvent.click(screen.getByTestId('api-key-mode-yolo'));
      fireEvent.change(screen.getByTestId('api-key-name-input'), { target: { value: '  Yolo Agent ' } });
      fireEvent.click(screen.getByTestId('submit-create-key-btn'));
      expect(mutate).toHaveBeenCalledWith(
        { name: 'Yolo Agent', approvalMode: 'yolo', personaIds: null },
        expect.any(Object),
      );
    });

    it('offers all personas by default and lists the user personas once restriction is chosen', () => {
      render(<ApiKeysSection />);
      expect(screen.getByTestId('api-key-create-scope-all')).toBeChecked();
      expect(screen.queryByTestId('api-key-create-persona-list')).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId('api-key-create-scope-selected'));
      const list = screen.getByTestId('api-key-create-persona-list');
      expect(within(list).getByText('Ana')).toBeInTheDocument();
      expect(within(list).getByText('Bia')).toBeInTheDocument();
    });

    it('blocks submit until a persona is chosen, then sends only the chosen ids', () => {
      const mutate = mockCreate();
      render(<ApiKeysSection />);
      fireEvent.click(screen.getByTestId('api-key-create-scope-selected'));
      expect(screen.getByTestId('submit-create-key-btn')).toBeDisabled();
      fireEvent.click(screen.getByTestId('submit-create-key-btn'));
      expect(mutate).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId('api-key-create-persona-persona-b'));
      expect(screen.getByTestId('submit-create-key-btn')).toBeEnabled();
      fireEvent.click(screen.getByTestId('submit-create-key-btn'));
      expect(mutate).toHaveBeenCalledWith(
        { name: 'apiKeys.defaultKeyName', approvalMode: 'approval', personaIds: ['persona-b'] },
        expect.any(Object),
      );
    });

    it('returns to unrestricted when All personas is picked again', () => {
      const mutate = mockCreate();
      render(<ApiKeysSection />);
      fireEvent.click(screen.getByTestId('api-key-create-scope-selected'));
      fireEvent.click(screen.getByTestId('api-key-create-persona-persona-a'));
      fireEvent.click(screen.getByTestId('api-key-create-scope-all'));
      fireEvent.click(screen.getByTestId('submit-create-key-btn'));
      expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ personaIds: null }), expect.any(Object));
    });

    it('shows only the unrestricted option with a hint when the user has no persona', () => {
      mockPersonas([]);
      render(<ApiKeysSection />);
      expect(screen.getByTestId('api-key-create-personas-none')).toHaveTextContent('apiKeys.personasNone');
      expect(screen.queryByTestId('api-key-create-scope-selected')).not.toBeInTheDocument();
      expect(screen.getByTestId('submit-create-key-btn')).toBeEnabled();
    });

    it('falls back to the unrestricted option with its own message when personas fail to load', () => {
      mockPersonas([], true);
      render(<ApiKeysSection />);
      expect(screen.getByTestId('api-key-create-personas-none')).toHaveTextContent('apiKeys.personasLoadError');
    });

    it('disables every control while the key is being created', () => {
      mockCreate({ isPending: true });
      render(<ApiKeysSection />);
      expect(screen.getByTestId('api-key-name-input')).toBeDisabled();
      expect(screen.getByTestId('api-key-mode-yolo')).toBeDisabled();
      expect(screen.getByTestId('api-key-create-scope-all')).toBeDisabled();
      expect(screen.getByTestId('submit-create-key-btn')).toBeDisabled();
    });

    it('shows a localized error when creating fails', () => {
      mockCreate({ isError: true });
      render(<ApiKeysSection />);
      expect(screen.getByTestId('create-api-key-error')).toHaveTextContent('apiKeys.createError');
    });
  });

  describe('after creation', () => {
    it('collapses the form into the created state with the key in its own box and a copy button', async () => {
      const onKeyCreated = vi.fn();
      render(<ApiKeysSection onKeyCreated={onKeyCreated} />);
      expect(onKeyCreated).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId('submit-create-key-btn'));

      expect(onKeyCreated).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('create-api-key-form')).not.toBeInTheDocument();
      const banner = screen.getByTestId('api-key-created-banner');
      expect(within(banner).getByText('apiKeys.keyCreatedTitle')).toBeInTheDocument();
      expect(within(banner).getByText('apiKeys.warningCopyOnce')).toBeInTheDocument();
      expect(screen.getByTestId('raw-api-key-value')).toHaveValue(SECRET);

      fireEvent.click(screen.getByTestId('copy-api-key-btn'));
      expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith(SECRET);
      expect(await screen.findByText('apiKeys.copied')).toBeInTheDocument();
    });

    it('does not hand the secret to the page callback', () => {
      const onKeyCreated = vi.fn();
      render(<ApiKeysSection onKeyCreated={onKeyCreated} />);
      fireEvent.click(screen.getByTestId('submit-create-key-btn'));
      expect(onKeyCreated).toHaveBeenCalledWith();
    });

    it('reopens a fresh form from "create another" and drops the shown secret', () => {
      render(<ApiKeysSection />);
      fireEvent.click(screen.getByTestId('submit-create-key-btn'));
      fireEvent.click(screen.getByTestId('create-another-key-btn'));
      expect(screen.getByTestId('create-api-key-form')).toBeInTheDocument();
      expect(screen.queryByTestId('raw-api-key-value')).not.toBeInTheDocument();
    });
  });

  describe('manage keys', () => {
    it('keeps the existing keys inside a collapsed section with the count', () => {
      mockKeys([makeKey(1), makeKey(2)]);
      render(<ApiKeysSection />);
      const manage = screen.getByTestId('manage-keys');
      expect(manage.tagName).toBe('DETAILS');
      expect(manage).not.toHaveAttribute('open');
      expect(manage).toContainElement(screen.getByTestId('api-keys-table'));
      expect(within(manage).getByText('(2)')).toBeInTheDocument();
    });

    it('renders the empty state, the loading state and the error state inside the section', () => {
      const { unmount } = render(<ApiKeysSection />);
      expect(screen.getByTestId('manage-keys')).toContainElement(screen.getByTestId('api-keys-empty-state'));
      unmount();

      vi.mocked(useApiKeysQuery).mockReturnValue({ data: undefined, isLoading: true, isError: false } as never);
      const loading = render(<ApiKeysSection />);
      expect(screen.queryByTestId('api-keys-empty-state')).not.toBeInTheDocument();
      loading.unmount();

      vi.mocked(useApiKeysQuery).mockReturnValue({ data: undefined, isLoading: false, isError: true } as never);
      render(<ApiKeysSection />);
      expect(screen.getByText('apiKeys.loadError')).toBeInTheDocument();
    });

    it('styles an active key green and a revoked key red, in the table and the mobile cards', () => {
      mockKeys([makeKey(1), makeKey(2, { revokedAt: '2026-09-19T10:00:00.000Z' })]);
      render(<ApiKeysSection />);
      const active = screen.getAllByText('apiKeys.active');
      const revoked = screen.getAllByText('apiKeys.revoked');
      expect(active).toHaveLength(2);
      expect(revoked).toHaveLength(2);
      for (const badge of active) expect(badge.className).toContain('bg-success-soft');
      for (const badge of revoked) expect(badge.className).toContain('bg-destructive-soft');
    });

    it('shows the persona scope of each key: all personas, or the named personas', () => {
      mockKeys([makeKey(1), makeKey(2, { personaIds: ['persona-a', 'persona-b'] })]);
      render(<ApiKeysSection />);
      expect(screen.getByTestId('api-key-scope-key-1')).toHaveTextContent('apiKeys.scopeAll');
      expect(screen.getByTestId('api-key-scope-key-2')).toHaveTextContent('"count":2');
      expect(screen.getByTestId('api-key-scope-key-2')).toHaveTextContent('"names":"Ana, Bia"');
    });

    it('offers no edit or revoke action on a revoked key', () => {
      mockKeys([makeKey(1, { revokedAt: '2026-09-19T10:00:00.000Z' })]);
      render(<ApiKeysSection />);
      expect(screen.queryByTestId('edit-key-btn-key-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('revoke-key-btn-key-1')).not.toBeInTheDocument();
    });

    it('collapses long key lists behind a show-all toggle', () => {
      mockKeys([1, 2, 3, 4, 5, 6].map((i) => makeKey(i)));
      render(<ApiKeysSection />);
      expect(screen.queryByTestId('api-key-row-key-5')).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId('api-keys-show-all-toggle'));
      expect(screen.getByTestId('api-key-row-key-6')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('api-keys-show-all-toggle'));
      expect(screen.queryByTestId('api-key-row-key-5')).not.toBeInTheDocument();
    });

    it('does not render the show-all toggle when every key fits', () => {
      mockKeys([makeKey(1), makeKey(2)]);
      render(<ApiKeysSection />);
      expect(screen.queryByTestId('api-keys-show-all-toggle')).not.toBeInTheDocument();
    });

    it('shows the last-used date for a used key and the never-used label otherwise', () => {
      mockKeys([makeKey(1, { lastUsedAt: '2026-09-20T12:00:00.000Z' }), makeKey(2)]);
      render(<ApiKeysSection />);
      const row1 = screen.getByTestId('api-key-row-key-1');
      const row2 = screen.getByTestId('api-key-row-key-2');
      expect(within(row1).queryByText('apiKeys.neverUsed')).not.toBeInTheDocument();
      expect(within(row2).getByText('apiKeys.neverUsed')).toBeInTheDocument();
    });
  });

  describe('revoke', () => {
    it.each(['revoke-key-btn-key-1', 'revoke-key-btn-mobile-key-1'])('revokes from %s after confirmation', (testId) => {
      mockKeys([makeKey(1)]);
      const revoke = mockRevoke();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      render(<ApiKeysSection />);
      fireEvent.click(screen.getByTestId(testId));
      expect(revoke).toHaveBeenCalledWith('key-1');
    });

    it('does nothing when the confirmation is declined', () => {
      mockKeys([makeKey(1)]);
      const revoke = mockRevoke();
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      render(<ApiKeysSection />);
      fireEvent.click(screen.getByTestId('revoke-key-btn-key-1'));
      expect(revoke).not.toHaveBeenCalled();
    });

    it('shows a localized error when revoking fails', () => {
      mockKeys([makeKey(1)]);
      mockRevoke({ isError: true });
      render(<ApiKeysSection />);
      expect(screen.getByTestId('revoke-api-key-error')).toHaveTextContent('apiKeys.revokeError');
    });

    it('disables the row actions while a revoke is pending', () => {
      mockKeys([makeKey(1)]);
      mockRevoke({ isPending: true });
      render(<ApiKeysSection />);
      expect(screen.getByTestId('revoke-key-btn-key-1')).toBeDisabled();
      expect(screen.getByTestId('edit-key-btn-key-1')).toBeDisabled();
    });
  });

  describe('edit', () => {
    it('opens an edit form prefilled with the mode and persona scope of the key', () => {
      mockKeys([makeKey(1, { approvalMode: 'approval', personaIds: ['persona-a'] })]);
      render(<ApiKeysSection />);
      expect(screen.queryByTestId('edit-api-key-form')).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId('edit-key-btn-key-1'));
      expect(screen.getByTestId('edit-api-key-form')).toBeInTheDocument();
      expect(screen.getByTestId('api-key-edit-mode-approval')).toBeChecked();
      expect(screen.getByTestId('api-key-edit-scope-selected')).toBeChecked();
      expect(screen.getByTestId('api-key-edit-persona-persona-a')).toBeChecked();
      expect(screen.getByTestId('api-key-edit-persona-persona-b')).not.toBeChecked();
    });

    it('saves the changed mode and scope, then closes the form', () => {
      mockKeys([makeKey(1, { approvalMode: 'approval', personaIds: null })]);
      const update = mockUpdate();
      render(<ApiKeysSection />);
      fireEvent.click(screen.getByTestId('edit-key-btn-key-1'));
      fireEvent.click(screen.getByTestId('api-key-edit-mode-yolo'));
      fireEvent.click(screen.getByTestId('api-key-edit-scope-selected'));
      fireEvent.click(screen.getByTestId('api-key-edit-persona-persona-b'));
      fireEvent.click(screen.getByTestId('save-api-key-btn'));
      expect(update).toHaveBeenCalledWith(
        { id: 'key-1', approvalMode: 'yolo', personaIds: ['persona-b'] },
        expect.any(Object),
      );
      expect(screen.queryByTestId('edit-api-key-form')).not.toBeInTheDocument();
    });

    it('can widen a scoped key back to every persona', () => {
      mockKeys([makeKey(1, { personaIds: ['persona-a'] })]);
      const update = mockUpdate();
      render(<ApiKeysSection />);
      fireEvent.click(screen.getByTestId('edit-key-btn-key-1'));
      fireEvent.click(screen.getByTestId('api-key-edit-scope-all'));
      fireEvent.click(screen.getByTestId('save-api-key-btn'));
      expect(update).toHaveBeenCalledWith(
        { id: 'key-1', approvalMode: 'yolo', personaIds: null },
        expect.any(Object),
      );
    });

    it('blocks saving an empty persona selection', () => {
      mockKeys([makeKey(1)]);
      const update = mockUpdate();
      render(<ApiKeysSection />);
      fireEvent.click(screen.getByTestId('edit-key-btn-key-1'));
      fireEvent.click(screen.getByTestId('api-key-edit-scope-selected'));
      expect(screen.getByTestId('save-api-key-btn')).toBeDisabled();
      expect(update).not.toHaveBeenCalled();
    });

    it('keeps the form open and shows a localized error when saving fails', () => {
      mockKeys([makeKey(1)]);
      mockUpdate({ isError: true, mutate: vi.fn() });
      render(<ApiKeysSection />);
      fireEvent.click(screen.getByTestId('edit-key-btn-key-1'));
      fireEvent.click(screen.getByTestId('save-api-key-btn'));
      expect(screen.getByTestId('edit-api-key-form')).toBeInTheDocument();
      expect(screen.getByTestId('edit-api-key-error')).toHaveTextContent('apiKeys.updateError');
    });

    it('disables the edit controls while the save is pending', () => {
      mockKeys([makeKey(1)]);
      const { rerender } = render(<ApiKeysSection />);
      fireEvent.click(screen.getByTestId('edit-key-btn-key-1'));
      mockUpdate({ isPending: true });
      rerender(<ApiKeysSection />);
      expect(screen.getByTestId('save-api-key-btn')).toBeDisabled();
      expect(screen.getByTestId('cancel-edit-api-key-btn')).toBeDisabled();
      expect(screen.getByTestId('api-key-edit-mode-yolo')).toBeDisabled();
    });

    it('closes the form on cancel without saving', () => {
      mockKeys([makeKey(1)]);
      const update = mockUpdate();
      render(<ApiKeysSection />);
      fireEvent.click(screen.getByTestId('edit-key-btn-key-1'));
      fireEvent.click(screen.getByTestId('cancel-edit-api-key-btn'));
      expect(screen.queryByTestId('edit-api-key-form')).not.toBeInTheDocument();
      expect(update).not.toHaveBeenCalled();
    });

    it('closes the form of a key that is revoked while it is being edited', () => {
      mockKeys([makeKey(1)]);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      render(<ApiKeysSection />);
      fireEvent.click(screen.getByTestId('edit-key-btn-key-1'));
      fireEvent.click(screen.getByTestId('revoke-key-btn-key-1'));
      expect(screen.queryByTestId('edit-api-key-form')).not.toBeInTheDocument();
    });

    it('clears an earlier save error when another key is opened', () => {
      mockKeys([makeKey(1), makeKey(2)]);
      const reset = vi.fn();
      mockUpdate({ reset });
      render(<ApiKeysSection />);
      fireEvent.click(screen.getByTestId('edit-key-btn-key-2'));
      expect(reset).toHaveBeenCalledTimes(1);
    });
  });
});
