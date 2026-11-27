// How a Canvas card draws for a remote cell (#3506). Pure.
//
// A card's view runs on this machine, and its data, its plugin dispatch and its pages are on the
// cell's host. The dispatch knows the host (pluginRuntime.ts); what a view builds from the result
// itself does not, so each rule here either hands the view a result that names the host, or says the
// card cannot be drawn here.
import { htmlArtifactPreviewUrl } from "@mulmoclaude/html-plugin";
import { chartSources, isValidChartDocument } from "@mulmoclaude/chart-plugin";
import { isRecord } from "../../common/isRecord";
import { bytesPath } from "./remoteCell";

export interface CanvasCardResult {
  uuid: string;
  toolName: string;
  title?: string;
  message?: string;
  data?: unknown;
  jsonData?: unknown;
  viewState?: unknown;
}

/** The result a view draws for a card on `host`, or null when it reads what this machine cannot reach. */
export type RemoteCardRule = (result: CanvasCardResult, host: string) => CanvasCardResult | null;

/** A view that draws from the result alone. */
export const drawnAsIs: RemoteCardRule = (result) => result;

// The page is in the result only as a path, and the view builds `/artifacts/html/…` or `/htmlfile/…`
// from it unless handed a URL; handed one through the byte proxy, the iframe loads the host's page.
export const htmlPageOnHost: RemoteCardRule = (result, host) => {
  const data = isRecord(result.data) ? result.data : null;
  const filePath = data && typeof data.filePath === "string" ? data.filePath : null;
  const given = data && typeof data.previewUrl === "string" ? data.previewUrl : htmlArtifactPreviewUrl(filePath);
  if (data === null || given === null || !given.startsWith("/")) return result;
  return { ...result, data: { ...data, previewUrl: bytesPath(host, given) } };
};

// A chart that reads a spreadsheet range redraws from this machine's workbook channel and asks for
// the range; one written inline needs neither.
export const inlineChartsOnly: RemoteCardRule = (result) => {
  const document = isRecord(result.data) ? result.data.document : undefined;
  if (!isValidChartDocument(document)) return null;
  return document.charts.every((chart) => chartSources(chart).length === 0) ? result : null;
};
