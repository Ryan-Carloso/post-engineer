import {
  IDENTITY_CARD_ACCEPTED_VERSIONS,
  IDENTITY_CARD_MAX_BYTES,
  IDENTITY_TEXT_MAX_LENGTH,
  OUTFIT_SLOTS,
  SCENE_ASPECTS,
  SCENE_FRAMING,
  SCENE_LIGHTING,
  SCENE_MAX_BYTES,
} from '../../../shared/contracts/persona-identity-card-limits.ts';
import { CARD_STYLES } from '../../../shared/contracts/persona-identity-card-styles.ts';

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

const leaves = (names) => Object.fromEntries(names.map((name) => [name, text]));

const identityCard = strict(
  {
    version: { type: 'integer', enum: [...IDENTITY_CARD_ACCEPTED_VERSIONS] },
    identity: strict({
      face: strict({
        ...leaves(['shape', 'eyes', 'eye_color', 'eyebrows', 'nose', 'lips', 'teeth', 'smile', 'skin', 'jawline', 'cheekbones', 'chin', 'forehead', 'ears']),
        hair: strict(leaves(['color', 'style', 'length', 'texture', 'parting'])),
        ...leaves(['facial_hair', 'marks', 'tattoos']),
      }),
      body: strict(leaves(['build', 'height', 'shoulders', 'arms', 'hands', 'waist', 'hips', 'legs', 'posture', 'proportions'])),
    }),
    defaults: strict({ style: { type: 'string', enum: [...CARD_STYLES] }, outfit }),
  },
  ['version', 'identity'],
);
identityCard.description = `Versioned identity card (version 1 or 2; new cards are version 2; at most ${IDENTITY_CARD_MAX_BYTES} bytes once stored, every level strict, at least one identity trait). A version 1 card carries only the original leaves and no style; defaults must name a style or an outfit. It describes a real person's physical traits: fill it only with their consent. Advice for the agent's image tool, not enforcement.`;

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
        cardVersion: { type: 'integer', enum: [...IDENTITY_CARD_ACCEPTED_VERSIONS] },
      }),
      extraResponses: {
        403: 'A persona-scoped API key that does not include this persona.',
        409: 'The persona has no identity card (IDENTITY_CARD_MISSING).',
      },
    },
  };
}
