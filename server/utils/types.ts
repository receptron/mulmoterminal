// Shared type definitions to eliminate duplication across server/config and client

import type { ITheme } from "@xterm/xterm";

export interface DirConfigShared {
  name: string | null;
  badgeColor: string | null;
  headerColor: string | null;
  headerTextColor: string | null;
  cellColor: string | null;
  cellBorderColor: string | null;
  dotColor: string | null;
  buttonColor: string | null;
  theme: string | null;
  colors: Record<string, string> | Partial<ITheme> | null;
}
