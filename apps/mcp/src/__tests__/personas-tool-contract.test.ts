import { describe, expect, it } from 'vitest';
import { CreatePersonaBodySchema, UpdatePersonaBodySchema } from '../contracts/personas.js';
import { CreatePersonaSchema, UpdatePersonaSchema } from '../tools.js';

const validCreateTool = {
  name: 'Ava',
  accounts: { youtube: ['acct-1'] },
};

const validCreateContract = { name: 'Ava' };

describe('personas · create: tool vs contract', () => {
  it('both sides accept a name and reject a blank one', () => {
    expect(CreatePersonaSchema.safeParse(validCreateTool).success).toBe(true);
    expect(CreatePersonaBodySchema.safeParse(validCreateContract).success).toBe(true);
    expect(CreatePersonaSchema.safeParse({ ...validCreateTool, name: '' }).success).toBe(false);
    expect(CreatePersonaBodySchema.safeParse({ ...validCreateContract, name: '  ' }).success).toBe(false);
  });

  it('the tool strips generation-era fields instead of forwarding them', () => {
    const parsed = CreatePersonaSchema.safeParse({ ...validCreateTool, voiceId: 'v', niche: 'x', videoAspect: '9:16' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(Object.keys(parsed.data).sort()).toEqual(['accounts', 'name']);
    }
  });

  it('the tool takes a local avatarPath that the contract carries as a multipart photo (deliberate)', () => {
    expect(CreatePersonaSchema.safeParse({ ...validCreateTool, avatarPath: '/tmp/a.jpg' }).success).toBe(true);
    expect(CreatePersonaSchema.safeParse({ ...validCreateTool, avatarPath: '' }).success).toBe(false);
  });
});

describe('personas · update: tool vs contract', () => {
  it('the contract rejects an empty update while the tool accepts a personaId-only call (deliberate)', () => {
    expect(UpdatePersonaSchema.safeParse({ personaId: 'p1' }).success).toBe(true);
    expect(UpdatePersonaBodySchema.safeParse({}).success).toBe(false);
  });

  it('both sides accept a rename and reject a blank name', () => {
    expect(UpdatePersonaSchema.safeParse({ personaId: 'p1', name: 'Eve' }).success).toBe(true);
    expect(UpdatePersonaBodySchema.safeParse({ name: 'Eve' }).success).toBe(true);
    expect(UpdatePersonaSchema.safeParse({ personaId: 'p1', name: '' }).success).toBe(false);
  });
});
