/** @param {Record<string, string | undefined>} env */
export function clientPort(env) {
  return Number(env.CLIENT_PORT) || 6856;
}
