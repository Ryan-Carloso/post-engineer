export const IDENTITY_CARD_ACCEPTED_VERSIONS = [1, 2] as const;
export const IDENTITY_CARD_MAX_BYTES = 4096;
export const SCENE_MAX_BYTES = 2048;
export const IDENTITY_TEXT_MAX_LENGTH = 80;
export const IDENTITY_CARD_MISSING_CODE = 'IDENTITY_CARD_MISSING';

export const OUTFIT_SLOTS = ['top', 'bottom', 'one_piece', 'outerwear', 'footwear', 'accessories'] as const;
export const SCENE_LIGHTING = ['soft_daylight', 'golden_hour', 'overcast', 'studio', 'warm_indoor', 'night_city'] as const;
export const SCENE_FRAMING = ['close_up', 'head_and_shoulders', 'waist_up', 'full_body'] as const;
export const SCENE_ASPECTS = ['9:16', '4:5', '1:1', '16:9'] as const;
