import React, { useState } from "react";
import { Key, Shield, Info, Clipboard, Eye, EyeOff, Lock, Unlock, Cpu, X } from "lucide-react";

interface KeyVisualizerProps {
  userRSAPrivateKey: CryptoKey | null;
  userRSAPublicKeyB64: string | null;
  activeRoomId: string | null;
  activeRoomName: string;
  roomAESKeyB64: string | null;
  onClose?: () => void;
}

export default function KeyVisualizer({
  userRSAPrivateKey,
  userRSAPublicKeyB64,
  activeRoomId,
  activeRoomName,
  roomAESKeyB64,
  onClose,
}: KeyVisualizerProps) {
  const [showRoomKey, setShowRoomKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(label);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Generate fingerprint (hash-like abbreviation)
  const getFingerprint = (b64: string | null) => {
    if (!b64) return "Not generated";
    return b64.slice(0, 16) + "..." + b64.slice(-16);
  };

  return (
    <div className="bg-[#09090b] border-l border-zinc-800/50 text-zinc-300 w-full max-w-xs md:max-w-none md:w-80 max-h-full overflow-y-auto flex flex-col p-4 shadow-2xl h-full font-sans fixed md:static inset-y-0 right-0 z-40 transition-all" id="key-visualizer">
      {/* Visualizer Title */}
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-zinc-800/50" id="visualizer-header">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981]"></div>
          <Shield className="w-4 h-4 text-emerald-400 animate-pulse" />
          <h3 className="font-bold text-white tracking-widest text-xs uppercase font-mono">CRYPTOGRAPHY INSPECT</h3>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors"
            title="Close crypto inspector"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="space-y-5 text-xs flex-1" id="visualizer-content">
        {/* User Keys Card */}
        <div className="bg-[#050507]/60 p-4 rounded-2xl border border-zinc-800/50 hover:border-emerald-500/20 transition-all space-y-3" id="user-keys">
          <div className="flex items-center gap-2 text-white font-bold tracking-wider uppercase text-[10px] font-mono">
            <Cpu className="w-3.5 h-3.5 text-emerald-400" />
            <span>RSA-OAEP Keypair</span>
          </div>
          <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
            Asymmetric 2048-bit keys. Public key registered in Firestore, Private key sealed locally in IndexedDB.
          </p>

          <div className="space-y-3.5">
            <div>
              <span className="text-[10px] text-zinc-500 block uppercase tracking-wider font-mono">Public Key (Base64)</span>
              <div className="flex items-center gap-2 bg-[#050507] px-2.5 py-1.5 rounded-xl mt-1 font-mono text-[10px] truncate justify-between border border-zinc-800/60">
                <span className="text-emerald-400 font-medium truncate">{getFingerprint(userRSAPublicKeyB64)}</span>
                {userRSAPublicKeyB64 && (
                  <button
                    onClick={() => copyToClipboard(userRSAPublicKeyB64, "rsa-pub")}
                    className="p-1.5 hover:bg-zinc-800 rounded-lg transition text-zinc-400 hover:text-white"
                    title="Copy Public Key"
                  >
                    <Clipboard className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div>
              <span className="text-[10px] text-zinc-500 block uppercase tracking-wider font-mono">Private Key Status</span>
              <div className="flex items-center gap-2 bg-[#050507] px-2.5 py-1.5 rounded-xl mt-1 font-mono text-[10px] justify-between border border-zinc-800/60">
                {userRSAPrivateKey ? (
                  <span className="text-emerald-400 flex items-center gap-1.5 font-bold font-sans">
                    <Lock className="w-3.5 h-3.5 text-emerald-400" /> SEALED (Local Sandbox Only)
                  </span>
                ) : (
                  <span className="text-amber-500 font-bold font-sans">⚠️ MISSING (Regen Needed)</span>
                )}
              </div>
            </div>
          </div>
          {copiedKey === "rsa-pub" && <span className="text-[10px] text-emerald-400 mt-1 block font-mono">Copied Public Key!</span>}
        </div>

        {/* Room Symmetric Key Card */}
        <div className="bg-[#050507]/60 p-4 rounded-2xl border border-zinc-800/50 space-y-3" id="room-keys">
          <div className="flex items-center gap-2 text-white font-bold tracking-wider uppercase text-[10px] font-mono">
            <Key className="w-3.5 h-3.5 text-emerald-400" />
            <span>AES Channel Tunnel Key</span>
          </div>
          {activeRoomId ? (
            <>
              <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                Active tunnel: <strong className="text-emerald-400 font-mono">#{activeRoomName}</strong>
              </p>
              <p className="text-[11px] text-zinc-400 leading-relaxed font-sans font-normal">
                Symmetric 256-bit AES-GCM key. All payloads inside this room are locally sealed with this key.
              </p>

              <div>
                <span className="text-[10px] text-zinc-500 block uppercase tracking-wider font-mono">Symmetric Key</span>
                <div className="flex items-center gap-2 bg-[#050507] px-2.5 py-1.5 rounded-xl mt-1 font-mono text-[10px] justify-between border border-zinc-800/60">
                  <span className="truncate text-emerald-400 font-medium">
                    {roomAESKeyB64 ? (showRoomKey ? roomAESKeyB64 : "••••••••••••••••••••••••••••••••") : "Not shared with you"}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setShowRoomKey(!showRoomKey)}
                      className="p-1 hover:bg-zinc-800 rounded transition text-zinc-400 hover:text-white"
                      title={showRoomKey ? "Hide key" : "Show key"}
                    >
                      {showRoomKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    {roomAESKeyB64 && (
                      <button
                        onClick={() => copyToClipboard(roomAESKeyB64, "aes")}
                        className="p-1.5 hover:bg-zinc-800 rounded-lg transition text-zinc-400 hover:text-white"
                        title="Copy Key"
                      >
                        <Clipboard className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {copiedKey === "aes" && <span className="text-[10px] text-emerald-400 mt-1 block font-mono">Copied AES Key!</span>}
            </>
          ) : (
            <div className="text-zinc-500 text-center py-6 bg-[#050507] rounded-xl border border-zinc-800/50 font-mono text-[11px] tracking-tight">
              SELECT OR CREATE AN ENCRYPTED CHAT TO INSPECT WORKFLOW
            </div>
          )}
        </div>

        {/* Cryptographic Workflow Flowchart */}
        <div className="bg-[#050507]/40 p-4 rounded-2xl border border-zinc-800/50 space-y-4" id="crypto-workflow">
          <div className="flex items-center gap-1.5 text-white font-bold tracking-wider uppercase text-[10px] font-mono">
            <Info className="w-3.5 h-3.5 text-emerald-400" />
            <span>Double Ratchet Workflow</span>
          </div>

          <div className="space-y-4 font-mono text-[10px] text-zinc-400 relative pl-3" id="workflow-steps">
            {/* Thread Line */}
            <div className="absolute left-1.5 top-1 bottom-1.5 w-[1px] bg-zinc-800/80"></div>

            <div className="relative">
              <div className="absolute -left-[14px] top-1 w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981]"></div>
              <strong className="text-white text-[11px] block tracking-wider">1. KEY EXCHANGE</strong>
              <span className="text-zinc-400 leading-normal block mt-1">Symmetric key generated on client, sealed using everyone's unique local RSA public key & stored under member records.</span>
            </div>

            <div className="relative">
              <div className="absolute -left-[14px] top-1 w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981]"></div>
              <strong className="text-white text-[11px] block tracking-wider">2. TRANSMISSION</strong>
              <span className="text-zinc-400 leading-normal block mt-1">Payload text encrypted locally with AES-256-GCM. Transmitted to Firestore as ciphertext with random initialization vectors.</span>
            </div>

            <div className="relative">
              <div className="absolute -left-[14px] top-1 w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981]"></div>
              <strong className="text-white text-[11px] block tracking-wider">3. REALTIME RECOVERY</strong>
              <span className="text-zinc-400 leading-normal block mt-1">Local client downloads AES bundle, unlocks it with secure browser private key, and decrypts ciphertext instantly in memory.</span>
            </div>
          </div>
        </div>
      </div>

      <div className="pt-3.5 border-t border-zinc-800/50 mt-4 text-[10px] text-zinc-500 text-center flex items-center justify-center gap-1 font-mono tracking-wider uppercase">
        <Unlock className="w-3.5 h-3.5 text-emerald-400" />
        <span>E2EE ACTIVE • AES-256 + RSA-2048</span>
      </div>
    </div>
  );
}
