// Shared error handling utilities to reduce duplication across error reporting patterns
export const formatErrorMessage = (code: number, details?: string): string => {
  const messages: Record<number, string> = {
    400: "Invalid request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not found",
    409: "Conflict",
    500: "Internal server error",
  };
  const base = messages[code] || `Error ${code}`;
  return details ? `${base}: ${details}` : base;
};

export const logError = (context: string, error: Error | string): void => {
  const msg = error instanceof Error ? error.message : error;
  console.error(`[${context}] ${msg}`);
};
