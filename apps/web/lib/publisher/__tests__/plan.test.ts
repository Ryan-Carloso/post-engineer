import { describe, expect, it } from 'vitest';
import { SOCIAL_PROVIDERS, PUBLISH_ACCOUNT_FIELDS, SCHEDULE_ACCOUNT_COLUMNS } from '@/lib/contracts/providers';
import {
  AccountNotBoundError,
  PublishPlanError,
  buildProviderPlan,
  validatePublishPlan,
} from '@/lib/publisher/plan';
import { emptyAccountIds, makeSchedule } from './helpers';

function scheduleFor(provider: string, extra: Partial<ReturnType<typeof makeSchedule>> = {}) {
  return makeSchedule({
    providers: [provider],
    accountIds: { ...emptyAccountIds(), [provider]: ['acc-1', 'acc-2'] },
    pinterestBoardId: 'board-1',
    ...extra,
  });
}

function field(plan: ReturnType<typeof buildProviderPlan>, name: string): string | undefined {
  return plan.fields.find(([key]) => key === name)?.[1];
}

describe('buildProviderPlan', () => {
  it('youtube uses the slot title, the agent description, tags from the title and public privacy', () => {
    const plan = buildProviderPlan('youtube', 'Porto in one minute', scheduleFor('youtube'), ' A guide ');
    expect(field(plan, 'title')).toBe('Porto in one minute');
    expect(field(plan, 'description')).toBe('A guide');
    expect(field(plan, 'tags')).toBe('porto,one,minute');
    expect(field(plan, 'privacyStatus')).toBe('public');
    expect(field(plan, 'aiLabel')).toBe('false');
    expect(plan.fields.filter(([key]) => key === 'accountIds')).toEqual([
      ['accountIds', 'acc-1'],
      ['accountIds', 'acc-2'],
    ]);
  });

  it('truncates the youtube title to 100 characters', () => {
    const plan = buildProviderPlan('youtube', 'x'.repeat(150), scheduleFor('youtube'), 'copy');
    expect(field(plan, 'title')).toHaveLength(100);
  });

  it('carries the persona AI label on the networks that take one', () => {
    const schedule = scheduleFor('instagram', { aiLabel: true });
    expect(field(buildProviderPlan('instagram', 't', schedule, 'copy'), 'aiLabel')).toBe('true');
  });

  it('instagram truncates the caption to 2200 characters', () => {
    const plan = buildProviderPlan('instagram', 't', scheduleFor('instagram'), 'y'.repeat(3000));
    expect(field(plan, 'caption')).toHaveLength(2200);
  });

  it.each([
    ['linkedin', 3000],
    ['threads', 500],
    ['facebook', 63206],
    ['telegram', 1024],
  ] as const)('%s truncates the caption to %i characters', (provider, limit) => {
    const plan = buildProviderPlan(provider, 't', scheduleFor(provider), 'z'.repeat(limit + 50));
    expect(field(plan, 'caption')).toHaveLength(limit);
  });

  it('bluesky truncates to 300 graphemes with an ellipsis', () => {
    const plan = buildProviderPlan('bluesky', 't', scheduleFor('bluesky'), 'b'.repeat(400));
    const caption = field(plan, 'caption') ?? '';
    expect(Array.from(caption)).toHaveLength(300);
    expect(caption.endsWith('…')).toBe(true);
  });

  it('pinterest sends the board, the title and description limits', () => {
    const plan = buildProviderPlan('pinterest', 'p'.repeat(150), scheduleFor('pinterest'), 'd'.repeat(900));
    expect(field(plan, 'boardId')).toBe('board-1');
    expect(field(plan, 'title')).toHaveLength(100);
    expect(field(plan, 'description')).toHaveLength(800);
  });

  it('rumble and fanvue use the agent description and cap the title', () => {
    expect(field(buildProviderPlan('rumble', 'r'.repeat(150), scheduleFor('rumble'), 'copy'), 'title')).toHaveLength(100);
    const fanvue = buildProviderPlan('fanvue', 'f', scheduleFor('fanvue'), 'q'.repeat(900));
    expect(field(fanvue, 'description')).toHaveLength(800);
  });

  it('3speak sends the caption without a cap', () => {
    const plan = buildProviderPlan('3speak', 't', scheduleFor('3speak'), 'c'.repeat(5000));
    expect(field(plan, 'caption')).toHaveLength(5000);
  });

  it('puts the account ids under the handler field of every provider', () => {
    for (const provider of SOCIAL_PROVIDERS) {
      const plan = buildProviderPlan(provider, 'Some title here', scheduleFor(provider), 'copy');
      expect(plan.fields.filter(([key]) => key === PUBLISH_ACCOUNT_FIELDS[provider]).map(([, id]) => id)).toEqual([
        'acc-1',
        'acc-2',
      ]);
      expect(SCHEDULE_ACCOUNT_COLUMNS[provider]).toBeTypeOf('string');
    }
  });

  it('uses only the accounts it is told to publish to', () => {
    const plan = buildProviderPlan('youtube', 'Porto', scheduleFor('youtube'), 'copy', ['acc-2']);
    expect(plan.accountIds).toEqual(['acc-2']);
  });

  it('falls back to the schedule accounts when the placeholder account is the only one', () => {
    const plan = buildProviderPlan('youtube', 'Porto', scheduleFor('youtube'), 'copy', ['']);
    expect(plan.accountIds).toEqual(['acc-1', 'acc-2']);
  });

  it('fails loudly on a blank description', () => {
    expect(() => buildProviderPlan('youtube', 'Porto', scheduleFor('youtube'), '   ')).toThrow(
      'slot has no video description: the agent must send one',
    );
  });

  it('rejects an unsupported provider', () => {
    expect(() => buildProviderPlan('myspace', 'Porto', scheduleFor('youtube'), 'copy')).toThrow(
      'unsupported schedule provider: myspace',
    );
  });

  it('rejects a provider with no accounts', () => {
    const schedule = makeSchedule({ providers: ['bluesky'], accountIds: emptyAccountIds() });
    expect(() => buildProviderPlan('bluesky', 'Porto', schedule, 'copy')).toThrow(
      'bluesky publish requires at least one account id',
    );
  });

  it('rejects youtube without a title or without tags', () => {
    expect(() => buildProviderPlan('youtube', '   ', scheduleFor('youtube'), 'copy')).toThrow(
      'youtube publish requires a non-empty title',
    );
    expect(() => buildProviderPlan('youtube', '!!!', scheduleFor('youtube'), 'copy')).toThrow(
      'youtube publish requires at least one tag',
    );
  });

  it('rejects pinterest without a board, rumble and fanvue without a title', () => {
    expect(() => buildProviderPlan('pinterest', 'Porto', scheduleFor('pinterest', { pinterestBoardId: null }), 'copy')).toThrow(
      'pinterest publish requires a board id',
    );
    expect(() => buildProviderPlan('rumble', ' ', scheduleFor('rumble'), 'copy')).toThrow(
      'rumble publish requires a non-empty title',
    );
    expect(() => buildProviderPlan('fanvue', ' ', scheduleFor('fanvue'), 'copy')).toThrow(
      'fanvue publish requires a non-empty title',
    );
  });
});

