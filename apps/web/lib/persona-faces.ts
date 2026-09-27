//---------------
// Default house character/face catalog — same source as the picker in
// app/(main)/persona/page.tsx (public/caracter-samples/file-N.png).
// Exposed by GET /api/persona/faces for MCP and authenticated clients.
// gender/age/ethnicity/hair/description exist because MCP cannot show photos.
// age is a single integer (e.g. 23), never a range.
// All metadata strings are English.
//---------------

export type PersonaFaceGender = 'female' | 'male';

export interface PersonaFace {
  id: string;
  url: string;
  name: string;
  /** Relative path served by Next (what the UI stores in avatar_url). */
  path: string;
  gender: PersonaFaceGender;
  /** Apparent age estimate (single integer, not a range). */
  age: number;
  /** Ethnicity / ancestry presentation for agents picking without the photo. */
  ethnicity: string;
  /** Short hair description in English. */
  hair: string;
  /** Appearance and vibe in English — for agents choosing without the photo. */
  description: string;
}

interface PersonaFaceMeta {
  gender: PersonaFaceGender;
  age: number;
  ethnicity: string;
  hair: string;
  description: string;
}

/** PNG IDs under public/caracter-samples — keep aligned with the UI carousel. */
export const DEFAULT_PERSONA_FACE_IDS = [
  'file-1',
  'file-2',
  'file-3',
  'file-4',
  'file-5',
  'file-6',
  'file-7',
  'file-8',
  'file-9',
  'file-10',
  'file-11',
  'file-12',
  'file-13',
  'file-14',
] as const;

export type DefaultPersonaFaceId = (typeof DEFAULT_PERSONA_FACE_IDS)[number];

/** Visual metadata per PNG — aligned with public/caracter-samples. */
export const DEFAULT_PERSONA_FACE_META: Record<DefaultPersonaFaceId, PersonaFaceMeta> = {
  'file-1': {
    gender: 'female',
    age: 23,
    ethnicity: 'White',
    hair: 'shoulder-length wavy blonde',
    description:
      'Young blonde woman with light eyes, smiling in a casual selfie wearing a white tank top. Light, approachable look — good for female lifestyle and fitness content.',
  },
  'file-2': {
    gender: 'male',
    age: 30,
    ethnicity: 'White',
    hair: 'dark brown wavy',
    description:
      'Man around 30 with dark wavy hair, a neat beard, and thin black round glasses. Black t-shirt, friendly professional vibe.',
  },
  'file-3': {
    gender: 'female',
    age: 22,
    ethnicity: 'White',
    hair: 'long wavy blonde with highlights',
    description:
      'Young blonde woman with highlights, greenish eyes and light freckles, broad smile. White tank top, casual bedroom vibe — strong fit for female fitness content.',
  },
  'file-4': {
    gender: 'male',
    age: 23,
    ethnicity: 'White',
    hair: 'slightly messy blonde',
    description:
      'Young blonde man with light eyes, gray hoodie, soft smile. Coding setup in the background — developer / tech creator persona.',
  },
  'file-5': {
    gender: 'female',
    age: 32,
    ethnicity: 'Black',
    hair: 'medium-length dark brown curly',
    description:
      'Woman around 32 with dark curly hair, light brown skin, confident smile. Terracotta blazer and gold jewelry — warm professional look.',
  },
  'file-6': {
    gender: 'male',
    age: 29,
    ethnicity: 'Latino',
    hair: 'short wavy dark brown',
    description:
      'Man around 29 with dark hair and beard, wide smile. Black athletic tee, gym background — fits male fitness content.',
  },
  'file-7': {
    gender: 'male',
    age: 48,
    ethnicity: 'White',
    hair: 'salt-and-pepper swept back',
    description:
      'Man around 48 with salt-and-pepper hair and beard, closed confident smile. Dark blazer over black tee — mature executive persona.',
  },
  'file-8': {
    gender: 'female',
    age: 31,
    ethnicity: 'Latina',
    hair: 'long straight brown with caramel highlights',
    description:
      'Woman around 31 with long brown hair and highlights, brown eyes, thoughtful chin-on-hand pose. White blazer — corporate professional look.',
  },
  'file-9': {
    gender: 'male',
    age: 24,
    ethnicity: 'Latino',
    hair: 'dark brown wavy styled upward',
    description:
      'Young man around 24 with dark wavy hair, short beard, stud earring and chain. Black hoodie, gamer/anime shelf backdrop — content-creator persona.',
  },
  'file-10': {
    gender: 'female',
    age: 27,
    ethnicity: 'Latina',
    hair: 'brown with highlights in a voluminous messy bun',
    description:
      'Woman around 27 with tanned skin, messy bun with loose waves, bold makeup. Colorful crochet top and flower earrings — creative fashion vibe.',
  },
  'file-11': {
    gender: 'female',
    age: 28,
    ethnicity: 'Latina',
    hair: 'voluminous dark brown curls',
    description:
      'Woman around 28 with voluminous dark curls, warm skin, open smile. Light open shirt and olive bottoms — great for female lifestyle and fitness.',
  },
  'file-12': {
    gender: 'male',
    age: 35,
    ethnicity: 'Middle Eastern',
    hair: 'short neatly styled dark brown/black',
    description:
      'Man around 35 with short dark hair, neat beard, subtle smile. Navy blazer over black tee — business-casual look.',
  },
  'file-13': {
    gender: 'female',
    age: 26,
    ethnicity: 'Black',
    hair: 'short natural black afro',
    description:
      'Young Black woman with a short natural afro, brown eyes, bright smile. White ribbed tank top, soft indoor light — strong fit for female lifestyle and fitness.',
  },
  'file-14': {
    gender: 'male',
    age: 28,
    ethnicity: 'Black',
    hair: 'very short black buzz cut',
    description:
      'Young Black man with a short buzz cut, neat full beard, genuine smile. Black crew-neck tee, warm indoor background — friendly athletic lifestyle look.',
  },
};

export function personaFacePath(id: DefaultPersonaFaceId | string): string {
  return `/caracter-samples/${id}.png`;
}

export function listDefaultPersonaFaces(appBaseUrl: string): PersonaFace[] {
  const base = appBaseUrl.replace(/\/+$/, '');
  return DEFAULT_PERSONA_FACE_IDS.map((id, index) => {
    const path = personaFacePath(id);
    const meta = DEFAULT_PERSONA_FACE_META[id];
    return {
      id,
      path,
      url: `${base}${path}`,
      name: `Character ${index + 1}`,
      gender: meta.gender,
      age: meta.age,
      ethnicity: meta.ethnicity,
      hair: meta.hair,
      description: meta.description,
    };
  });
}
