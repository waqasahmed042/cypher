export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  publicKey: string; // Base64 RSA OAEP public key
  createdAt: string;
  updatedAt?: string;
}

export interface ChatRoom {
  roomId: string;
  name: string; // Dynamic for group, or individual peer screen name for direct
  type: "direct" | "group";
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
}

export interface RoomMember {
  userId: string;
  displayName: string;
  email: string;
  photoURL: string;
  encryptedRoomKey: string; // Symmetric AES key of the room, encrypted with this user's public RSA key (Base64)
  joinedAt: string;
}

export interface ChatMessage {
  messageId: string;
  senderId: string;
  senderName: string;
  senderPhotoURL: string;
  encryptedText: string; // AES-GCM encrypted payload (Base64)
  iv: string; // AES IV (Base64)
  createdAt: any; // Firestore Timestamp
  decryptedText?: string; // Resolved client-side dynamically, never uploaded to server
  isDecryptionFailed?: boolean;
}

export interface UserPresence {
  userId: string;
  isTyping: boolean;
  lastActive: string; // ISO string or timestamp
}

export interface UserStatus {
  uid: string;
  isOnline: boolean;
  lastActive: string;
}
