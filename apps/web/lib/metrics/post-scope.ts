export function postInPersonaScope(
  personaId: string | null,
  voiceover: boolean,
  scope: ReadonlyArray<string> | null,
): boolean {
  if (scope === null) return true;
  if (personaId === null) return voiceover === true;
  return scope.includes(personaId);
}
