// Redact a secret (app password, posting key) from an upstream error message.
// The error body may echo the request payload, so the secret is removed raw,
// percent-encoded, and JSON-escaped before the message reaches agent-visible
// output.
export function redactSecretFromError(error: unknown, secret: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (secret.length === 0) return new Error(message);
  const variants = [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)];
  return new Error(variants.reduce((text, variant) => text.replaceAll(variant, '[redacted]'), message));
}
