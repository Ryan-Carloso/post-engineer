const TRANSIENT_AUTH_STATUSES: ReadonlySet<number> = new Set([
  429, 500, 501, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530,
])

export function isTransientAuthError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if ('name' in error && error.name === 'AuthRetryableFetchError') return true
  return 'status' in error && typeof error.status === 'number' && TRANSIENT_AUTH_STATUSES.has(error.status)
}

export function authErrorLogFields(error: unknown): { name: string; status: number | null } {
  if (typeof error !== 'object' || error === null) return { name: 'unknown', status: null }
  const name = 'name' in error && typeof error.name === 'string' ? error.name : 'unknown'
  const status = 'status' in error && typeof error.status === 'number' ? error.status : null
  return { name, status }
}
