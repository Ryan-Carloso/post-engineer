import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { getErrorMessage } from './errors.js';
import type { McpToolResponse } from './tools-call.js';

//---------------
// Reference resolution (issue #566 §7): a persona or an account is given as
// an id or as a display name, and the tool resolves it inside the call, so
// the agent does not chain list calls just to copy ids around.
//
// - An id wins: a UUID is a persona id (an unknown one is a 404 from the
//   API later), and an account id is the provider-specific id the listing
//   returns (channelId, igUserId, did, providerAccountId).
// - Otherwise the name must match exactly, case-insensitive and trimmed.
//   Never a prefix or a fragment: a wrong guess would publish to the wrong
//   persona.
// - Zero matches is an actionable error. Several matches is NOT an error
//   and NOT a guess: a candidates result with actionTaken false, so the
//   agent can present them or narrow the reference.
// - Reads are scoped to the caller's own data (the same listings the tools
//   call) and fail closed: a malformed listing is an error, never "no match".
//---------------

export type RefOutcome<T> = { kind: 'ok'; value: T } | { kind: 'response'; response: McpToolResponse };

export interface ResolvedPersona {
  id: string;
  /** The display name when it was resolved by name; null when the id was taken as given. */
  name: string | null;
}

export interface ResolvedAccount {
  provider: string;
  id: string;
  label: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string): RefOutcome<never> {
  return { kind: 'response', response: { content: [{ type: 'text', text: message }], isError: true } };
}

function candidates(kind: string, ref: string, entries: Array<{ id: string; name: string; summary: string }>): RefOutcome<never> {
  const body = {
    ambiguous: true,
    actionTaken: false,
    message: `More than one ${kind} matches "${ref}". Nothing was done. Call again with the id of the one you mean.`,
    candidates: entries.map((entry) => ({ id: entry.id, name: entry.name, summary: entry.summary })),
  };
  return { kind: 'response', response: { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }] } };
}

