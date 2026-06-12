# Security Specification: Real-Time Encrypted Chat

## 1. Data Invariants
- **Message Integrity**: A message cannot be written or access-granted unless the sender is a verified and authenticated member of the room.
- **Identity Integrity**: No user may spoof the `senderId` parameter; it must strictly match the authenticated sender's UID (`request.auth.uid`).
- **Cryptographic Security**: Every message must include a valid Base64-encoded initial vector (`iv`) and an encrypted ciphertext body (`encryptedText`).
- **Room Key Security**: Symmetric room keys must only be written inside a member's sub-document and encrypted against that specific user's public RSA key. No generic or unencrypted keys can be stored.
- **Immutability of Messages**: Messages cannot be mutated or deleted after creation. This ensures a tamper-proof audit trail for end-to-end encrypted items.

---

## 2. The "Dirty Dozen" Payloads (Malicious Attack Vectors)

### Payload 1: Sender Spoofing (Identity Spoofing)
An attacker attempts to send an encrypted message under another user's identity.
```json
{
  "messageId": "msg_999",
  "senderId": "victim_uid",
  "senderName": "Victim User",
  "encryptedText": "ciphertext...",
  "iv": "vector...",
  "createdAt": "SERVER_TIMESTAMP"
}
```
*Expected Result: `PERMISSION_DENIED`*

### Payload 2: Outside Injection (Write Lock Violation)
A user who is NOT a member of a private room tries to write a message into that room's sub-collection.
```json
{
  "messageId": "msg_001",
  "senderId": "attacker_uid",
  "senderName": "Attacker",
  "encryptedText": "ciphertext...",
  "iv": "vector...",
  "createdAt": "SERVER_TIMESTAMP"
}
```
*Expected Result: `PERMISSION_DENIED`*

### Payload 3: Value Poisoning (Denial of Wallet)
An attacker tries to send an extremely large message (e.g., 5MB payload) or incorrect types to bloat database metrics.
```json
{
  "messageId": "msg_poison",
  "senderId": "attacker_uid",
  "senderName": "Attacker",
  "encryptedText": { "heavy_object": true }, 
  "iv": true,
  "createdAt": "SERVER_TIMESTAMP"
}
```
*Expected Result: `PERMISSION_DENIED` (Strict schemas enforce types and size boundaries)*

### Payload 4: Key Impersonation
An attacker attempts to write their own encrypted room key into another member's resource block.
```json
{
  "userId": "victim_uid",
  "displayName": "Victim User",
  "encryptedRoomKey": "forged_malicious_key",
  "joinedAt": "SERVER_TIMESTAMP"
}
```
*Expected Result: `PERMISSION_DENIED`*

### Payload 5: Tampering with Historic Messages (Immutability violation)
An attacker attempts to overwrite an already sent message with modified ciphertext.
```json
{
  "messageId": "msg_existing_123",
  "senderId": "attacker_uid",
  "senderName": "Attacker",
  "encryptedText": "new_tampered_ciphertext...",
  "iv": "vector...",
  "createdAt": "SERVER_TIMESTAMP"
}
```
*Expected Result: `PERMISSION_DENIED` (Updates are forbidden on messages)*

### Payload 6: Untrusted Timestamp Injection
An attacker attempts to backdate or forwarddate a message by supplying a static client timestamp instead of the server timestamp request value.
```json
{
  "messageId": "msg_time",
  "senderId": "attacker_uid",
  "senderName": "Attacker",
  "encryptedText": "ciphertext...",
  "iv": "vector...",
  "createdAt": "2020-01-01T00:00:00Z"
}
```
*Expected Result: `PERMISSION_DENIED`*

### Payload 7: Identity Modification (Privilege Escalation)
A user tries to change the `createdBy` property of an existing group room to claim ownership/creator status.
```json
{
  "roomId": "room_xyz",
  "name": "Group A",
  "type": "group",
  "createdBy": "attacker_uid",
  "createdAt": "SERVER_TIMESTAMP"
}
```
*Expected Result: `PERMISSION_DENIED`*

### Payload 8: Profile Spoofing
An attacker tries to modify another user's registered public key to execute a Man-in-the-Middle (MITM) key swapping attack.
```json
{
  "uid": "victim_uid",
  "displayName": "Victim User",
  "email": "victim@example.com",
  "publicKey": "attacker_pub_key_replica..."
}
```
*Expected Result: `PERMISSION_DENIED`*

### Payload 9: Empty Key Injection
Registering a profile with empty or malicious key configurations.
```json
{
  "uid": "attacker_uid",
  "displayName": "Attacker",
  "email": "attacker@example.com",
  "publicKey": "",
  "createdAt": "SERVER_TIMESTAMP"
}
```
*Expected Result: `PERMISSION_DENIED`*

### Payload 10: Unauthorized Room Discovery (Blanket Read)
An unauthenticated or non-member user tries to list/get another private chat room's document.
```json
Get /rooms/secret_group_101
```
*Expected Result: `PERMISSION_DENIED`*

### Payload 11: Ghost Member Spoofing
A non-member tries to add an extra user into a direct chat room without being creator.
```json
{
  "userId": "extra_spy",
  "displayName": "Spy",
  "encryptedRoomKey": "ciphertext_key...",
  "joinedAt": "SERVER_TIMESTAMP"
}
```
*Expected Result: `PERMISSION_DENIED`*

### Payload 12: Injection of Massive IDs (Path Variable Hardening)
An attacker requests a document where the Document ID contains invalid payload strings exceeding 1.5kb to exhaust CPU cycles.
```json
Get /rooms/ROOM_ID_CONTAINING_1000_JUNK_CHARACTERS
```
*Expected Result: `PERMISSION_DENIED`*

---

## 3. The Test Runner Spec
A mockup representation of test runs performed natively on Firestore rule configurations:
- `auth = null` -> Writes are rejected universally.
- `auth = { uid: "user_a" }` -> Create user document `/users/user_a` succeeds.
- `auth = { uid: "user_a" }` -> Create user document `/users/user_b` fails.
- `auth = { uid: "user_a" }` -> Message creation where `senderId != "user_a"` fails.
- `auth = { uid: "user_b" }` -> Read message in `/rooms/room_1` without a valid `/rooms/room_1/members/user_b` document fails.
- `auth = { uid: "user_a" }` -> Adding message where `createdAt != request.time` fails.
