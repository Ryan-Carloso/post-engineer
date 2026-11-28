'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { usePersonaListQuery, useSocialAccountsQuery } from '@/lib/api';
import { accountOption, type AccountOption } from '@/lib/account-options';
import { type SocialProvider } from '@/lib/contracts/providers';
import { useI18n } from '@/lib/i18n/provider';
import { formatFileSize } from '@/lib/ui';
import { AccountField, type AccountsEmptyReason } from './account-field';
import { MediaField, type MediaSelection } from './media-field';
import { PersonaField } from './persona-field';
import { PostFields } from './post-fields';
import { ResultPanel } from './result-panel';
import { WhenField } from './when-field';
import { usePinterestBoardsQuery } from './boards';
import {
  preselectedAccounts,
  pruneAccounts,
  pruneDisconnectedAccounts,
} from './composer-accounts';
import {
  SCHEDULE_MAX_AHEAD_DAYS,
  SCHEDULE_MIN_ADVANCE_HOURS,
} from '@/lib/schedule-window';
import {
  buildSubmission,
  browserTimezone,
  createDraft,
  defaultPublishAt,
  mediaKindOf,
  mediaMaxBytes,
  providersForMedia,
  publishAtBounds,
  resolveMediaContentType,
  selectedProviders,
  TIMEZONES,
  type ComposerDraft,
  type ComposerField,
  type ComposerIssue,
} from '@/lib/post-composer/compose';
import {
  ComposerRequestError,
  publishExisting,
  uploadMediaFile,
  type PublishResult,
  type UploadedMedia,
} from '@/lib/post-composer/request';
import {
  emptyPersonaDefaultAccounts,
  totalBoundAccounts,
  type PersonaDefaultAccounts,
} from '@/lib/persona-publishing-accounts';

type SubmitStatus =
  | { kind: 'idle' }
  | { kind: 'uploading'; percent: number }
  | { kind: 'publishing' }
  | { kind: 'done'; result: PublishResult };

const SCHEDULE_FIELDS = ['publishing.schedule.publishAt', 'publishing.schedule.timezone'];

function serverIssues(error: ComposerRequestError): ComposerIssue[] {
  const scheduleField =
    error.code === 'SCHEDULE_OUT_OF_RANGE' ||
    (error.field !== null && SCHEDULE_FIELDS.includes(error.field));
  if (!scheduleField) return [];
  return [
    {
      field: 'schedule',
      key: error.field === 'publishing.schedule.timezone' ? 'composer.validationTimezone' : 'composer.validationSchedule',
      vars: { min: SCHEDULE_MIN_ADVANCE_HOURS, max: SCHEDULE_MAX_AHEAD_DAYS },
    },
  ];
}

