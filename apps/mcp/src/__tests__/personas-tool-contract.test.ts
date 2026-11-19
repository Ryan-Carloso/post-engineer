import { describe, expect, it } from 'vitest';
import {
  AddPersonaImageBodySchema,
  CreatePersonaBodySchema,
  UpdatePersonaBodySchema,
  UpdatePersonaImageBodySchema,
} from '../contracts/personas.js';
import {
  AddPersonaImageSchema,
  CreatePersonaSchema,
  UpdatePersonaImageSchema,
  UpdatePersonaSchema,
} from '../tools.js';

const validCreateTool = {
  name: 'Ava',
  avatarUrl: 'https://example.com/avatar.png',
  voiceId: 'voice-alloy',
  accounts: { youtube: ['acct-1'] },
};

const validCreateContract = { name: 'Ava' };

describe('personas · create: tool vs contract', () => {
  it.each(['9:16', '16:9', '1:1'] as const)('accepts videoAspect %s on both sides', (videoAspect) => {
    expect(CreatePersonaSchema.safeParse({ ...validCreateTool, videoAspect }).success).toBe(true);
    expect(CreatePersonaBodySchema.safeParse({ ...validCreateContract, videoAspect }).success).toBe(true);
  });

  it('rejects an unknown videoAspect on both sides', () => {
    expect(CreatePersonaSchema.safeParse({ ...validCreateTool, videoAspect: '4:3' }).success).toBe(false);
    expect(CreatePersonaBodySchema.safeParse({ ...validCreateContract, videoAspect: '4:3' }).success).toBe(false);
  });

  it.each(['standard', 'react'] as const)('accepts videoLayout %s on both sides', (videoLayout) => {
    expect(CreatePersonaSchema.safeParse({ ...validCreateTool, videoLayout }).success).toBe(true);
    expect(CreatePersonaBodySchema.safeParse({ ...validCreateContract, videoLayout }).success).toBe(true);
  });

  it('rejects an unknown videoLayout on both sides', () => {
    expect(CreatePersonaSchema.safeParse({ ...validCreateTool, videoLayout: 'grid' }).success).toBe(false);
    expect(CreatePersonaBodySchema.safeParse({ ...validCreateContract, videoLayout: 'grid' }).success).toBe(false);
  });

  it.each(['ok', 'very_good'] as const)('accepts faceQuality %s on both sides', (faceQuality) => {
    expect(CreatePersonaSchema.safeParse({ ...validCreateTool, faceQuality }).success).toBe(true);
    expect(CreatePersonaBodySchema.safeParse({ ...validCreateContract, faceQuality }).success).toBe(true);
  });

  it('rejects an unknown faceQuality on both sides', () => {
    expect(CreatePersonaSchema.safeParse({ ...validCreateTool, faceQuality: 'bad' }).success).toBe(false);
    expect(CreatePersonaBodySchema.safeParse({ ...validCreateContract, faceQuality: 'bad' }).success).toBe(false);
  });

  it('accepts paragraphNumber 1 and 10 as a tool number and a contract digit string', () => {
    for (const n of [1, 10]) {
      expect(CreatePersonaSchema.safeParse({ ...validCreateTool, paragraphNumber: n }).success).toBe(true);
      expect(CreatePersonaBodySchema.safeParse({ ...validCreateContract, paragraphNumber: String(n) }).success).toBe(true);
    }
  });

  it('rejects paragraphNumber 0 and 11 on both sides', () => {
    for (const n of [0, 11]) {
      expect(CreatePersonaSchema.safeParse({ ...validCreateTool, paragraphNumber: n }).success).toBe(false);
      expect(CreatePersonaBodySchema.safeParse({ ...validCreateContract, paragraphNumber: String(n) }).success).toBe(false);
    }
  });

  it('paragraphNumber is a number in the tool and a digit string in the contract (deliberate)', () => {
    expect(CreatePersonaSchema.safeParse({ ...validCreateTool, paragraphNumber: '3' }).success).toBe(false);
    expect(CreatePersonaBodySchema.safeParse({ ...validCreateContract, paragraphNumber: 3 }).success).toBe(true);
  });

  it('imagePrimaryIndex is a number in the tool and a digit string in the contract (deliberate)', () => {
    expect(CreatePersonaSchema.safeParse({ ...validCreateTool, imagePrimaryIndex: 0 }).success).toBe(true);
    expect(CreatePersonaBodySchema.safeParse({ ...validCreateContract, imagePrimaryIndex: '0' }).success).toBe(true);
    expect(CreatePersonaSchema.safeParse({ ...validCreateTool, imagePrimaryIndex: '0' }).success).toBe(false);
  });

  it('the tool caps imagePrimaryIndex at 9 while the contract only requires digits (deliberate)', () => {
    expect(CreatePersonaSchema.safeParse({ ...validCreateTool, imagePrimaryIndex: 10 }).success).toBe(false);
    expect(CreatePersonaBodySchema.safeParse({ ...validCreateContract, imagePrimaryIndex: '10' }).success).toBe(true);
  });

  it('the tool rejects a non-English language while the contract accepts any short string (deliberate)', () => {
    expect(CreatePersonaSchema.safeParse({ ...validCreateTool, language: 'pt-BR' }).success).toBe(false);
    expect(CreatePersonaBodySchema.safeParse({ ...validCreateContract, language: 'pt-BR' }).success).toBe(true);
    expect(CreatePersonaBodySchema.safeParse({ ...validCreateContract, language: 'x'.repeat(36) }).success).toBe(false);
  });

  it('the tool has no niche cap while the contract caps it at 300 (deliberate)', () => {
    expect(CreatePersonaSchema.safeParse({ ...validCreateTool, niche: 'x'.repeat(301) }).success).toBe(true);
    expect(CreatePersonaBodySchema.safeParse({ ...validCreateContract, niche: 'x'.repeat(301) }).success).toBe(false);
    expect(CreatePersonaBodySchema.safeParse({ ...validCreateContract, niche: 'x'.repeat(300) }).success).toBe(true);
  });

  it('the tool and the contract both accept the CTA intent, and both drop the legacy stored text', () => {
    const cta = { type: 'link', url: 'https://example.com/course' };
    expect(CreatePersonaSchema.safeParse({ ...validCreateTool, cta }).success).toBe(true);
    expect(CreatePersonaBodySchema.safeParse({ ...validCreateContract, ctaType: 'link', ctaUrl: 'https://example.com/course' }).success).toBe(true);
    const parsed = CreatePersonaSchema.safeParse({ ...validCreateTool, ctaText: 'Buy now' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect('ctaText' in parsed.data).toBe(false);
    expect(CreatePersonaBodySchema.safeParse({ ...validCreateContract, ctaText: 'Buy now' }).success).toBe(true);
  });

  it('the tool rejects an incoherent CTA; the contract carries no cross-field rule', () => {
    expect(CreatePersonaSchema.safeParse({ ...validCreateTool, cta: { type: 'link' } }).success).toBe(false);
    expect(CreatePersonaSchema.safeParse({ ...validCreateTool, cta: { type: 'other' } }).success).toBe(false);
    expect(CreatePersonaSchema.safeParse({ ...validCreateTool, cta: { type: 'follow', url: 'https://example.com/x' } }).success).toBe(false);
    expect(CreatePersonaBodySchema.safeParse({ ...validCreateContract, ctaType: 'link' }).success).toBe(true);
    expect(CreatePersonaBodySchema.safeParse({ ...validCreateContract, ctaType: 'other' }).success).toBe(true);
  });
});

describe('personas · update: tool vs contract', () => {
  it('accepts a niche up to 300 chars and rejects 301 on both sides', () => {
    expect(UpdatePersonaSchema.safeParse({ personaId: 'p1', niche: 'x'.repeat(300) }).success).toBe(true);
    expect(UpdatePersonaSchema.safeParse({ personaId: 'p1', niche: 'x'.repeat(301) }).success).toBe(false);
    expect(UpdatePersonaBodySchema.safeParse({ niche: 'x'.repeat(300) }).success).toBe(true);
    expect(UpdatePersonaBodySchema.safeParse({ niche: 'x'.repeat(301) }).success).toBe(false);
  });

  it('the tool and the contract both accept the CTA intent; the legacy key is stripped by the tool and rejected by the contract', () => {
    expect(UpdatePersonaSchema.safeParse({ personaId: 'p1', cta: { type: 'comment' } }).success).toBe(true);
    expect(UpdatePersonaBodySchema.safeParse({ ctaType: 'comment' }).success).toBe(true);
    const parsed = UpdatePersonaSchema.safeParse({ personaId: 'p1', ctaText: 'Buy now' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect('ctaText' in parsed.data).toBe(false);
    expect(UpdatePersonaBodySchema.safeParse({ ctaText: 'Buy now' }).success).toBe(false);
  });

  it('the contract rejects an empty update while the tool accepts a personaId-only call (deliberate)', () => {
    expect(UpdatePersonaSchema.safeParse({ personaId: 'p1' }).success).toBe(true);
    expect(UpdatePersonaBodySchema.safeParse({}).success).toBe(false);
  });

  it('rejects an unknown videoAspect on both sides', () => {
    expect(UpdatePersonaSchema.safeParse({ personaId: 'p1', videoAspect: '4:3' }).success).toBe(false);
    expect(UpdatePersonaBodySchema.safeParse({ videoAspect: '4:3' }).success).toBe(false);
  });
});

describe('personas · images: tool vs contract', () => {
  it('accepts a tag up to 100 chars and rejects 101 on both sides (add)', () => {
    expect(AddPersonaImageSchema.safeParse({ personaId: 'p1', path: '/tmp/a.jpg', tag: 'x'.repeat(100) }).success).toBe(true);
    expect(AddPersonaImageSchema.safeParse({ personaId: 'p1', path: '/tmp/a.jpg', tag: 'x'.repeat(101) }).success).toBe(false);
    expect(AddPersonaImageBodySchema.safeParse({ personaId: 'p1', tag: 'x'.repeat(100) }).success).toBe(true);
    expect(AddPersonaImageBodySchema.safeParse({ personaId: 'p1', tag: 'x'.repeat(101) }).success).toBe(false);
  });

  it('the add tool takes a boolean isPrimary while the contract takes the form strings (deliberate)', () => {
    expect(AddPersonaImageSchema.safeParse({ personaId: 'p1', path: '/tmp/a.jpg', isPrimary: true }).success).toBe(true);
    expect(AddPersonaImageSchema.safeParse({ personaId: 'p1', path: '/tmp/a.jpg', isPrimary: false }).success).toBe(false);
    expect(AddPersonaImageBodySchema.safeParse({ personaId: 'p1', isPrimary: 'true' }).success).toBe(true);
    expect(AddPersonaImageBodySchema.safeParse({ personaId: 'p1', isPrimary: 'false' }).success).toBe(true);
  });

  it('update-image accepts only isPrimary true on both sides', () => {
    expect(UpdatePersonaImageSchema.safeParse({ id: 'img-1', isPrimary: true }).success).toBe(true);
    expect(UpdatePersonaImageSchema.safeParse({ id: 'img-1', isPrimary: false }).success).toBe(false);
    expect(UpdatePersonaImageBodySchema.safeParse({ id: 'img-1', isPrimary: true }).success).toBe(true);
  });

  it('update-image reports an empty update with a different message on each side (deliberate)', () => {
    const tool = UpdatePersonaImageSchema.safeParse({ id: 'img-1' });
    expect(tool.success).toBe(false);
    if (!tool.success) {
      expect(tool.error.issues[0]?.message).toBe('At least one of tag, description, or isPrimary is required.');
    }
    const contract = UpdatePersonaImageBodySchema.safeParse({ id: 'img-1' });
    expect(contract.success).toBe(false);
    if (!contract.success) {
      expect(contract.error.issues[0]?.message).toBe('Nothing to update.');
    }
  });
});
