// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Replace with YOUR config from the Firebase console
const firebaseConfig = {
  apiKey: "AIzaSyACnrSCo-RXuvKFiuxf7NzIshxDZzIwF50",
  authDomain: "pokedexset.firebaseapp.com",
  projectId: "pokedexset",
  storageBucket: "pokedexset.firebasestorage.app",
  messagingSenderId: "1054153381662",
  appId: "1:1054153381662:web:67d43b3bdf3ae8ea525b0f"
};

const app = initializeApp(firebaseConfig);

// Auth
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Firestore
export const db = getFirestore(app);
