import { describe, expect, it } from 'vitest';
import { hasForbiddenContent, normalize } from '../segment-text.js';

describe('segment-text helpers', () => {
  it('hasForbiddenContent rejects placeholders', () => {
    expect(hasForbiddenContent('TODO: finish this later')).toBe(true);
    expect(hasForbiddenContent('[insira o texto aqui]')).toBe(true);
    expect(hasForbiddenContent('[insert text here]')).toBe(true);
    expect(hasForbiddenContent('Lorem ipsum dolor')).toBe(true);
  });

  it('hasForbiddenContent rejects links, markdown, emoji and brackets', () => {
    expect(hasForbiddenContent('see https://example.com for more')).toBe(true);
    expect(hasForbiddenContent('see http://example.com for more')).toBe(true);
    expect(hasForbiddenContent('visit www.example.com today')).toBe(true);
    expect(hasForbiddenContent('this is **bold** text')).toBe(true);
    expect(hasForbiddenContent('this is __bold__ text')).toBe(true);
    expect(hasForbiddenContent('run `code` here')).toBe(true);
    expect(hasForbiddenContent('first line\n# Heading here')).toBe(true);
    expect(hasForbiddenContent('so happy 😀 today')).toBe(true);
    expect(hasForbiddenContent('do this [pause] now')).toBe(true);
  });

  it('hasForbiddenContent accepts plain spoken text', () => {
    expect(hasForbiddenContent('You did everything right, and the weight still came back.')).toBe(false);
    expect(hasForbiddenContent('Save this for week three, it is when it matters most.')).toBe(false);
  });

  it('normalize strips punctuation and lowercases', () => {
    expect(normalize('Hello, World!')).toBe('hello world');
    expect(normalize('  Keep  the   spaces  ')).toBe('keep  the   spaces');
    expect(normalize("It's 2026!")).toBe('its 2026');
  });

  it('normalize keeps letters, numbers and underscores', () => {
    expect(normalize('take_1: the first time.')).toBe('take_1 the first time');
    expect(normalize('Café 42.')).toBe('café 42');
  });
});
