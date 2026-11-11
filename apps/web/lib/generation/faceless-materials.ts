//---------------
// scheduled_posts.faceless_material CHECK (migrations 029, 043, 054): what
// fills the video — only the agent's own segment images since migration 054
// backfilled every stored row to 'images'. Dependency-free: the route's zod
// schema, the slot/post detail shapes and the enum-sync test all import
// this list.
//---------------
export const FACELESS_MATERIALS = ['images'] as const;
export type FacelessMaterial = (typeof FACELESS_MATERIALS)[number];

/** A stored or posted material value: 'images' is the only material left,
 *  so every value normalizes to it. */
export function toFacelessMaterial(_value: unknown): FacelessMaterial {
  return 'images';
}
