// Which session started which through spawnBackgroundChat, and the text each parent last sent its
// child (#3404). It is what limits sendToSession to sessions the caller started.
//
// Process lifetime on purpose: a restart forgets it, and a session started before then can no
// longer be sent to. The refusal says so (routes/sessionAsk.ts).
export interface SpawnedSessions {
  recordSpawn: (child: string, parent: string) => void;
  parentOf: (child: string) => string | undefined;
  rememberSent: (child: string, text: string) => void;
  lastSentTo: (child: string) => string | undefined;
}

export function createSpawnedSessions(): SpawnedSessions {
  const parents = new Map<string, string>();
  const lastSent = new Map<string, string>();
  return {
    recordSpawn: (child, parent) => {
      parents.set(child, parent);
    },
    parentOf: (child) => parents.get(child),
    rememberSent: (child, text) => {
      lastSent.set(child, text);
    },
    lastSentTo: (child) => lastSent.get(child),
  };
}

export const spawnedSessions = createSpawnedSessions();
