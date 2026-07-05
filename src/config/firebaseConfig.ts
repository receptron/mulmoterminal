// Firebase web-app config for the remote-host command channel (browser copy).
//
// These are the *public* Firebase web-config values for the shared `mulmoserver`
// project (apiKey et al. are not secrets — they identify the project to the
// client SDK; access is gated by Firestore security rules). Safe to commit.
//
// Duplicated from server/backends/remoteHost/firebase.ts on purpose: the server
// tsconfig does not cross into src/, and MulmoTerminal mirrors small shared
// values across the client/server boundary rather than importing a shared
// module. Keep the two copies in sync.
export const firebaseConfig = {
  apiKey: "AIzaSyC5IrhcCtfVQ4nZeI89Owa7da_D-It0b9s",
  authDomain: "mulmoserver.firebaseapp.com",
  projectId: "mulmoserver",
  storageBucket: "mulmoserver.firebasestorage.app",
  messagingSenderId: "830257137330",
  appId: "1:830257137330:web:5cb8db01ae61b5d161abab",
  measurementId: "G-Y75JGK1G4T",
} as const;
