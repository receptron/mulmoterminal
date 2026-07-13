// Public web config for the shared `mulmoserver` Firebase project, used by the
// remote-host runner. The values are NOT secrets — they identify the project to
// the client SDK; access is gated by Firestore security rules. Firestore must be
// in Native mode.
//
// The Firebase app/auth/firestore/storage handles are NOT created here anymore:
// the session controller (session.ts) opens a fresh app per (re)connect so a
// browser-parked session can be restored after a server restart (case A',
// mulmoserver#50). This module only supplies the config it seeds them with.
//
// The config is duplicated from src/config/firebaseConfig.ts (the browser copy)
// on purpose: the server tsconfig does not cross into src/, and MulmoTerminal's
// convention is to mirror small shared values across the client/server boundary
// rather than import a shared module. Keep the two copies in sync.
export const firebaseConfig = {
  apiKey: "AIzaSyC5IrhcCtfVQ4nZeI89Owa7da_D-It0b9s",
  authDomain: "mulmoserver.firebaseapp.com",
  projectId: "mulmoserver",
  storageBucket: "mulmoserver.firebasestorage.app",
  messagingSenderId: "830257137330",
  appId: "1:830257137330:web:5cb8db01ae61b5d161abab",
  measurementId: "G-Y75JGK1G4T",
} as const;
