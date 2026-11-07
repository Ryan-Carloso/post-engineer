//---------------
// scheduled_posts.faceless_material CHECK (migration 029): the b-roll or SVG
// source of a faceless render. Dependency-free: the route's zod schema, the
// slot/post detail shapes and the enum-sync test all import this list.
//---------------
export const FACELESS_MATERIALS = ['broll', 'svg'] as const;
export type FacelessMaterial = (typeof FACELESS_MATERIALS)[number];
