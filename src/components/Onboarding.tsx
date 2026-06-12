import React, { useState } from "react";
import { signInWithPopup } from "firebase/auth";
import { auth, googleProvider } from "../lib/firebase";
import { Shield, Key, Lock, Zap, Music, Bell, Loader2 } from "lucide-react";
import { motion } from "motion/react";

interface OnboardingProps {
  onSignInSuccess: () => void;
}

export default function Onboarding({ onSignInSuccess }: OnboardingProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
      onSignInSuccess();
    } catch (err: any) {
      console.error("Auth popup login failed:", err);
      setError(
        err?.message?.includes("popup-closed-by-user")
          ? "Login request cancelled. Please click the button to try again."
          : "Could not authenticate your Google Account. Please confirm browser popup permissions."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050507] text-[#f4f4f5] flex flex-col items-center justify-center p-4 selection:bg-[#10b981] selection:text-[#09090b]" id="onboarding-page">
      {/* Immersive Top Center Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-[#10b981]/10 blur-[100px] pointer-events-none"></div>

      {/* Decorative Grid Background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f1f2e_1px,transparent_1px),linear-gradient(to_bottom,#1f1f2e_1px,transparent_1px)] bg-[size:5rem_5rem] opacity-15 pointer-events-none"></div>

      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-xl w-full text-center relative z-10 space-y-8"
        id="onboarding-card"
      >
        {/* App Title Header */}
        <div className="space-y-4" id="app-branding">
          <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 text-xs font-mono mb-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981] animate-pulse"></div>
            <span>SECURE VAULT CHANNEL SYSTEM</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight leading-none uppercase">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-400 to-emerald-400 font-mono">CYPHER</span>
          </h1>
          <p className="text-zinc-400 text-xs md:text-sm max-w-md mx-auto leading-relaxed">
            Unbreakable, zero-trust cryptographic messaging powered by client-side Web Crypto and real-time Firestore synchronization.
          </p>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left" id="onboarding-features">
          <div className="bg-[#09090b]/80 backdrop-blur-md p-5 rounded-2xl border border-zinc-800/60 hover:border-emerald-500/30 transition-all space-y-2">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                <Lock className="w-4 h-4" />
              </div>
              <h3 className="font-bold text-zinc-150 text-xs uppercase tracking-wider font-mono">E2EE Cryptography</h3>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed font-sans">
              RSA-OAEP 2048-bit keys exchange a randomized AES-GCM 256-bit chat key. All encryption operates directly inside your local browser.
            </p>
          </div>

          <div className="bg-[#09090b]/80 backdrop-blur-md p-5 rounded-2xl border border-zinc-800/60 hover:border-emerald-500/30 transition-all space-y-2">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                <Zap className="w-4 h-4" />
              </div>
              <h3 className="font-bold text-zinc-150 text-xs uppercase tracking-wider font-mono">Real-Time Sync</h3>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed font-sans">
              Direct Firestore snapshots sync documents instantly. Typing indicators and online badges operate reactively with zero lag.
            </p>
          </div>

          <div className="bg-[#09090b]/80 backdrop-blur-md p-5 rounded-2xl border border-zinc-800/60 hover:border-emerald-500/30 transition-all space-y-2">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                <Shield className="w-4 h-4" />
              </div>
              <h3 className="font-bold text-zinc-150 text-xs uppercase tracking-wider font-mono">Zero Knowledge</h3>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed font-sans">
              Your private keys never leave your machine (stored in IndexedDB). Neither database administrators nor external brokers can read your text.
            </p>
          </div>

          <div className="bg-[#09090b]/80 backdrop-blur-md p-5 rounded-2xl border border-zinc-800/60 hover:border-emerald-500/30 transition-all space-y-2">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                <Bell className="w-4 h-4" />
              </div>
              <h3 className="font-bold text-zinc-150 text-xs uppercase tracking-wider font-mono">Instant Alerts</h3>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed font-sans">
              Features synthesized double-tap audio chiming using native Web Audio and browser HTML5 notifications for background alerts.
            </p>
          </div>
        </div>

        {/* Action button section */}
        <div className="pt-2 space-y-4" id="onboarding-action">
          {error && (
            <div className="p-3 bg-red-950/40 border border-red-500/20 rounded-xl text-xs text-red-350 max-w-md mx-auto font-mono">
              {error}
            </div>
          )}

          <button
            disabled={loading}
            onClick={handleLogin}
            className="group relative inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-full font-bold text-black bg-emerald-500 hover:bg-emerald-400 transition-all duration-300 shadow-[0_0_20px_rgba(16,185,129,0.35)] disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.01] text-xs uppercase tracking-wider font-mono"
            id="google-login-btn"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-black" />
                <span>Authorizing Account...</span>
              </>
            ) : (
              <>
                <Key className="w-4 h-4 animate-pulse group-hover:rotate-12 transition-transform text-black" />
                <span>Initialize Secure Session</span>
              </>
            )}
          </button>

          <p className="text-[10px] text-zinc-500 font-mono tracking-wider">
            POWERED BY STANDARD OAUTH WITH GOOGLE SSO • NO REGISTRATION REQUIRED
          </p>
        </div>
      </motion.div>
    </div>
  );
}

