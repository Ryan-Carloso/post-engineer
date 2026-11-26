import { describe, expect, it } from 'vitest';
import { LEGAL_UPDATED_AT } from '@/lib/seo';
import { legalI18nEn } from '@/lib/i18n/legal-i18n-en';

function monthNameToNumber(name: string): string {
  const months: Record<string, string> = {
    January: '01',
    February: '02',
    March: '03',
    April: '04',
    May: '05',
    June: '06',
    July: '07',
    August: '08',
    September: '09',
    October: '10',
    November: '11',
    December: '12',
  };
  const found = months[name];
  if (found === undefined) throw new Error(`unknown month: ${name}`);
  return found;
}

function updatedDate(line: string): string {
  const match = line.match(/([A-Z][a-z]+) (\d{1,2}), (\d{4})/);
  if (match === null) throw new Error(`no date in: ${line}`);
  const day = match[2].padStart(2, '0');
  return `${match[3]}-${monthNameToNumber(match[1])}-${day}`;
}

describe('lib/seo — LEGAL_UPDATED_AT matches the legal pages', () => {
  it('pins LEGAL_UPDATED_AT to the date shown on the legal pages', () => {
    expect(updatedDate(legalI18nEn.privacyUpdated)).toBe(LEGAL_UPDATED_AT);
    expect(updatedDate(legalI18nEn.termsUpdated)).toBe(LEGAL_UPDATED_AT);
  });
});
