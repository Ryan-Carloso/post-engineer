import type { components } from './schema.gen';

export type EngineVideoRequest = components['schemas']['TaskVideoRequest'];

export type EngineVideoRequestField = keyof EngineVideoRequest & string;
