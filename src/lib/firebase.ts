import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, browserLocalPersistence, setPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDOwXsDG1QnUoY3IgIhx22Gl_Mwk37ddnE",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "automagent-8d64c.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "automagent-8d64c",
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "automagent-8d64c.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "364456345463",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:364456345463:web:efef5eac72ae69ad696b72",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-W43QE9KD3S",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({ prompt: "select_account" });

setPersistence(auth, browserLocalPersistence).catch((error: unknown) => {
  console.error("Failed to set auth persistence:", error);
});
