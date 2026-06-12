import React, { useState, useEffect, useRef } from "react";
import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  query,
  orderBy,
  limit,
  onSnapshot,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { signOut, User } from "firebase/auth";
import { db, auth, handleFirestoreError, OperationType } from "../lib/firebase";
import {
  generateRoomAESKey,
  encryptAESKeyForMember,
  decryptRoomAESKey,
  encryptMessageText,
  decryptMessageText,
} from "../lib/crypto";
import {
  playIncomingMessageSound,
  showPushNotification,
  requestNotificationPermission,
} from "../lib/notifications";
import { ChatRoom, ChatMessage, RoomMember, UserProfile } from "../types";
import KeyVisualizer from "./KeyVisualizer";
import {
  Lock,
  Unlock,
  Plus,
  LogOut,
  Users,
  Send,
  Shield,
  MessageSquare,
  Key,
  CheckCheck,
  Circle,
  Hash,
  PanelRight,
  UserCheck,
  Search,
  Check,
  AlertTriangle,
  Download,
  Terminal,
  ArrowLeft,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface ChatLayoutProps {
  currentUser: User;
  myRSAPrivateKey: CryptoKey | null;
  myRSAPublicKeyB64: string | null;
  onSignOut: () => void;
  onRegenerateKeys: () => Promise<void>;
}

export default function ChatLayout({
  currentUser,
  myRSAPrivateKey,
  myRSAPublicKeyB64,
  onSignOut,
  onRegenerateKeys,
}: ChatLayoutProps) {
  // Navigation / UI States
  const [rooms, setRooms] = useState<any[]>([]);
  const [activeRoom, setActiveRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [availableUsers, setAvailableUsers] = useState<UserProfile[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  
  // Create Room modal & search state
  const [isNewRoomOpen, setIsNewRoomOpen] = useState(false);
  const [roomNameInput, setRoomNameInput] = useState("");
  const [roomType, setRoomType] = useState<"direct" | "group">("direct");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  
  const [isVisualizerOpen, setIsVisualizerOpen] = useState(true);
  const [messageText, setMessageText] = useState("");
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);

  // Cryptographic Cache
  // Store symmetric AES keys decrypted during this session to avoid continuous RSA operation lag
  const [roomAESKeys, setRoomAESKeys] = useState<{ [roomId: string]: { key: CryptoKey; b64: string } }>({});
  const [myMembership, setMyMembership] = useState<RoomMember | null>(null);

  // Layout scrolling references
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Back up Key state
  const [isExportingKeys, setIsExportingKeys] = useState(false);
  const [exportedPrivateKeyB64, setExportedPrivateKeyB64] = useState<string | null>(null);

  // Trigger permission requests
  useEffect(() => {
    requestNotificationPermission();
  }, []);

  // 1. Subscribe to User's Joined Rooms
  useEffect(() => {
    const inboxPath = `users/${currentUser.uid}/joinedRooms`;
    const unsubscribe = onSnapshot(
      collection(db, inboxPath),
      (snapshot) => {
        const roomsList: any[] = [];
        snapshot.forEach((docSnap) => {
          roomsList.push(docSnap.data());
        });
        // Sort rooms by descending creation/join time
        roomsList.sort((a, b) => {
          const tA = a.joinedAt?.seconds ? a.joinedAt.seconds : 0;
          const tB = b.joinedAt?.seconds ? b.joinedAt.seconds : 0;
          return tB - tA;
        });
        setRooms(roomsList);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, inboxPath);
      }
    );

    return () => unsubscribe();
  }, [currentUser.uid]);

  // 2. Fetch Signed-Up Users for Room Dialog
  useEffect(() => {
    const fetchUsers = async () => {
      const usersPath = "users";
      try {
        const querySnapshot = await getDocs(collection(db, usersPath));
        const usersList: UserProfile[] = [];
        querySnapshot.forEach((docSnap) => {
          const data = docSnap.data() as UserProfile;
          if (data.uid !== currentUser.uid) {
            usersList.push(data);
          }
        });
        setAvailableUsers(usersList);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, usersPath);
      }
    };
    if (isNewRoomOpen) {
      fetchUsers();
    }
  }, [isNewRoomOpen, currentUser.uid]);

  // 3. Setup and Sync Symmetric Key for Selected Room
  useEffect(() => {
    if (!activeRoom || !myRSAPrivateKey) {
      setMyMembership(null);
      return;
    }

    const membershipDocPath = `rooms/${activeRoom.roomId}/members/${currentUser.uid}`;
    
    // Check if the AES key is already cached in session state
    if (roomAESKeys[activeRoom.roomId]) {
      // Key exists in cache, but let's still recover user profile info
      getDoc(doc(db, membershipDocPath)).then((snap) => {
        if (snap.exists()) {
          setMyMembership(snap.data() as RoomMember);
        }
      });
      return;
    }

    const fetchAndDecryptSymmetricKey = async () => {
      try {
        const memberSnap = await getDoc(doc(db, membershipDocPath));
        if (memberSnap.exists()) {
          const memberData = memberSnap.data() as RoomMember;
          setMyMembership(memberData);

          // Decrypt the room symmetric AES key using our RSA Private Key
          const aesKeyObj = await decryptRoomAESKey(myRSAPrivateKey, memberData.encryptedRoomKey);
          
          // Export back to base64 solely for visualization/transparency
          const rawAESB64 = await window.crypto.subtle.exportKey("raw", aesKeyObj);
          const aesKeyB64 = window.btoa(String.fromCharCode(...new Uint8Array(rawAESB64)));

          setRoomAESKeys((prev) => ({
            ...prev,
            [activeRoom.roomId]: { key: aesKeyObj, b64: aesKeyB64 },
          }));
        } else {
          console.warn("User is not enrolled in room members hierarchy in Firestore.");
        }
      } catch (err) {
        console.error("Failed to decrypt symmetric room session key:", err);
      }
    };

    fetchAndDecryptSymmetricKey();
  }, [activeRoom, myRSAPrivateKey, currentUser.uid, roomAESKeys]);

  // 4. Synchronize Messages for Active Room
  useEffect(() => {
    if (!activeRoom) {
      setMessages([]);
      return;
    }

    const messagesPath = `rooms/${activeRoom.roomId}/messages`;
    const messagesQuery = query(collection(db, messagesPath), orderBy("createdAt", "asc"), limit(100));

    const unsubscribe = onSnapshot(
      messagesQuery,
      async (snapshot) => {
        const rawMessages: ChatMessage[] = [];
        snapshot.forEach((docSnap) => {
          rawMessages.push(docSnap.data() as ChatMessage);
        });

        // Decrypt messages on the fly using our cached/decrypted Active Room key
        const decryptedList = await Promise.all(
          rawMessages.map(async (msg) => {
            // If sender is us, or text is decrypted
            const activeAESKey = roomAESKeys[activeRoom.roomId]?.key;
            if (!activeAESKey) {
              return { ...msg, decryptedText: "[Key Decryption Pending]", isDecryptionFailed: true };
            }

            try {
              const plain = await decryptMessageText(activeAESKey, msg.encryptedText, msg.iv);
              return { ...msg, decryptedText: plain, isDecryptionFailed: false };
            } catch (err) {
              console.error("AES Decryption trigger failed for msg ID:", msg.messageId, err);
              return { ...msg, decryptedText: "[🔓 Decryption Failed: Session Keys Mismatch]", isDecryptionFailed: true };
            }
          })
        );

        // Alert player on new incoming messages
        if (decryptedList.length > messages.length && messages.length > 0) {
          const latest = decryptedList[decryptedList.length - 1];
          if (latest.senderId !== currentUser.uid) {
            playIncomingMessageSound();
            showPushNotification(latest.senderName, latest.decryptedText || "Encrypted payload received");
          }
        }

        setMessages(decryptedList);
        setTimeout(() => scrollToBottom(), 100);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, messagesPath);
      }
    );

    return () => unsubscribe();
  }, [activeRoom, roomAESKeys, currentUser.uid, messages.length]);

  // 5. Typing and Presence Watcher
  useEffect(() => {
    if (!activeRoom) return;

    const presencePath = `rooms/${activeRoom.roomId}/presence`;
    const unsubscribe = onSnapshot(
      collection(db, presencePath),
      (snapshot) => {
        const activeTyping: string[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          if (data.userId !== currentUser.uid && data.isTyping === true) {
            // Find participant's display name
            activeTyping.push(data.displayName || "Someone");
          }
        });
        setTypingUsers(activeTyping);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, presencePath);
      }
    );

    return () => unsubscribe();
  }, [activeRoom, currentUser.uid]);

  // Debounced typing indicator trigger
  const typingTimerRef = useRef<any>(null);
  const handleMessageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessageText(e.target.value);

    if (!activeRoom) return;

    // Trigger typing inside Firestore
    const typingDoc = doc(db, `rooms/${activeRoom.roomId}/presence/${currentUser.uid}`);
    setDoc(typingDoc, {
      userId: currentUser.uid,
      displayName: currentUser.displayName || "User",
      isTyping: true,
      lastActive: new Date().toISOString(),
    }, { merge: true }).catch((err) => console.log(err));

    // Clear old timers
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);

    typingTimerRef.current = setTimeout(() => {
      // Reset typing state
      setDoc(typingDoc, {
        isTyping: false,
      }, { merge: true }).catch((err) => console.log(err));
    }, 2000);
  };

  // Scroll to message window base
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // 6. Create E2EE Conversation Channel
  const handleCreateRoom = async () => {
    if (roomType === "group" && !roomNameInput.trim()) {
      alert("Please provide a name for the group chat room.");
      return;
    }
    if (selectedUserIds.length === 0) {
      alert("Please select at least one recipient to initialize the E2EE channel with.");
      return;
    }

    setIsCreatingRoom(true);
    const roomId = "room_" + Math.random().toString(36).substring(2, 11);

    try {
      // A. Generate a fresh symmetric key for this room
      const aesKey = await generateRoomAESKey();
      const rawAESB64 = await window.crypto.subtle.exportKey("raw", aesKey);
      const aesKeyB64 = window.btoa(String.fromCharCode(...new Uint8Array(rawAESB64)));

      // Collect all selected users profiles including current user
      const membersToCreate: any[] = [];
      const recipientIds = [...selectedUserIds, currentUser.uid];

      // Retrieve public Keys from Selected user profiles
      // Current User info
      membersToCreate.push({
        userId: currentUser.uid,
        displayName: currentUser.displayName || "User",
        email: currentUser.email || "",
        photoURL: currentUser.photoURL || "",
        publicKey: myRSAPublicKeyB64,
      });

      // Fetch keys for peers from availableUsers list
      for (const peerId of selectedUserIds) {
        const peerProfile = availableUsers.find((u) => u.uid === peerId);
        if (peerProfile) {
          membersToCreate.push(peerProfile);
        }
      }

      // Check all members have RSA keys
      const invalidMembers = membersToCreate.filter((m) => !m.publicKey);
      if (invalidMembers.length > 0) {
        alert(
          `Recipient ${invalidMembers[0].displayName} has not generated a secure key session yet. They must log in once to complete key installation.`
        );
        setIsCreatingRoom(false);
        return;
      }

      // B. Encrypt the same AES key for EVERY participant using their unique RSA Public Key
      const encryptedKeyMap: { [userId: string]: string } = {};
      for (const member of membersToCreate) {
        const encBytes = await encryptAESKeyForMember(member.publicKey, aesKey);
        encryptedKeyMap[member.userId] = encBytes;
      }

      // C. Submit atomic batch document creations to Firestore
      const batch = writeBatch(db);

      // Create main Room document
      const resolvedRoomName =
        roomType === "direct"
          ? membersToCreate.find((m) => m.userId !== currentUser.uid)?.displayName || "Private Chat"
          : roomNameInput.trim();

      const newRoomMeta = {
        roomId,
        name: resolvedRoomName,
        type: roomType,
        createdBy: currentUser.uid,
        createdAt: new Date().toISOString(), // Use client backup strings or parse timestamp later
      };

      batch.set(doc(db, `rooms/${roomId}`), newRoomMeta);

      // Create Member records & User Inbox links
      membersToCreate.forEach((m) => {
        const memberRef = doc(db, `rooms/${roomId}/members/${m.userId}`);
        const memberRecord = {
          userId: m.userId,
          displayName: m.displayName,
          email: m.email,
          photoURL: m.photoURL,
          encryptedRoomKey: encryptedKeyMap[m.userId],
          joinedAt: new Date().toISOString(),
        };
        batch.set(memberRef, memberRecord);

        // Store active room mapping details in each individual's joinedRooms array index for rapid home sync
        const userInboxRef = doc(db, `users/${m.userId}/joinedRooms/${roomId}`);
        const inboxRecord = {
          roomId,
          name: roomType === "direct" ? membersToCreate.find((x) => x.userId !== m.userId)?.displayName || "Direct Chat" : resolvedRoomName,
          type: roomType,
          joinedAt: new Date().toISOString(),
        };
        batch.set(userInboxRef, inboxRecord);
      });

      await batch.commit();

      // Cache decrypted key locally
      setRoomAESKeys((prev) => ({
        ...prev,
        [roomId]: { key: aesKey, b64: aesKeyB64 },
      }));

      // Set active
      setActiveRoom(newRoomMeta as ChatRoom);
      
      // Cleanup Modal State
      setIsNewRoomOpen(false);
      setRoomNameInput("");
      setSelectedUserIds([]);
    } catch (err) {
      console.error("Critical error building encrypted group:", err);
      alert("Failed to build E2EE room. Details: " + String(err));
    } finally {
      setIsCreatingRoom(false);
    }
  };

  // 7. Send End-to-End Encrypted Message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim() || !activeRoom) return;

    // Retrieve decrypted AES key for active room from our session Cache
    const activeAESKeyObj = roomAESKeys[activeRoom.roomId]?.key;
    if (!activeAESKeyObj) {
      alert("Your E2EE key for this room has not loaded or decrypted yet. Please check connection.");
      return;
    }

    const payloadText = messageText.trim();
    setMessageText("");

    try {
      // Clear active typing indicator right away
      const typingDoc = doc(db, `rooms/${activeRoom.roomId}/presence/${currentUser.uid}`);
      setDoc(typingDoc, { isTyping: false }, { merge: true }).catch(() => {});

      // A. Encrypt plain text locally with AES-GCM-256
      const { encryptedText, iv } = await encryptMessageText(activeAESKeyObj, payloadText);

      // B. Hand ciphertext to Firestore subcollection
      const messageId = "msg_" + Math.random().toString(36).substring(2, 11);
      const msgData = {
        messageId,
        senderId: currentUser.uid,
        senderName: currentUser.displayName || "User",
        senderPhotoURL: currentUser.photoURL || "",
        encryptedText,
        iv,
        createdAt: serverTimestamp(),
      };

      await setDoc(doc(db, `rooms/${activeRoom.roomId}/messages/${messageId}`), msgData);
    } catch (err) {
      console.error("Failed to encrypt and transmit message:", err);
      alert("Error transmitting payload: Encryption error.");
    }
  };

  // Export private key for backup
  const exportLocalPrivateKey = async () => {
    if (!myRSAPrivateKey) return;
    setIsExportingKeys(true);
    try {
      const exportedB64 = await window.crypto.subtle.exportKey("pkcs8", myRSAPrivateKey);
      const b64Str = window.btoa(String.fromCharCode(...new Uint8Array(exportedB64)));
      setExportedPrivateKeyB64(b64Str);
    } catch (err) {
      alert("Could not export key: " + String(err));
    }
  };

  // Logged-in profile fingerprint
  const myPublicFingerprint = myRSAPublicKeyB64
    ? myRSAPublicKeyB64.slice(0, 10) + "..." + myRSAPublicKeyB64.slice(-10)
    : "Not Generated";

  // Filter available users for search query
  const filteredUsers = availableUsers.filter(
    (u) =>
      u.displayName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-screen w-screen bg-[#050507] text-[#f4f4f5] overflow-hidden font-sans" id="chat-dashboard text-sm">
      
      {/* 1. Sidebar Panel (Left) */}
      <div className={`w-full md:w-72 border-r border-zinc-800/50 flex flex-col bg-[#09090b] h-full select-none ${activeRoom ? "hidden md:flex" : "flex"}`} id="sidebar-panel">
        
        {/* Brand Header */}
        <div className="p-6 border-b border-zinc-800/50 flex items-center justify-between" id="sidebar-branding">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
              <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981] animate-pulse"></div>
            </div>
            <h1 className="font-mono font-black tracking-widest text-[#f4f4f5] text-sm">CYPHER</h1>
          </div>
          <button
            onClick={onSignOut}
            className="p-1.5 hover:bg-zinc-800/60 rounded-lg text-zinc-400 hover:text-white transition-colors cursor-pointer"
            title="Sign Out Session"
            id="btn-signout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        {/* User Identity / Active Operator Panel */}
        <div className="p-4 border-b border-zinc-800/50 flex flex-col gap-2.5 bg-zinc-900/10" id="profile-banner">
          <div className="flex items-center gap-2.5">
            <img
              src={currentUser.photoURL || "https://api.dicebear.com/7.x/bottts/svg?seed=" + currentUser.uid}
              alt="Avatar"
              className="w-8 h-8 rounded-full border border-emerald-500/25 object-cover bg-zinc-900 referrer-policy-no-referrer"
              referrerPolicy="no-referrer"
            />
            <div className="flex flex-col text-left min-w-0">
              <span className="font-bold text-zinc-200 tracking-tight text-xs truncate">
                {currentUser.displayName || "Secure Agent"}
              </span>
              <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-mono">
                Operator Online
              </span>
            </div>
          </div>

          {/* RSA Key status bar */}
          <div className="bg-[#050507] px-2.5 py-1.5 rounded-xl border border-zinc-800/60 flex items-center justify-between text-[10px] font-mono">
            <div className="flex items-center gap-1.5 text-zinc-400 truncate">
              <Shield className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="text-zinc-500 shrink-0">KEY:</span>
              <span className="text-emerald-400 font-medium truncate">{myPublicFingerprint}</span>
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(myRSAPublicKeyB64 || "");
                alert("Public key copied to clipboard!");
              }}
              className="px-2 py-0.5 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-emerald-400 transition text-[9px] uppercase font-mono tracking-wider shrink-0"
              title="Copy Full RSA Public Key"
            >
              Copy
            </button>
          </div>
        </div>

        {/* Channels / Rooms list header */}
        <div className="p-4 bg-zinc-900/10 flex items-center justify-between" id="rooms-list-header">
          <span className="text-[10px] uppercase tracking-wider font-bold text-zinc-500 font-mono">Secure Channels</span>
          <button
            onClick={() => setIsNewRoomOpen(true)}
            className="p-1 px-2.5 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-lg transition-all hover:scale-[1.03] flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider"
            id="btn-create-room"
          >
            <Plus className="w-3 h-3 stroke-[3]" />
            New Link
          </button>
        </div>

        {/* Channels list feed */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1 bg-zinc-900/5" id="channels-list">
          {rooms.map((room) => {
            const isSelected = activeRoom?.roomId === room.roomId;
            return (
              <button
                key={room.roomId}
                onClick={() => {
                  setActiveRoom(room);
                }}
                className={`w-full text-left p-3 rounded-2xl transition-all duration-200 flex items-center justify-between border ${
                  isSelected
                    ? "bg-emerald-500/10 border-emerald-500/20 text-[#f4f4f5]"
                    : "bg-transparent border-transparent hover:bg-zinc-900/40 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative shrink-0">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center font-bold text-sm ${
                      isSelected 
                        ? "bg-gradient-to-br from-emerald-500 to-teal-600 text-black shadow-lg shadow-emerald-500/10" 
                        : "bg-zinc-900 border border-zinc-800/80 text-zinc-500 font-sans"
                    }`}>
                      {room.name ? room.name.substring(0, 2).toUpperCase() : "CH"}
                    </div>
                    {isSelected && roomAESKeys[room.roomId] && (
                      <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-[#09090b] flex items-center justify-center">
                        <Check className="w-2.5 h-2.5 text-black stroke-[3]" />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="font-bold text-xs truncate max-w-[120px]">{room.name}</span>
                    <span className="text-[9px] text-zinc-500 font-mono capitalize">{room.type} Tunnel</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {isSelected ? (
                    <span className="text-[10px] text-emerald-400 font-bold font-mono tracking-widest">LIVE</span>
                  ) : (
                    <Lock className="w-3.5 h-3.5 text-zinc-650" />
                  )}
                </div>
              </button>
            );
          })}

          {rooms.length === 0 && (
            <div className="text-center py-8 text-zinc-600 space-y-2 px-4" id="empty-rooms">
              <MessageSquare className="w-5 h-5 mx-auto text-zinc-700 mt-2" />
              <p className="text-[10px] font-mono uppercase tracking-wider">No active secure vaults</p>
            </div>
          )}
        </div>

        {/* Bottom Local Backups Drawer */}
        <div className="p-4 border-t border-zinc-800/50 bg-[#09090b] " id="sidebar-footer">
          <div className="flex gap-2.5">
            <button
              onClick={exportLocalPrivateKey}
              className="flex-1 py-2 px-2.5 bg-zinc-900/50 hover:bg-zinc-800 text-zinc-300 font-mono text-[9px] uppercase tracking-wider rounded-xl border border-zinc-800/60 flex items-center justify-center gap-1.5 transition cursor-pointer"
              title="Securely inspect your private key"
            >
              <Download className="w-3.5 h-3.5" /> Back Up Keys
            </button>
            <button
              onClick={onRegenerateKeys}
              className="py-2 px-2.5 bg-zinc-900/50 hover:bg-zinc-800 text-amber-500 font-mono text-[9px] uppercase tracking-wider rounded-xl border border-zinc-800/60 flex items-center justify-center gap-1.5 transition cursor-pointer"
              title="In case of emergency device reset"
            >
              Reset Keys
            </button>
          </div>
        </div>
      </div>

      {/* 2. Chat Feed Pane (Center) */}
      <div className={`flex-1 flex flex-col bg-[#050507] p-0 relative h-full shrink-0 ${activeRoom ? "flex" : "hidden md:flex"}`} id="chat-stage">
        {activeRoom ? (
          <>
            {/* Immersive Top Center Glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-[#10b981]/10 blur-[100px] pointer-events-none z-0"></div>

            {/* Active Room Header */}
            <header className="h-20 flex items-center justify-between px-4 sm:px-6 bg-[#050507]/80 backdrop-blur-md border-b border-zinc-800/50 z-10" id="chat-header">
              <div className="flex items-center gap-3 sm:gap-4">
                {/* Back Button on Mobile */}
                <button
                  onClick={() => setActiveRoom(null)}
                  className="p-2 hover:bg-zinc-800/60 rounded-xl text-zinc-400 hover:text-white transition-colors cursor-pointer md:hidden"
                  title="Back to vaults list"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex flex-col text-left">
                  <h2 className="text-md font-extrabold text-[#f4f4f5] tracking-tight">{activeRoom.name}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981] animate-pulse"></div>
                    <span className="text-[10px] uppercase font-mono tracking-widest text-zinc-400">
                      {typingUsers.length > 0 
                        ? `${typingUsers.join(", ")} ${typingUsers.length > 1 ? "are" : "is"} typing...`
                        : "End-to-End Encrypted Session"
                      }
                    </span>
                  </div>
                </div>
              </div>

              {/* Header actions */}
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => setIsVisualizerOpen(!isVisualizerOpen)}
                  className={`px-4 py-2 border rounded-full text-[10px] uppercase font-bold font-mono tracking-wider transition cursor-pointer ${
                    isVisualizerOpen
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                      : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                  }`}
                  id="btn-toggle-visualizer"
                >
                  {isVisualizerOpen ? "Hide Inspect" : "Inspect AES/RSA"}
                </button>
              </div>
            </header>

            {/* Messages Scroll Area */}
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 z-10" id="messages-container">
              {messages.map((msg, index) => {
                const isMe = msg.senderId === currentUser.uid;
                const initials = msg.senderName ? msg.senderName.substring(0, 2).toUpperCase() : "SA";
                const time = msg.createdAt?.seconds
                  ? new Date(msg.createdAt.seconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                  : "Syncing";

                if (isMe) {
                  return (
                    <div key={msg.messageId || index} className="flex gap-4 justify-end">
                      <div className="max-w-[70%] flex flex-col items-end">
                        <div className="flex items-baseline gap-2 mb-1.5">
                          <span className="text-[10px] text-zinc-500 uppercase font-mono">{time}</span>
                          <span className="font-bold text-xs text-emerald-400 uppercase font-mono">You</span>
                        </div>
                        <div className="p-4 rounded-2xl rounded-tr-none bg-emerald-500/10 border border-emerald-500/25 text-zinc-100 relative overflow-hidden text-left shadow-lg">
                          <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/5 to-transparent"></div>
                          <p className="whitespace-pre-wrap select-text text-sm leading-relaxed text-zinc-100">{msg.decryptedText || "Sealing message buffer..."}</p>
                          <div className="mt-2.5 flex items-center gap-1.5 text-[9px] text-[#10b981]/80 font-mono uppercase tracking-wider">
                            <CheckCheck className="w-3.5 h-3.5" />
                            <span>Encrypted locally • AES-256</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={msg.messageId || index} className="flex gap-4 justify-start">
                    <div className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-800/80 flex-shrink-0 flex items-center justify-center font-bold text-xs text-zinc-400 font-mono tracking-tight shadow-md">
                      {initials}
                    </div>
                    <div className="max-w-[70%] text-left">
                      <div className="flex items-baseline gap-2 mb-1.5">
                        <span className="font-bold text-xs text-zinc-200">{msg.senderName}</span>
                        <span className="text-[10px] text-zinc-500 uppercase font-mono">{time}</span>
                      </div>
                      <div className="p-4 rounded-2xl rounded-tl-none bg-zinc-900/60 border border-zinc-800/70 text-zinc-350 shadow-md">
                        {msg.isDecryptionFailed ? (
                          <div className="space-y-1 text-red-400 font-mono text-[11px] leading-relaxed">
                            <p className="font-bold uppercase tracking-wider">⚠️ DECRYPTION FAILED</p>
                            <p className="text-zinc-500">Local private key is unable to resolve this signal packet. Refresh session credentials.</p>
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap select-text text-sm leading-relaxed text-zinc-300">{msg.decryptedText || "Decryption pending in local enclave..."}</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Message Form */}
            <form onSubmit={handleSendMessage} className="p-6 bg-[#050507]/80 backdrop-blur-md z-10" id="send-form">
              <div className="max-w-4xl mx-auto flex items-center gap-4 bg-[#09090b] border border-zinc-800 rounded-2xl p-3 focus-within:border-emerald-500/50 shadow-2xl transition-all">
                <input
                  type="text"
                  value={messageText}
                  onChange={handleMessageChange}
                  placeholder="Type a secure message..."
                  className="flex-1 bg-transparent border-none outline-none text-sm text-zinc-200 py-1 px-2 placeholder-zinc-500 focus:ring-0"
                  id="chat-input"
                />
                <button
                  type="submit"
                  disabled={!messageText.trim()}
                  className="w-10 h-10 bg-emerald-500 hover:bg-emerald-400 text-black rounded-xl flex items-center justify-center flex-shrink-0 disabled:opacity-40 transition-all cursor-pointer shadow-[0_0_10px_rgba(16,185,129,0.2)]"
                  title="Send message (automatically AES encrypted)"
                >
                  <Send className="w-4 h-4 text-black" />
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#050507] relative h-full" id="empty-chat-state">
            {/* Background Gradients */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-emerald-500/5 blur-[120px] pointer-events-none"></div>

            {/* Grid Pattern overlay */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f1f2e_1px,transparent_1px),linear-gradient(to_bottom,#1f1f2e_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-5 pointer-events-none"></div>
            
            <div className="text-center space-y-5 max-w-sm relative z-10" id="empty-chat-box">
              <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto border border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.15)]">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981] animate-pulse"></div>
              </div>
              <h3 className="font-bold text-white text-md uppercase font-mono tracking-widest">Secured Enclave Idle</h3>
              <p className="text-xs text-zinc-400 leading-relaxed font-sans">
                Select or establish a new cryptographic vault channel. Your local RSA-OAEP authentication pair is active. All communications compile exclusively into client-side ciphertext before network dispatch.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 3. Cryptography Inspect Panel (Right) */}
      {isVisualizerOpen && (
        <KeyVisualizer
          userRSAPrivateKey={myRSAPrivateKey}
          userRSAPublicKeyB64={myRSAPublicKeyB64}
          activeRoomId={activeRoom?.roomId || null}
          activeRoomName={activeRoom?.name || ""}
          roomAESKeyB64={activeRoom ? roomAESKeys[activeRoom?.roomId || ""]?.b64 || null : null}
          onClose={() => setIsVisualizerOpen(false)}
        />
      )}

      {/* --- MODAL: Create Room Dial --- */}
      <AnimatePresence>
        {isNewRoomOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#050507]/90 backdrop-blur-sm" id="modal-container">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#09090b] border border-zinc-800 max-w-md w-full rounded-2xl overflow-hidden flex flex-col max-h-[90vh] shadow-2xl"
              id="room-creation-modal"
            >
              {/* Modal Header */}
              <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
                <h3 className="font-bold text-white text-xs uppercase font-mono tracking-wider">Create Secure Vault Channel</h3>
                <button
                  onClick={() => setIsNewRoomOpen(false)}
                  className="text-xs uppercase font-mono text-zinc-500 hover:text-white transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>

              <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs" id="modal-body">
                {/* Chat Type Options */}
                <div>
                  <label className="text-zinc-500 block mb-2 uppercase tracking-wider font-mono text-[9px]">Enclave Mode</label>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      onClick={() => setRoomType("direct")}
                      className={`p-3 rounded-xl text-center border font-bold text-[10px] uppercase font-mono tracking-wider transition cursor-pointer ${
                        roomType === "direct"
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                          : "bg-[#050507] border-zinc-800 text-zinc-500 hover:bg-zinc-900"
                      }`}
                    >
                      Direct Message
                    </button>
                    <button
                      onClick={() => setRoomType("group")}
                      className={`p-3 rounded-xl text-center border font-bold text-[10px] uppercase font-mono tracking-wider transition cursor-pointer ${
                        roomType === "group"
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                          : "bg-[#050507] border-zinc-800 text-zinc-500 hover:bg-zinc-900"
                      }`}
                    >
                      Multi-peer Vault
                    </button>
                  </div>
                </div>

                {/* Group Details Input */}
                {roomType === "group" && (
                  <div>
                    <label className="text-zinc-500 block mb-1.5 uppercase tracking-wider font-mono text-[9px]">Vault / Group Name</label>
                    <input
                      type="text"
                      className="w-full bg-[#050507] text-xs border border-zinc-800 rounded-xl p-3 outline-none text-zinc-200 focus:border-emerald-500/50"
                      placeholder="e.g. OPERATION DESERT"
                      value={roomNameInput}
                      onChange={(e) => setRoomNameInput(e.target.value)}
                    />
                  </div>
                )}

                {/* User selection list query */}
                <div className="space-y-2">
                  <span className="text-zinc-500 block uppercase tracking-wider font-mono text-[9px]">Select Operator Recipient(s)</span>
                  
                  {/* Search Bar */}
                  <div className="flex items-center gap-2.5 bg-[#050507] border border-zinc-800 rounded-xl p-2.5 focus-within:border-emerald-500/50">
                    <Search className="w-4 h-4 text-zinc-650" />
                    <input
                      type="text"
                      placeholder="Search operators by name..."
                      className="bg-transparent border-0 outline-none w-full text-xs text-zinc-200 focus:ring-0"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>

                  {/* Users results container */}
                  <div className="max-h-48 overflow-y-auto border border-zinc-800 bg-[#050507] rounded-xl p-2 divide-y divide-zinc-900 space-y-1">
                    {filteredUsers.map((pUser) => {
                      const isSelected = selectedUserIds.includes(pUser.uid);
                      return (
                        <button
                          key={pUser.uid}
                          onClick={() => {
                            if (roomType === "direct") {
                              setSelectedUserIds([pUser.uid]);
                            } else {
                              setSelectedUserIds((prev) =>
                                isSelected ? prev.filter((id) => id !== pUser.uid) : [...prev, pUser.uid]
                              );
                            }
                          }}
                          className="w-full text-left p-2.5 hover:bg-zinc-900/60 rounded-lg flex items-center justify-between transition-colors"
                        >
                          <div className="flex items-center gap-2.5">
                            <img
                              src={pUser.photoURL || "https://api.dicebear.com/7.x/bottts/svg?seed=" + pUser.uid}
                              className="w-7 h-7 rounded-full border border-zinc-800 object-cover referrer-policy-no-referrer"
                              alt="Recipient Avatar"
                              referrerPolicy="no-referrer"
                            />
                            <div className="flex flex-col">
                              <span className="font-bold text-zinc-200 text-xs">{pUser.displayName}</span>
                              <span className="text-[10px] text-zinc-500 truncate max-w-xs">{pUser.email}</span>
                            </div>
                          </div>

                          <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                            isSelected ? "bg-emerald-500 border-emerald-500 text-black" : "border-zinc-700"
                          }`}>
                            {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                        </button>
                      );
                    })}

                    {filteredUsers.length === 0 && (
                      <div className="text-zinc-500 text-center py-5 text-[11px] font-mono uppercase tracking-wider">
                        No active operators located
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Modal Actions */}
              <div className="p-4 bg-[#050507] border-t border-zinc-800 flex justify-between gap-3 text-xs">
                <div className="text-[9px] text-zinc-500 max-w-[200px] leading-relaxed flex items-center gap-1.5 font-mono uppercase tracking-wider">
                  <Shield className="w-4 h-4 text-emerald-400 shrink-0 animate-pulse" />
                  <span>Sealed AES-256-GCM Session</span>
                </div>
                <button
                  disabled={isCreatingRoom || selectedUserIds.length === 0}
                  onClick={handleCreateRoom}
                  className="px-5 py-2.5 bg-emerald-500 text-black font-bold uppercase font-mono tracking-wider rounded-xl hover:bg-emerald-400 disabled:opacity-40 select-none cursor-pointer shadow-[0_0_10px_rgba(16,185,129,0.15)]"
                >
                  {isCreatingRoom ? "Assembling..." : "Establish Enclave"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- BACKUP KEY DRAWER DIALOG --- */}
      <AnimatePresence>
        {exportedPrivateKeyB64 && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#050507]/90 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#09090b] border border-zinc-800 max-w-md w-full rounded-2xl overflow-hidden p-5 flex flex-col space-y-4 shadow-2xl"
              id="key-backup-modal"
            >
              <div className="flex items-center gap-2 text-amber-500 border-b border-zinc-800 pb-3">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="font-bold text-white uppercase font-mono tracking-wider text-xs">Operator Key Backup</h3>
              </div>

              <p className="text-xs text-zinc-400 leading-relaxed font-sans">
                This Base64 block contains your private decryption key in PKCS#8 specification. To bypass browser sandbox clears, save this block securely.
                <strong className="text-white"> DO NOT publish or share this key!</strong> Anyone who accesses this key can decrypt your secure vaults.
              </p>

              <div className="bg-[#050507] border border-zinc-800 p-3 rounded-xl text-[10px] font-mono select-all overflow-x-auto break-all max-h-40 overflow-y-auto text-emerald-400">
                {exportedPrivateKeyB64}
              </div>

              <div className="flex gap-2.5 pt-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(exportedPrivateKeyB64);
                    alert("Private key copied text buffer!");
                  }}
                  className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black font-bold uppercase font-mono text-[10px] tracking-wider rounded-xl cursor-pointer"
                >
                  Copy Key Block
                </button>
                <button
                  onClick={() => setExportedPrivateKeyB64(null)}
                  className="py-2.5 px-5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 font-bold uppercase font-mono text-[10px] tracking-wider rounded-xl cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
