import { describe, it, expect } from "vitest";

import {
  offeredTools,
  routeToolCall,
  describeTool,
  SUBMIT_TRANSLATION_TOOL_NAME,
  type PluginToolDefinition,
  type OfferedTool,
} from "../../../server/mcp/tool-gate.js";

const WORKER_TOOL: OfferedTool = {
  name: SUBMIT_TRANSLATION_TOOL_NAME,
  description: "Report the finished translation.",
  inputSchema: { type: "object", properties: { translations: { type: "array" } } },
};

const PLUGINS: PluginToolDefinition[] = [
  { name: "manageCollection", description: "Read and write collections.", parameters: { type: "object", properties: { action: { type: "string" } } } },
  { name: "presentHtml", description: "Show an HTML artifact.", prompt: "Prefer this over printing HTML.", parameters: { type: "object" } },
  { name: "spawnBackgroundChat", description: "Start another session." },
];

const names = (tools: OfferedTool[]) => tools.map((tool) => tool.name);

// A hidden translation worker is fed untrusted sentence content with its tools auto-allowed,
// so nothing stops it at a permission prompt. These two rules are what keeps an injected
// string from reaching a real tool.
describe("the translation worker's tool gate", () => {
  describe("what a worker is offered", () => {
    it("offers the worker exactly one tool", () => {
      expect(offeredTools(true, PLUGINS, WORKER_TOOL)).toEqual([WORKER_TOOL]);
    });

    it("offers a worker no plugin tool, however many there are", () => {
      expect(names(offeredTools(true, PLUGINS, WORKER_TOOL))).not.toContain("manageCollection");
      expect(offeredTools(true, PLUGINS, WORKER_TOOL)).toHaveLength(1);
    });
  });

  describe("what a worker may call", () => {
    it("lets it report its translation", () => {
      expect(routeToolCall(SUBMIT_TRANSLATION_TOOL_NAME, true)).toEqual({ kind: "submit-translation" });
    });

    // The second layer: the list is only a list, and a model can name a tool it was never
    // shown — the name is exactly what an injected string would supply.
    it.each(["manageCollection", "spawnBackgroundChat", "presentHtml", "manageAccounting"])("refuses %s even though it was never offered", (name) => {
      const route = routeToolCall(name, true);
      expect(route.kind).toBe("refused");
    });

    it("names the refused tool, so the model can tell what it did wrong", () => {
      const route = routeToolCall("manageCollection", true);
      expect(route.kind === "refused" && route.message).toContain("manageCollection");
      expect(route.kind === "refused" && route.message).toContain("submitTranslation");
    });

    // Near-misses matter: the check is an exact match, so anything that merely looks like
    // the worker tool has to fall through to the refusal rather than the submit path.
    it.each(["submitTranslations", "SubmitTranslation", "submit_translation", " submitTranslation", "submitTranslation ", ""])(
      "refuses the look-alike %o",
      (name) => {
        expect(routeToolCall(name, true).kind).toBe("refused");
      },
    );
  });

  describe("an ordinary session is unaffected", () => {
    it("is offered every plugin, in order", () => {
      expect(names(offeredTools(false, PLUGINS, WORKER_TOOL))).toEqual(["manageCollection", "presentHtml", "spawnBackgroundChat"]);
    });

    it("is not offered the worker-only tool", () => {
      expect(names(offeredTools(false, PLUGINS, WORKER_TOOL))).not.toContain(SUBMIT_TRANSLATION_TOOL_NAME);
    });

    it("dispatches whatever it calls", () => {
      expect(routeToolCall("manageCollection", false)).toEqual({ kind: "dispatch" });
      expect(routeToolCall("anything-at-all", false)).toEqual({ kind: "dispatch" });
    });

    // Current behaviour, pinned rather than endorsed: the submit branch is checked before
    // the worker branch, so an ordinary session that guesses the name reaches it too. It
    // can only ever submit for its OWN session id (the broker captures it), and with no
    // translation pending that answers 404 — but "worker-only" is not what the code enforces.
    it("also reaches the submit path if it names the worker tool", () => {
      expect(routeToolCall(SUBMIT_TRANSLATION_TOOL_NAME, false)).toEqual({ kind: "submit-translation" });
    });
  });

  describe("edge cases in the offered list", () => {
    it("offers nothing when no plugin is enabled", () => {
      expect(offeredTools(false, [], WORKER_TOOL)).toEqual([]);
    });

    it("still offers the worker its tool when no plugin is enabled", () => {
      expect(offeredTools(true, [], WORKER_TOOL)).toEqual([WORKER_TOOL]);
    });

    // MCP requires the field, and a tool without one is dropped by some clients.
    it("gives a definition with no parameters an empty object schema", () => {
      const [, , noParams] = offeredTools(false, PLUGINS, WORKER_TOOL);
      expect(noParams.inputSchema).toEqual({ type: "object", properties: {} });
    });

    it("passes a declared schema through untouched", () => {
      const [collection] = offeredTools(false, PLUGINS, WORKER_TOOL);
      expect(collection.inputSchema).toEqual(PLUGINS[0].parameters);
    });
  });
});

// The host's usage guidance is not part of the schema the model receives, so it only reaches
// the model by riding in the description.
describe("describeTool", () => {
  it("folds the prompt in after the description", () => {
    expect(describeTool({ name: "x", description: "What it does.", prompt: "When to use it." })).toBe("What it does.\n\nWhen to use it.");
  });

  it("leaves a description without a prompt alone", () => {
    expect(describeTool({ name: "x", description: "What it does." })).toBe("What it does.");
  });

  it("uses the prompt alone when there is no description", () => {
    expect(describeTool({ name: "x", prompt: "When to use it." })).toBe("When to use it.");
  });

  it("produces an empty string when there is neither", () => {
    expect(describeTool({ name: "x" })).toBe("");
  });
});
