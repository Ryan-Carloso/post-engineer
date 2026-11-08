//---------------
// scheduled_posts.faceless_material CHECK (migrations 029, 043): what fills
// the video — stock b-roll, SVG drawings, or only the agent's own segment
// images. Dependency-free: the route's zod schema, the slot/post detail
// shapes and the enum-sync test all import this list.
//---------------
export const FACELESS_MATERIALS = ['broll', 'svg', 'images'] as const;
export type FacelessMaterial = (typeof FACELESS_MATERIALS)[number];

/** A stored or posted material value, read the way the engine's slot_material
 *  does: only an exact known value counts, anything else is the stock it
 *  renders with. */
export function toFacelessMaterial(value: unknown): FacelessMaterial {
  return value === 'svg' || value === 'images' ? value : 'broll';
}
