import { describe, it, expect } from 'vitest';
import { listDefaultPersonaFaces, DEFAULT_PERSONA_FACE_IDS } from '../persona-faces';

describe('listDefaultPersonaFaces', () => {
  it('mirrors the UI picker PNGs with absolute URLs and English metadata', () => {
    const faces = listDefaultPersonaFaces('https://post-engineer.com/');
    expect(faces).toHaveLength(DEFAULT_PERSONA_FACE_IDS.length);
    expect(faces).toHaveLength(14);
    expect(faces.map((f) => f.id)).toEqual([...DEFAULT_PERSONA_FACE_IDS]);
    expect(faces[0]).toMatchObject({
      id: 'file-1',
      path: '/caracter-samples/file-1.png',
      url: 'https://post-engineer.com/caracter-samples/file-1.png',
      name: 'Character 1',
      gender: 'female',
      age: 23,
      ethnicity: 'White',
      hair: 'shoulder-length wavy blonde',
    });
    expect(faces[0].description).toContain('Young blonde woman');
    expect(faces[12]).toMatchObject({
      id: 'file-13',
      gender: 'female',
      age: 26,
      ethnicity: 'Black',
    });
    expect(faces[13]).toMatchObject({
      id: 'file-14',
      gender: 'male',
      age: 28,
      ethnicity: 'Black',
    });
    for (const face of faces) {
      expect(typeof face.age).toBe('number');
      expect(Number.isInteger(face.age)).toBe(true);
      expect(face.age).toBeGreaterThan(0);
      expect(['female', 'male']).toContain(face.gender);
      expect(face.ethnicity.length).toBeGreaterThan(0);
      expect(face.hair.length).toBeGreaterThan(0);
      expect(face.description.length).toBeGreaterThan(20);
      // Metadata must stay English (no Portuguese diacritics / common PT words).
      expect(face.description).not.toMatch(/[àáâãéêíóôõúç]/i);
      expect(face.hair).not.toMatch(/[àáâãéêíóôõúç]/i);
      expect(face.description).not.toMatch(/\b(mulher|homem|cabelo|anos)\b/i);
    }
  });
});
