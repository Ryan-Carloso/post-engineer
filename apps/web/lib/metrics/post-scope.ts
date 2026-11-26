export function postInPersonaScope(
  personaId: string | null,
  scope: ReadonlyArray<string> | null,
): boolean {
  if (scope === null) return true;
  if (personaId === null) return false;
  return scope.includes(personaId);
}
