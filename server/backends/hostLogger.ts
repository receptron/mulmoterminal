// Console-backed logger in the (prefix, message, data?) shape every @mulmoclaude/core
// engine injects — CollectionLogger and GoogleLogger are structurally identical, so
// one shim serves each `configure*Host({ log })` binding.
export const hostLogger = {
  error: (prefix: string, message: string, data?: Record<string, unknown>) => console.error(`[${prefix}] ${message}`, data ?? ""),
  warn: (prefix: string, message: string, data?: Record<string, unknown>) => console.warn(`[${prefix}] ${message}`, data ?? ""),
  info: (prefix: string, message: string, data?: Record<string, unknown>) => console.log(`[${prefix}] ${message}`, data ?? ""),
  debug: (prefix: string, message: string, data?: Record<string, unknown>) => console.debug(`[${prefix}] ${message}`, data ?? ""),
};
