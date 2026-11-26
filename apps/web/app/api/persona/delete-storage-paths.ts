export function collectPersonaStoragePaths(persona: { photo_path: string | null }): string[] {
  return typeof persona.photo_path === 'string' && persona.photo_path.length > 0
    ? [persona.photo_path]
    : [];
}
