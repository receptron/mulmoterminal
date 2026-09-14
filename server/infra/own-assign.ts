/**
 * Set a key that came from PARSED JSON, without letting `__proto__` disappear.
 *
 * `target[key] = value` with `key === "__proto__"` runs the inherited setter on Object.prototype
 * instead of creating an own property: the entry is silently lost, and the object's shape changes.
 * `JSON.parse` really can produce that key as an OWN property — an object literal cannot — so any
 * map rebuilt from a file a user wrote needs this. `Object.defineProperty` bypasses the setter.
 *
 * Shared because it is a rule about untrusted input, not a local trick: `server/backends/translation.ts`
 * and `server/backends/remoteHost/jsonPayload.ts` each grew their own copy before this existed, and a
 * fourth copy is how one of them ends up subtly different.
 */
export function assignOwn<V>(target: Record<string, V>, key: string, value: V): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}
