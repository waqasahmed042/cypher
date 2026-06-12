/**
 * Notification and Tone Synthesizer Module.
 * Synthesizes clean notifications sound natively using Web Audio API (completely asset-free).
 * Shows HTML5 Desktop Notifications matching browser-level notification hooks.
 */

// Synthesizes a pleasant modern chime (sound effect) for incoming messages
export function playIncomingMessageSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    const audioCtx = new AudioContextClass();
    
    // Pleasant double-tap chime (E5 -> G5)
    const playTone = (freq: number, startTime: number, duration: number) => {
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startTime);
      
      gainNode.gain.setValueAtTime(0.1, startTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration - 0.05);

      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    const now = audioCtx.currentTime;
    playTone(659.25, now, 0.15); // E5
    playTone(783.99, now + 0.08, 0.25); // G5
  } catch (e) {
    console.debug("Audio playback ignored or blocked by browser user-interaction rules:", e);
  }
}

// Request permissions for HTML5 Desktop notification alerts
export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) {
    console.warn("Desktop notifications not supported in this browser.");
    return false;
  }

  if (Notification.permission === "granted") {
    return true;
  }

  if (Notification.permission !== "denied") {
    const permission = await Notification.requestPermission();
    return permission === "granted";
  }

  return false;
}

// Trigger browser native push notification if the window is not currently active
export function showPushNotification(senderName: string, decryptedBody: string) {
  if (!("Notification" in window)) return;

  // Only trigger desktop notification alerts if the document is unfocused
  if (document.hasFocus()) return;

  if (Notification.permission === "granted") {
    try {
      const notification = new Notification(`🔐 Encrypted: Chat from ${senderName}`, {
        body: decryptedBody,
        tag: "e2ee-message",
        requireInteraction: false,
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch (err) {
      console.warn("Failed to trigger desktop notification popups: ", err);
    }
  }
}
