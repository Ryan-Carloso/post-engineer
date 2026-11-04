//---------------
// Engine contract types — aliases over the GENERATED schema.gen.ts
// (from apps/engine/openapi.json). Import engine request/response shapes
// from here instead of hand-copying them: a field renamed or removed in an
// engine Pydantic model then breaks the web typecheck, not production.
//---------------
import type { components } from './schema.gen';

/** Body of POST /api/v1/videos (engine `TaskVideoRequest`). */
export type EngineVideoRequest = components['schemas']['TaskVideoRequest'];

/** A top-level field name the engine's video request accepts. */
export type EngineVideoRequestField = keyof EngineVideoRequest & string;
