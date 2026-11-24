import { describe, expect, it } from 'vitest';
import { userPromptsStrings } from '@/lib/i18n/user-prompts-i18n';
import { dictionaries } from '@/lib/i18n';

describe('userPrompts strings', () => {
  it('have the same keys in English and Portuguese', () => {
    expect(Object.keys(userPromptsStrings.pt.userPrompts).sort()).toEqual(Object.keys(userPromptsStrings.en.userPrompts).sort());
  });

  it('leave no string empty and keep the same placeholders in both languages', () => {
    const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const [key, english] of Object.entries(userPromptsStrings.en.userPrompts)) {
      const portuguese = userPromptsStrings.pt.userPrompts[key as keyof typeof userPromptsStrings.pt.userPrompts];
      expect(english.length, `en ${key}`).toBeGreaterThan(0);
      expect(portuguese.length, `pt ${key}`).toBeGreaterThan(0);
      expect(placeholders(portuguese), `placeholders of ${key}`).toEqual(placeholders(english));
    }
  });

  it('are registered in both dictionaries', () => {
    expect(dictionaries.en.userPrompts.stepTitle).toBe('Your prompts');
    expect(dictionaries.pt.userPrompts.stepTitle).toBe('Seus prompts');
  });

  it('carries the version history and restore strings in both languages', () => {
    const keys = [
      'historyTitle', 'historyEmpty', 'historyCurrent', 'historyTitleThen', 'historyViewFull', 'historyHideFull', 'historyShowOlder',
      'restoreButton', 'restoreDialogTitle', 'restoreDialogBody', 'restoreConfirm', 'restoreCancel', 'restoreUnchanged', 'restoreDone',
      'errorVersionConflict', 'errorVersionNotFound',
    ] as const;
    for (const key of keys) {
      expect(userPromptsStrings.en.userPrompts[key].length, `en ${key}`).toBeGreaterThan(0);
      expect(userPromptsStrings.pt.userPrompts[key].length, `pt ${key}`).toBeGreaterThan(0);
    }
    expect(userPromptsStrings.en.userPrompts.restoreDialogBody).toContain('{next}');
    expect(userPromptsStrings.pt.userPrompts.restoreDialogBody).toContain('{next}');
    expect(userPromptsStrings.en.userPrompts.restoreDone).toContain('{version}');
    expect(userPromptsStrings.pt.userPrompts.restoreDone).toContain('{version}');
  });
});
