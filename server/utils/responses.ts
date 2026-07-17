import type { Response } from "express";

// Unified 404 error responses to reduce duplication across collections.ts
export const send404NotFound = (res: Response, entity: string, name: string): void => {
  res.status(404).json({ error: `${entity} '${name}' not found` });
};

export const sendItemNotFound = (res: Response, itemId: string): void => {
  res.status(404).json({ error: `item '${itemId}' not found` });
};

export const sendViewNotFound = (res: Response): void => {
  res.status(404).json({ error: "view not found" });
};

export const send403Forbidden = (res: Response, message: string): void => {
  res.status(403).json({ error: message });
};

export const send500Error = (res: Response, message: string): void => {
  res.status(500).json({ error: message });
};
