// A worker message as a call on the Library service (#3328). The message crossed a thread boundary as
// plain data, so every argument is read back through a guard rather than trusted. Pure.
import { isRecord } from "../../../common/isRecord.js";
import type { ConversationFilter } from "./index-queries.js";
import type { LibraryCaller, LibraryMethod, LibraryRequest, LibraryService } from "./library-service.js";

const METHODS: readonly LibraryMethod[] = ["status", "list", "conversation", "search", "forRepository"];

export const isLibraryRequest = (value: unknown): value is LibraryRequest =>
  isRecord(value) && typeof value.id === "string" && METHODS.some((method) => method === value.method) && Array.isArray(value.args);

const count = (value: unknown): number => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0);
const text = (value: unknown): string => (typeof value === "string" ? value : "");

export function filterArg(value: unknown): ConversationFilter {
  if (!isRecord(value)) return {};
  return {
    ...(typeof value.cwd === "string" ? { cwd: value.cwd } : {}),
    includeTemporary: value.includeTemporary === true,
    includeAutomated: value.includeAutomated === true,
    includeSidechains: value.includeSidechains === true,
  };
}

export function dispatchLibraryRequest(service: LibraryService, request: LibraryRequest): Promise<unknown> {
  const [first, second, third] = request.args;
  switch (request.method) {
    case "status":
      return service.status();
    case "list":
      return service.list(filterArg(first), count(second), count(third));
    case "conversation":
      return service.conversation(text(first), typeof second === "string" && second !== "" ? second : null);
    case "search":
      return service.search(text(first), filterArg(second), count(third));
    case "forRepository":
      return service.forRepository(text(first), count(second));
  }
}

/** The service called in this thread, with the worker's calling convention. */
export const localLibraryCaller =
  (service: LibraryService): LibraryCaller =>
  (method, args) =>
    dispatchLibraryRequest(service, { id: "local", method, args });