function normalize(value: string): string {
  return value.trim().replace(/^@/, '').toLowerCase();
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

type Listing = () => Promise<unknown>;

async function resolvePersona(listPersonas: Listing, ref: string): Promise<RefOutcome<ResolvedPersona>> {
  const wanted = ref.trim();
  if (wanted === '') return fail('persona is empty. Pass a persona name or id; call personas (action: list) to see them.');
  if (UUID.test(wanted)) return { kind: 'ok', value: { id: wanted, name: null } };
  let listing: unknown;
  try {
    listing = await listPersonas();
  } catch (error) {
    return fail(`Error resolving persona "${wanted}": ${getErrorMessage(error)}`);
  }
  const personas = record(listing)?.personas;
  if (!Array.isArray(personas)) {
    return fail(`Error resolving persona "${wanted}": the personas listing was malformed. Call personas (action: list) and pass the persona id.`);
  }
  const matches = personas.flatMap((entry) => {
    const item = record(entry);
    const id = text(item?.id);
    const name = text(item?.name);
    if (item === null || id === null || name === null || normalize(name) !== normalize(wanted)) return [];
    const niche = text(item.niche);
    return [{ id, name, summary: niche === null ? name : `${name} (${niche})` }];
  });
  if (matches.length === 0) return fail(`No persona named "${wanted}". Call personas (action: list) to see the names and ids.`);
  if (matches.length > 1) return candidates('persona', wanted, matches);
  return { kind: 'ok', value: { id: matches[0].id, name: matches[0].name } };
}

// The id and the names of one listed account, by provider (the fields of the
// web registry's toPublicAccount: apps/web/lib/providers/registry.ts).
function accountOf(entry: unknown): { provider: string; id: string; names: string[]; label: string } | null {
  const item = record(entry);
  const provider = text(item?.provider);
  if (item === null || provider === null) return null;
  const id = text(provider === 'youtube' ? item.channelId : provider === 'instagram' ? item.igUserId : provider === 'bluesky' ? item.did : item.providerAccountId);
  if (id === null) return null;
  const names = [item.channelName, item.username, item.name, item.handle, item.displayName, item.accountName].flatMap((name) => {
    const value = text(name);
    return value === null ? [] : [value];
  });
  return { provider, id, names, label: names[0] ?? id };
}

async function resolveAccount(listAccounts: Listing, ref: string, provider?: string): Promise<RefOutcome<ResolvedAccount>> {
  const wanted = ref.trim();
  if (wanted === '') return fail('An account reference is empty. Pass an account name or id; call accounts (action: list) to see them.');
  let listing: unknown;
  try {
    listing = await listAccounts();
  } catch (error) {
    return fail(`Error resolving account "${wanted}": ${getErrorMessage(error)}`);
  }
  const accounts = record(listing)?.accounts;
  if (!Array.isArray(accounts)) {
    return fail(`Error resolving account "${wanted}": the accounts listing was malformed. Call accounts (action: list) and pass the account id.`);
  }
  const all = accounts.flatMap((entry) => {
    const account = accountOf(entry);
    return account === null || (provider !== undefined && account.provider !== provider) ? [] : [account];
  });
  const byId = all.filter((account) => account.id === wanted);
  const matches = byId.length > 0 ? byId : all.filter((account) => account.names.some((name) => normalize(name) === normalize(wanted)));
  if (matches.length === 0) return fail(`No account matches "${wanted}"${provider === undefined ? '' : ` on ${provider}`}. Call accounts (action: list) to see the names and ids.`);
  if (matches.length > 1) {
    return candidates('account', wanted, matches.map((account) => ({ id: account.id, name: account.label, summary: `${account.label} on ${account.provider}` })));
  }
  return { kind: 'ok', value: { provider: matches[0].provider, id: matches[0].id, label: matches[0].label } };
}

/** Reads a listing once, whatever the number of references resolved against it. */
function once(read: Listing): Listing {
  let pending: Promise<unknown> | null = null;
  return () => {
    pending ??= read();
    return pending;
  };
}

export interface RefResolvers {
  persona: (ref: string) => Promise<RefOutcome<ResolvedPersona>>;
  account: (ref: string, provider?: string) => Promise<RefOutcome<ResolvedAccount>>;
}

/** Resolvers that share one personas listing and one accounts listing (a batch resolves many refs). */
export function createRefResolvers(client: PostEngineerClient): RefResolvers {
  const personas = once(() => client.listPersonas());
  const accounts = once(() => client.listSocialAccounts());
  return {
    persona: (ref) => resolvePersona(personas, ref),
    account: (ref, provider) => resolveAccount(accounts, ref, provider),
  };
}

export function resolvePersonaRef(client: PostEngineerClient, ref: string): Promise<RefOutcome<ResolvedPersona>> {
  return createRefResolvers(client).persona(ref);
}

export function resolveAccountRef(client: PostEngineerClient, ref: string, provider?: string): Promise<RefOutcome<ResolvedAccount>> {
  return createRefResolvers(client).account(ref, provider);
}

/** The `persona` field of every action that acts on one persona. */
export const PERSONA_REF = z.string().min(1, 'persona is required').describe('The persona, by name or id (personas list shows both).');

/** A shape with its `personaId` replaced by the `persona` reference (the other fields are kept as they are). */
export function personaRefShape<TShape extends Record<string, z.ZodType>>(shape: TShape): { persona: typeof PERSONA_REF } & Omit<TShape, 'personaId'> {
  const { personaId: _replaced, ...rest } = shape;
  return { persona: PERSONA_REF, ...rest };
}

/**
 * Resolves `args.persona` and runs `run` with the persona id as `personaId`
 * (and the other fields untouched). An unknown or ambiguous persona ends the
 * call with the resolver's response, before `run`.
 */
export async function withPersona<TArgs extends { persona: string }, TResult extends McpToolResponse>(
  client: PostEngineerClient,
  args: TArgs,
  run: (args: Omit<TArgs, 'persona'> & { personaId: string }, persona: ResolvedPersona) => Promise<TResult>,
): Promise<McpToolResponse> {
  const outcome = await resolvePersonaRef(client, args.persona);
  if (outcome.kind === 'response') return outcome.response;
  const { persona: _ref, ...rest } = args;
  return run({ ...rest, personaId: outcome.value.id }, outcome.value);
}

/** Like personaRefShape, for an action where the persona is optional. */
export function optionalPersonaRefShape<TShape extends Record<string, z.ZodType>>(shape: TShape): { persona: z.ZodOptional<typeof PERSONA_REF> } & Omit<TShape, 'personaId'> {
  const { personaId: _replaced, ...rest } = shape;
  return { persona: PERSONA_REF.optional(), ...rest };
}

/** Like withPersona, when the persona is optional: absent stays absent (no personaId). */
export async function withOptionalPersona<TArgs extends { persona?: string | undefined }>(
  client: PostEngineerClient,
  args: TArgs,
  run: (args: Omit<TArgs, 'persona'> & { personaId?: string }) => Promise<McpToolResponse>,
): Promise<McpToolResponse> {
  const { persona, ...rest } = args;
  if (persona === undefined) return run(rest);
  const outcome = await resolvePersonaRef(client, persona);
  if (outcome.kind === 'response') return outcome.response;
  return run({ ...rest, personaId: outcome.value.id });
}
