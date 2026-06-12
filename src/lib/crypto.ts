/**
 * End-To-End Encryption (E2EE) Module using the Browser's Native Web Crypto API.
 * Uses RSA-OAEP (2048-bit, SHA-256) for asymmetric key distribution (exchanging symmetric group keys).
 * Uses AES-GCM (256-bit keys, 96-bit randomized IV) for highly performant, authenticated symmetric payload encryption.
 */

// Helper: Convert ArrayBuffer to Base64 String
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Helper: Convert Base64 String to ArrayBuffer
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// Helper: String to ArrayBuffer (UTF-8)
export function stringToArrayBuffer(str: string): ArrayBuffer {
  const encoder = new TextEncoder();
  return encoder.encode(str).buffer;
}

// Helper: ArrayBuffer to String (UTF-8)
export function arrayBufferToString(buffer: ArrayBuffer): string {
  const decoder = new TextDecoder();
  return decoder.decode(new Uint8Array(buffer));
}

/**
 * 1. Generate RSA Key Pair for a user.
 * Public key is shared in Firestore. Private key is saved locally.
 */
export async function generateRSAKeyPair(): Promise<CryptoKeyPair> {
  return window.crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true, // Extractable keys
    ["encrypt", "decrypt"]
  );
}

/**
 * 2. Export RSA Public Key to SPKI Base64 format for publication to firestore.
 */
export async function exportRSAPublicKey(publicKey: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey("spki", publicKey);
  return arrayBufferToBase64(exported);
}

/**
 * 3. Export RSA Private Key to PKCS#8 Base64 format (only used for local backup/export).
 */
export async function exportRSAPrivateKey(privateKey: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey("pkcs8", privateKey);
  return arrayBufferToBase64(exported);
}

/**
 * 4. Import RSA Public Key from Base64 SPKI format.
 */
export async function importRSAPublicKey(base64Key: string): Promise<CryptoKey> {
  const buffer = base64ToArrayBuffer(base64Key);
  return window.crypto.subtle.importKey(
    "spki",
    buffer,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["encrypt"]
  );
}

/**
 * 5. Import RSA Private Key from Base64 PKCS#8 format.
 */
export async function importRSAPrivateKey(base64Key: string): Promise<CryptoKey> {
  const buffer = base64ToArrayBuffer(base64Key);
  return window.crypto.subtle.importKey(
    "pkcs8",
    buffer,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["decrypt"]
  );
}

/**
 * 6. Generate a random AES-GCM 256-bit symmetric key for a conversation channel.
 */
export async function generateRoomAESKey(): Promise<CryptoKey> {
  return window.crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"]
  );
}

/**
 * 7. Export AES symmetric key to raw Base64.
 */
export async function exportAESKey(aesKey: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey("raw", aesKey);
  return arrayBufferToBase64(exported);
}

/**
 * 8. Import AES symmetric key from raw Base64.
 */
export async function importAESKey(base64Key: string): Promise<CryptoKey> {
  const buffer = base64ToArrayBuffer(base64Key);
  return window.crypto.subtle.importKey(
    "raw",
    buffer,
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"]
  );
}

/**
 * 9. Encrypt a Room's AES key for a specific member using their RSA public key.
 */
export async function encryptAESKeyForMember(
  memberRSAPublicKeyB64: string,
  roomAESKey: CryptoKey
): Promise<string> {
  const pubKey = await importRSAPublicKey(memberRSAPublicKeyB64);
  const rawAESBytes = await window.crypto.subtle.exportKey("raw", roomAESKey);
  const encryptedBytes = await window.crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    pubKey,
    rawAESBytes
  );
  return arrayBufferToBase64(encryptedBytes);
}

/**
 * 10. Decrypt the Room's AES key using the user's private RSA key.
 */
export async function decryptRoomAESKey(
  userRSAPrivateKey: CryptoKey,
  encryptedRoomKeyB64: string
): Promise<CryptoKey> {
  const encryptedBytes = base64ToArrayBuffer(encryptedRoomKeyB64);
  const rawAESBytes = await window.crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    userRSAPrivateKey,
    encryptedBytes
  );
  return window.crypto.subtle.importKey(
    "raw",
    rawAESBytes,
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"]
  );
}

/**
 * 11. Encrypt text payload with AES-GCM.
 * Generates an ivory (IV), encrypts, and returns both as Base64.
 */
export async function encryptMessageText(
  aesKey: CryptoKey,
  plainText: string
): Promise<{ encryptedText: string; iv: string }> {
  const textBytes = stringToArrayBuffer(plainText);
  // AES-GCM recommends a 96-bit (12 bytes) IV
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  const encryptedBytes = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    aesKey,
    textBytes
  );

  return {
    encryptedText: arrayBufferToBase64(encryptedBytes),
    iv: arrayBufferToBase64(iv.buffer),
  };
}

/**
 * 12. Decrypt ciphertext payload with AES-GCM and the supplied IV.
 */
export async function decryptMessageText(
  aesKey: CryptoKey,
  encryptedTextB64: string,
  ivB64: string
): Promise<string> {
  const ciphertextBytes = base64ToArrayBuffer(encryptedTextB64);
  const ivBytes = new Uint8Array(base64ToArrayBuffer(ivB64));

  const decryptedBytes = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: ivBytes,
    },
    aesKey,
    ciphertextBytes
  );

  return arrayBufferToString(decryptedBytes);
}

/**
 * 13. IndexedDB Key Storage for persistent RSA private keys.
 * This ensures the private key never leaves the sandboxed local storage,
 * and recovers key pairs across page refreshes.
 */
const DB_NAME = "realtime_encrypted_chat_keys";
const STORE_NAME = "keys";

export function savePrivateKeysIndexedDB(userId: string, privateKey: CryptoKey, publicKeyB64: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (e: any) => {
      const db = e.target.result;
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({ privateKey, publicKeyB64 }, userId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

export function loadPrivateKeysIndexedDB(userId: string): Promise<{ privateKey: CryptoKey; publicKeyB64: string } | null> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (e: any) => {
      const db = e.target.result;
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(userId);
      getReq.onsuccess = () => {
        resolve(getReq.result || null);
      };
      getReq.onerror = () => reject(getReq.error);
    };
    request.onerror = () => reject(request.error);
  });
}
