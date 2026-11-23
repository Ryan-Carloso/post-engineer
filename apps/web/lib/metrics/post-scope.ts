export function postInPersonaScope(
  personaId: string | null,
  faceless: boolean,
  scope: ReadonlyArray<string> | null,
): boolean {
  if (scope === null) return true;
  if (personaId === null) return faceless === true;
  return scope.includes(personaId);
}
