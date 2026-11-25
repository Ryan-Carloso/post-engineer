import {
  IDENTITY_CARD_MAX_BYTES,
  IDENTITY_TEXT_MAX_LENGTH,
  OUTFIT_SLOTS,
  SCENE_ASPECTS,
  SCENE_FRAMING,
  SCENE_LIGHTING,
  SCENE_MAX_BYTES,
} from '../../../shared/contracts/persona-identity-card-limits.ts';

const text = { type: 'string', minLength: 1, maxLength: IDENTITY_TEXT_MAX_LENGTH };
const strict = (properties, required = []) => ({
  type: 'object',
  properties,
  additionalProperties: false,
  ...(required.length > 0 ? { required } : {}),
});

const outfit = strict(Object.fromEntries(OUTFIT_SLOTS.map((slot) => [slot, text])));
outfit.description =
  'Clothing only, one line per slot. one_piece cannot be combined with top or bottom. Nudity, sexualised clothing and words about the person (hair, skin, body) are rejected.';

const identityCard = strict(
  {
    version: { type: 'integer', enum: [1] },
    identity: strict({
      face: strict({
        shape: text,
        eyes: text,
        eyebrows: text,
        nose: text,
        lips: text,
        skin: text,
        hair: strict({ color: text, style: text, length: text }),
        facial_hair: text,
        marks: text,
      }),
      body: strict({ build: text, height: text, shoulders: text, hands: text }),
    }),
    defaults: strict({ outfit }),
  },
  ['version', 'identity'],
);
identityCard.description = `Versioned identity card (at most ${IDENTITY_CARD_MAX_BYTES} bytes, every level strict, at least one identity trait). It describes a real person's physical traits: fill it only with their consent. Advice for the agent's image tool, not enforcement.`;

const scene = strict(
  {
    outfit,
    pose: { ...text, description: 'Free text about the pose. Words about the person (hair, skin, body) are rejected.' },
    setting: { ...text, description: 'Free text about the place. Words about the person (hair, skin, body) are rejected.' },
    lighting: { type: 'string', enum: [...SCENE_LIGHTING] },
    framing: { type: 'string', enum: [...SCENE_FRAMING] },
    aspect: { type: 'string', enum: [...SCENE_ASPECTS] },
  },
  ['lighting', 'framing'],
);
scene.description = `Scene only (at most ${SCENE_MAX_BYTES} bytes). Identity, face, body and version keys are rejected.`;

export const personaCardFormFields = {
  identityCard: {
    type: 'string',
    description: `The identity card as a JSON string (at most ${IDENTITY_CARD_MAX_BYTES} bytes). Send the JSON literal null on PATCH to clear it; omit the field to leave it unchanged.`,
  },
};

export function personaCardOperationSchemas({ success, object, str }) {
  return {
    'GET /api/persona/identity-card': {
      description: 'Reads the identity card of one persona. It is never part of the persona list or a share page.',
      query: [{ name: 'personaId', required: true }],
      response: success({ identityCard: { ...identityCard, nullable: true } }),
      extraResponses: { 403: 'A persona-scoped API key that does not include this persona.' },
    },
    'POST /api/persona/identity-card': {
      description:
        'Renders the image prompt for one scene from the stored card. Nothing is generated or stored: the prompt is advice for the agent\'s own image tool.',
      request: { ...object({ personaId: str, scene }, ['personaId', 'scene']), additionalProperties: false },
      response: success({
        prompt: { ...str, description: 'The deterministic edit prompt; identity text comes only from the card.' },
        suggestedDescription: { ...str, maxLength: 500, description: 'A library description made from the outfit, setting, lighting and framing, never from the identity.' },
        cardVersion: { type: 'integer', enum: [1] },
      }),
      extraResponses: {
        403: 'A persona-scoped API key that does not include this persona.',
        409: 'The persona has no identity card (IDENTITY_CARD_MISSING).',
      },
    },
  };
}
