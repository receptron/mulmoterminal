// Node-side Firebase init for MulmoTerminal's remote-host runner.
//
// The init itself lives in the shared @mulmoclaude/core/remote-host/server; this
// module just supplies the public web config for the shared `mulmoserver`
// project. The config values are NOT secrets — they identify the project to the
// client SDK; access is gated by Firestore security rules. Firestore must be in
// Native mode.
//
// The config is duplicated from src/config/firebaseConfig.ts (the browser copy)
// on purpose: the server tsconfig does not cross into src/, and MulmoTerminal's
// convention is to mirror small shared values across the client/server boundary
// rather than import a shared module. Keep the two copies in sync.
import { createRemoteHostFirebase } from "@mulmoclaude/core/remote-host/server";

const firebaseConfig = {
  apiKey: "AIzaSyC5IrhcCtfVQ4nZeI89Owa7da_D-It0b9s",
  authDomain: "mulmoserver.firebaseapp.com",
  projectId: "mulmoserver",
  storageBucket: "mulmoserver.firebasestorage.app",
  messagingSenderId: "830257137330",
  appId: "1:830257137330:web:5cb8db01ae61b5d161abab",
  measurementId: "G-Y75JGK1G4T",
} as const;

export const { firestore, auth } = createRemoteHostFirebase(firebaseConfig);