export function PostComposer() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ComposerDraft>(() => createDraft('UTC'));
  const [media, setMedia] = useState<MediaSelection | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [issues, setIssues] = useState<ComposerIssue[]>([]);
  const [failure, setFailure] = useState<'upload' | 'publish' | null>(null);
  const [status, setStatus] = useState<SubmitStatus>({ kind: 'idle' });
  const [mounted, setMounted] = useState(false);
  const timezoneTouched = useRef(false);
  const publishAtTouched = useRef(false);
  const uploadRef = useRef<UploadedMedia | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  const personasQuery = usePersonaListQuery();
  const personas = useMemo(() => personasQuery.data ?? [], [personasQuery.data]);
  const personasReady = personasQuery.data !== undefined;
  const accountsQuery = useSocialAccountsQuery();
  const accounts = useMemo<AccountOption[]>(
    () => (accountsQuery.data?.accounts ?? []).map(accountOption),
    [accountsQuery.data],
  );

  const connectedAccountIds = useMemo(
    () => new Set(accounts.map((account) => `${account.provider}\0${account.id}`)),
    [accounts],
  );

  const selectedPersona = personas.find((persona) => persona.id === draft.personaId);
  const boundAccounts = useMemo<PersonaDefaultAccounts | null>(() => {
    if (draft.personaId === null) return null;
    if (selectedPersona !== undefined) return selectedPersona.boundAccounts ?? emptyPersonaDefaultAccounts();
    return personasReady ? emptyPersonaDefaultAccounts() : null;
  }, [draft.personaId, selectedPersona, personasReady]);

  const visibleAccounts = useMemo(() => {
    if (boundAccounts === null) return accounts;
    return accounts.filter((account) => boundAccounts[account.provider].includes(account.id));
  }, [accounts, boundAccounts]);

  const emptyReason: AccountsEmptyReason =
    accounts.length === 0
      ? 'none'
      : boundAccounts !== null && totalBoundAccounts(boundAccounts) === 0
        ? 'persona'
        : draft.mediaKind === 'image'
          ? 'image'
          : 'disconnected';

  const pinterestAccountId = (draft.accounts.pinterest ?? [])[0] ?? null;
  const boardsQuery = usePinterestBoardsQuery(pinterestAccountId);
  const boards = boardsQuery.data ?? [];

  useEffect(() => {
    const timezone = browserTimezone();
    setMounted(true);
    setDraft((current) => {
      const nextTimezone = timezoneTouched.current ? current.timezone : timezone;
      return {
        ...current,
        timezone: nextTimezone,
        publishAt: publishAtTouched.current
          ? current.publishAt
          : defaultPublishAt(new Date(), nextTimezone),
      };
    });
  }, []);

  useEffect(() => {
    if (media === null) return undefined;
    return () => URL.revokeObjectURL(media.previewUrl);
  }, [media]);

  useEffect(() => {
    if (draft.pinterestBoardId === '' || boardsQuery.data === undefined) return;
    if (boardsQuery.data.some((board) => board.id === draft.pinterestBoardId)) return;
    setDraft((current) => ({ ...current, pinterestBoardId: '' }));
  }, [boardsQuery.data, draft.pinterestBoardId]);

  const busy = status.kind === 'uploading' || status.kind === 'publishing';
  const providers = selectedProviders(draft.accounts);
  const bounds = mounted
    ? publishAtBounds(new Date(), draft.timezone)
    : { min: '', max: '' };
  const timezones = mounted
    ? TIMEZONES.includes(draft.timezone)
      ? TIMEZONES
      : [draft.timezone, ...TIMEZONES]
    : ['UTC'];

  const clearFeedback = useCallback(() => {
    setIssues([]);
    setFailure(null);
  }, []);

  const changeDraft = useCallback(
    (patch: Partial<ComposerDraft>) => {
      clearFeedback();
      setDraft((current) => ({ ...current, ...patch }));
    },
    [clearFeedback],
  );

  const resetSubmission = useCallback(() => {
    uploadRef.current = null;
    idempotencyKeyRef.current = null;
    setStatus({ kind: 'idle' });
    clearFeedback();
  }, [clearFeedback]);

  const onSelectFile = useCallback(
    (file: File) => {
      const contentType = resolveMediaContentType(file);
      if (contentType === null) {
        setFileError(t('composer.mediaUnsupported'));
        return;
      }
      const limit = mediaMaxBytes(contentType);
      if (file.size > limit) {
        setFileError(t('composer.mediaTooLarge', { limit: formatFileSize(limit) }));
        return;
      }
      const kind = mediaKindOf(contentType);
      setFileError(null);
      setMedia({
        file,
        contentType,
        kind,
        previewUrl: URL.createObjectURL(file),
      });
      resetSubmission();
      setDraft((current) => ({
        ...current,
        mediaKind: kind,
        accounts: pruneAccounts(current.accounts, kind),
      }));
    },
    [resetSubmission, t],
  );

  const onRemoveFile = useCallback(() => {
    setMedia(null);
    setFileError(null);
    resetSubmission();
    setDraft((current) => ({ ...current, mediaKind: null, pinterestBoardId: '' }));
  }, [resetSubmission]);

  const onToggleAccount = useCallback(
    (provider: SocialProvider, id: string) => {
      clearFeedback();
      setDraft((current) => {
        const currentIds = current.accounts[provider] ?? [];
        const nextIds =
          provider === 'pinterest'
            ? currentIds.includes(id)
              ? []
              : [id]
            : currentIds.includes(id)
              ? currentIds.filter((candidate) => candidate !== id)
              : [...currentIds, id];
        return {
          ...current,
          accounts: { ...current.accounts, [provider]: nextIds },
          pinterestBoardId: provider === 'pinterest' && nextIds.length === 0 ? '' : current.pinterestBoardId,
        };
      });
    },
    [clearFeedback],
  );

  const onChangePersona = useCallback(
    (personaId: string | null) => {
      clearFeedback();
      setDraft((current) => {
        const persona = personas.find((candidate) => candidate.id === personaId);
        return {
          ...current,
          personaId,
          pinterestBoardId: '',
          accounts:
            persona === undefined
              ? {}
              : pruneDisconnectedAccounts(
                preselectedAccounts(
                  persona.boundAccounts ?? emptyPersonaDefaultAccounts(),
                  current.mediaKind,
                ),
                connectedAccountIds,
              ),
        };
      });
    },
    [clearFeedback, connectedAccountIds, personas],
  );

  const issueFor = useCallback(
    (field: ComposerField): string | null => {
      const issue = issues.find((candidate) => candidate.field === field);
      return issue === undefined ? null : t(issue.key, issue.vars);
    },
    [issues, t],
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const submitDraft: ComposerDraft = {
      ...draft,
      accounts: pruneDisconnectedAccounts(draft.accounts, connectedAccountIds),
    };
    const submission = buildSubmission(submitDraft, { now: new Date(), boundAccounts });
    if (!submission.ok) {
      setIssues(submission.issues);
      setFailure(null);
      return;
    }
    if (media === null) return;
    clearFeedback();
    const idempotencyKey = idempotencyKeyRef.current ?? crypto.randomUUID();
    idempotencyKeyRef.current = idempotencyKey;
    try {
      let uploaded = uploadRef.current;
      if (uploaded === null) {
        setStatus({ kind: 'uploading', percent: 0 });
        uploaded = await uploadMediaFile(media.file, media.contentType, (percent) =>
          setStatus({ kind: 'uploading', percent }),
        );
        uploadRef.current = uploaded;
      }
      setStatus({ kind: 'publishing' });
      const result = await publishExisting(submission.plan, uploaded, idempotencyKey);
      uploadRef.current = null;
      idempotencyKeyRef.current = null;
      setStatus({ kind: 'done', result });
      await queryClient.invalidateQueries({ queryKey: ['schedule-status'] });
      await queryClient.invalidateQueries({ queryKey: ['schedule-range'] });
      await queryClient.invalidateQueries({ queryKey: ['schedule-has-any-post'] });
      await queryClient.invalidateQueries({ queryKey: ['schedules'] });
    } catch (error) {
      const requestError = error instanceof ComposerRequestError ? error : null;
      const expiredUpload =
        requestError !== null &&
        (requestError.code === 'VIDEO_UPLOAD_EXPIRED' ||
          requestError.code === 'VIDEO_UPLOAD_NOT_FOUND' ||
          requestError.code === 'VIDEO_UPLOAD_CONSUMED');
      if (expiredUpload) uploadRef.current = null;
      setFailure(
        requestError !== null && requestError.stage === 'publish' && !expiredUpload
          ? 'publish'
          : 'upload',
      );
      setIssues(requestError === null ? [] : serverIssues(requestError));
      setStatus({ kind: 'idle' });
    }
  };

  const resetAll = (): void => {
    setMedia(null);
    setFileError(null);
    setIssues([]);
    setFailure(null);
    setStatus({ kind: 'idle' });
    uploadRef.current = null;
    idempotencyKeyRef.current = null;
    timezoneTouched.current = false;
    publishAtTouched.current = false;
    setDraft(() => {
      const timezone = browserTimezone();
      return {
        ...createDraft(timezone),
        publishAt: defaultPublishAt(new Date(), timezone),
      };
    });
  };

  const submitLabel =
    status.kind === 'uploading'
      ? t('composer.uploading', { percent: status.percent })
      : status.kind === 'publishing'
        ? t('composer.publishing')
        : draft.mode === 'asap'
          ? t('composer.submitAsap')
          : t('composer.submitScheduled');

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-1 -ml-2">
          <Link href="/posts">
            <ArrowLeft aria-hidden />
            {t('composer.back')}
          </Link>
        </Button>
        <PageHeader title={t('composer.title')} description={t('composer.subtitle')} />
      </div>

      {status.kind === 'done' ? (
        <ResultPanel result={status.result} timezone={draft.timezone} onAgain={resetAll} />
      ) : (
        <form
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
          className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]"
          data-testid="composer-form"
          noValidate
        >
          <div className="flex min-w-0 flex-col gap-5">
            <MediaField
              media={media}
              issue={issueFor('media')}
              error={fileError}
              disabled={busy}
              onSelect={onSelectFile}
              onRemove={onRemoveFile}
            />
            <AccountField
              accounts={visibleAccounts}
              providers={providersForMedia(draft.mediaKind)}
              selected={draft.accounts}
              loading={accountsQuery.isLoading}
              error={accountsQuery.isError}
              issue={issueFor('accounts') ?? issueFor('persona')}
              disabled={busy}
              onToggle={onToggleAccount}
              emptyReason={emptyReason}
            />
            <PostFields
              draft={draft}
              providers={providers}
              boards={boards}
              boardsLoading={boardsQuery.isLoading}
              boardsError={boardsQuery.isError}
              issueFor={issueFor}
              disabled={busy}
              onChange={changeDraft}
              onBoardChange={(pinterestBoardId) => changeDraft({ pinterestBoardId })}
            />
          </div>

          <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-6">
            <PersonaField
              personas={personas}
              loading={personasQuery.isLoading}
              value={draft.personaId}
              boundCount={boundAccounts === null ? null : totalBoundAccounts(boundAccounts)}
              disabled={busy}
              onChange={onChangePersona}
            />
            <WhenField
              mode={draft.mode}
              publishAt={draft.publishAt}
              timezone={draft.timezone}
              min={bounds.min}
              max={bounds.max}
              issues={issues
                .filter((issue) => issue.field === 'schedule')
                .map((issue) => t(issue.key, issue.vars))}
              timezones={timezones}
              disabled={busy}
              onModeChange={(mode) => changeDraft({ mode })}
              onPublishAtChange={(publishAt) => {
                publishAtTouched.current = true;
                changeDraft({ publishAt });
              }}
              onTimezoneChange={(timezone) => {
                timezoneTouched.current = true;
                if (!publishAtTouched.current) {
                  changeDraft({ timezone, publishAt: defaultPublishAt(new Date(), timezone) });
                  return;
                }
                changeDraft({ timezone });
              }}
            />

            {failure !== null ? (
              <div
                role="alert"
                className="rounded-xl border border-destructive/25 bg-destructive-soft px-3 py-2.5"
                data-testid="composer-error"
              >
                <p className="text-sm font-semibold text-destructive">{t('composer.errorTitle')}</p>
                <p className="mt-1 text-xs text-destructive">
                  {failure === 'upload' ? t('composer.errorUpload') : t('composer.errorPublish')}
                </p>
              </div>
            ) : null}

            <Button
              type="submit"
              size="lg"
              disabled={busy || (draft.personaId !== null && !personasReady)}
              className="w-full"
              data-testid="composer-submit"
            >
              {submitLabel}
            </Button>
          </aside>
        </form>
      )}
    </div>
  );
}
