import React, { useState, useEffect } from "react";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db, handleFirestoreError, OperationType } from "./lib/firebase";
import {
  generateRSAKeyPair,
  exportRSAPublicKey,
  savePrivateKeysIndexedDB,
  loadPrivateKeysIndexedDB,
} from "./lib/crypto";
import Onboarding from "./components/Onboarding";
import ChatLayout from "./components/ChatLayout";
import { Shield, Key, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [keychainLoading, setKeychainLoading] = useState(false);

  // E2EE Local Key State
  const [myRSAPublicKeyB64, setMyRSAPublicKeyB64] = useState<string | null>(null);
  const [myRSAPrivateKey, setMyRSAPrivateKey] = useState<CryptoKey | null>(null);

  // State in case keys are registered but private key is missing from local IndexedDB
  const [isKeyMismatch, setIsKeyMismatch] = useState(false);

  // Monitor Auth State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      setIsKeyMismatch(false);

      if (user) {
        setKeychainLoading(true);
        try {
          // A. Load or register E2EE user credentials
          await handleKeychainSync(user);
        } catch (err) {
          console.error("Keychain sync failure during onboarding:", err);
        } finally {
          setKeychainLoading(false);
        }
      } else {
        // Reset local States
        setMyRSAPrivateKey(null);
        setMyRSAPublicKeyB64(null);
      }
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  /**
   * Primary E2EE Key Coordinator
   * Recovers local IndexedDB key configuration if available,
   * otherwise generates a fresh RSA-OAEP credentials pair.
   */
  const handleKeychainSync = async (user: User) => {
    const userDocRef = doc(db, "users", user.uid);
    let userSnap;
    
    try {
      userSnap = await getDoc(userDocRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
      return;
    }

    // 1. Check if we have the private key cached locally in IndexedDB
    const cachedKeys = await loadPrivateKeysIndexedDB(user.uid);

    if (userSnap.exists()) {
      const userData = userSnap.data();
      
      if (cachedKeys && cachedKeys.publicKeyB64 === userData.publicKey) {
        // Direct Match - User has keys registered in Firestore AND loaded in IndexedDB
        setMyRSAPrivateKey(cachedKeys.privateKey);
        setMyRSAPublicKeyB64(cachedKeys.publicKeyB64);
        setIsKeyMismatch(false);
      } else {
        // Key Mismatch! Registered on Server but missing/cleared locally inside the browser.
        // Prompt user of mismatch and offer automatic regeneration.
        if (cachedKeys) {
          // Fallback loading local key if server allows it, but normally they need to sync.
          setMyRSAPrivateKey(cachedKeys.privateKey);
          setMyRSAPublicKeyB64(cachedKeys.publicKeyB64);
        } else {
          setIsKeyMismatch(true);
        }
      }
    } else {
      // 2. Fresh signup - generate E2EE key pairs right away
      await triggerKeyRegeneration(user);
    }
  };

  /**
   * Generates a new RSA Key Pair, registers it inside IndexedDB locally,
   * and updates/creates the Firestore User profile with the public key.
   */
  const triggerKeyRegeneration = async (user: User) => {
    try {
      setKeychainLoading(true);
      
      // A. Generate Web Crypto RSA-OAEP Key Pair
      const keypair = await generateRSAKeyPair();
      const pubB64 = await exportRSAPublicKey(keypair.publicKey);

      // B. Seal private key into IndexedDB
      await savePrivateKeysIndexedDB(user.uid, keypair.privateKey, pubB64);

      // C. Profile Registration to Firestore
      const userProfile = {
        uid: user.uid,
        displayName: user.displayName || "Secure Agent",
        email: user.email || "anonymous@secure-chat.com",
        photoURL: user.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.uid}`,
        publicKey: pubB64,
        createdAt: new Date().toISOString(), // Standard timestamp String
      };

      await setDoc(doc(db, "users", user.uid), userProfile, { merge: true });

      // Save states
      setMyRSAPrivateKey(keypair.privateKey);
      setMyRSAPublicKeyB64(pubB64);
      setIsKeyMismatch(false);
    } catch (err) {
      console.error("Error generating cryptographical identity pairs:", err);
      alert("Failed to initialize your E2EE keypair locally.");
    } finally {
      setKeychainLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.warn("Sign out triggered error:", e);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-slate-100" id="splash-auth-loading">
        <div className="space-y-4 text-center">
          <Loader2 className="w-10 h-10 animate-spin text-cyan-400 mx-auto" />
          <p className="text-xs uppercase tracking-widest font-semibold font-mono text-slate-400">Syncing Node Secure...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-cyan-500 selection:text-white" id="main-app">
      <AnimatePresence mode="wait">
        {!currentUser ? (
          <Onboarding onSignInSuccess={() => {}} />
        ) : keychainLoading ? (
          <div className="min-h-screen flex flex-col items-center justify-center p-4 space-y-4" id="splash-keychain-loading">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
            <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">Syncing Cryptographic Session keys...</span>
          </div>
        ) : isKeyMismatch ? (
          // Device Key Mismatch Dialog Screen
          <div className="min-h-screen flex flex-col items-center justify-center p-4 relative z-10" id="key-mismatch-screen">
            <div className="max-w-md w-full bg-slate-900 border border-slate-800 p-6 rounded-2xl text-center space-y-5 shadow-2xl">
              <div className="w-12 h-12 rounded-2xl bg-amber-950/20 text-amber-500 flex items-center justify-center mx-auto border border-amber-900/40">
                <AlertTriangle className="w-6 h-6 animate-pulse" />
              </div>

              <div className="space-y-2">
                <h2 className="text-white font-semibold text-lg tracking-tight">E2EE Private Key Not Found (New Device?)</h2>
                <p className="text-xs text-slate-400 leading-relaxed text-left">
                  Your identity public key is registered in the cloud, but the corresponding <strong className="text-white">private decryption key</strong> is missing in this browser's local sandbox storage (IndexedDB).
                </p>
                <p className="text-xs text-slate-400 leading-relaxed text-left mt-2">
                  To continue, you can generate a fresh E2EE Session Keypair. You'll be able to send/receive future encrypted messages, although messages encrypted prior to this reset can no longer be decrypted on this device.
                </p>
              </div>

              <div className="pt-2 flex flex-col gap-2">
                <button
                  onClick={() => triggerKeyRegeneration(currentUser)}
                  className="w-full py-3 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition uppercase tracking-wider font-mono select-none"
                >
                  <RefreshCw className="w-4 h-4 text-slate-950" /> Regenerate Keys
                </button>
                <button
                  onClick={handleSignOut}
                  className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 font-medium rounded-xl text-xs transition"
                >
                  Cancel and Sign Out
                </button>
              </div>
            </div>
          </div>
        ) : (
          <ChatLayout
            currentUser={currentUser}
            myRSAPublicKeyB64={myRSAPublicKeyB64}
            myRSAPrivateKey={myRSAPrivateKey}
            onSignOut={handleSignOut}
            onRegenerateKeys={() => triggerKeyRegeneration(currentUser)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
