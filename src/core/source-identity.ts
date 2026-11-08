/** Exact source-byte identity; different hashes do not establish biological independence. */
const identities = new WeakMap<Blob, Promise<string>>();
export function sourceContentId(source: Blob): Promise<string> {
  const known = identities.get(source);
  if (known) return known;
  const pending = source.arrayBuffer().then((bytes) => crypto.subtle.digest('SHA-256', bytes))
    .then((hash) => 'sha256:' + Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join(''));
  identities.set(source, pending);
  pending.catch(() => identities.delete(source));
  return pending;
}