describe('validatePublishPlan', () => {
  const schedule = scheduleFor('youtube');

  it('accepts accounts bound to the persona', () => {
    expect(() => validatePublishPlan(schedule, 'Porto', 'copy', { youtube: ['acc-1', 'acc-2'] })).not.toThrow();
  });

  it('rejects an account the persona is not bound to, with the dedicated error', () => {
    const run = () => validatePublishPlan(schedule, 'Porto', 'copy', { youtube: ['acc-1'] });
    expect(run).toThrow(AccountNotBoundError);
    expect(run).toThrow('account acc-2 is not bound to persona persona-1: bind it to the persona or remove it from the schedule');
  });

  it('rejects every account when the persona has no bound accounts', () => {
    expect(() => validatePublishPlan(schedule, 'Porto', 'copy', {})).toThrow(AccountNotBoundError);
  });

  it('skips the binding check when no binding is given', () => {
    expect(() => validatePublishPlan(schedule, 'Porto', 'copy', null)).not.toThrow();
  });

  it('rejects a schedule without providers and an unsupported provider', () => {
    expect(() => validatePublishPlan(makeSchedule({ providers: [] }), 'Porto', 'copy', null)).toThrow(
      'at least one publish provider is required',
    );
    expect(() => validatePublishPlan(makeSchedule({ providers: ['myspace'] }), 'Porto', 'copy', null)).toThrow(
      'unsupported publish provider: myspace',
    );
  });

  it('rejects a blank description before anything else', () => {
    expect(() => validatePublishPlan(schedule, 'Porto', '  ', null)).toThrow(PublishPlanError);
  });
});
