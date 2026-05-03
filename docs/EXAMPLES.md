# AvesClient Examples

All examples assume `AvesClient` is already imported. These are browser-side examples; the signaling server must be running (see aves-node).

```typescript
import { AvesClient } from "@yrzhao/aves-core";
```

---

## 1. Text Chat

Basic two-way text messaging between two peers in a room.

```typescript
async function textChatDemo() {
  // Create two clients simulating two users
  const alice = new AvesClient({ signalingUrl: "ws://localhost:8080" });
  const bob = new AvesClient({ signalingUrl: "ws://localhost:8080" });

  // --- Alice creates a room ---
  const roomId = await alice.createRoom();
  console.log("Room created:", roomId);

  // --- Bob joins the room ---
  const bobParticipants = await bob.joinRoom(roomId, "Bob");
  const aliceParticipants = await alice.joinRoom(roomId, "Alice");

  // --- Listen for messages on both sides ---
  alice.on("message", (peerId, msg) => {
    console.log(`Alice received from ${peerId}:`, msg);
  });

  bob.on("message", (peerId, msg) => {
    console.log(`Bob received from ${peerId}:`, msg);
  });

  // --- Wait for connections to establish ---
  await waitForConnected(alice, bobParticipants);

  // --- Send messages ---
  bob.sendMessage({ type: "chat", text: "Hello from Bob!" });
  alice.sendMessageToPeer(
    bobParticipants.find((p) => p.name === "Bob")!.id,
    { type: "chat", text: "Hey Bob, Alice here!" }
  );

  // --- Clean up ---
  await alice.leaveRoom();
  await bob.leaveRoom();

  function waitForConnected(
    client: AvesClient,
    participants: { id: string }[]
  ): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (
          participants
            .filter((p) => p.id !== client.getCurrentUserId())
            .every((p) => client.getConnectionState(p.id) === "connected")
        ) {
          resolve();
        }
      };
      client.on("connectionStateChange", check);
      // Also check immediately in case already connected
      check();
    });
  }
}
```

---

## 2. Voice Call

Adding real-time audio to a room.

```typescript
async function voiceCallDemo() {
  const client = new AvesClient({
    signalingUrl: "ws://localhost:8080",
    debug: true,
  });

  const roomId = await client.createRoom();
  // Share roomId with another peer

  // Handle remote audio
  client.on("remoteAudioTrack", (peerId, stream) => {
    const audio = new Audio();
    audio.srcObject = stream;
    audio.autoplay = true;
    document.body.appendChild(audio);
  });

  client.on("localAudioStateChange", (state) => {
    updateMicButton(state.active, state.muted);
  });

  // Mute/unmute button handler
  document.getElementById("mute-btn")!.onclick = () => {
    const state = client.getLocalAudioState();
    client.setMuted(!state.muted);
  };

  // Start voice
  try {
    const localStream = await client.startVoice();
    // localStream can be used for a local "self-view" indication
    console.log("Voice active, track:", localStream.getAudioTracks()[0].label);
  } catch (error) {
    console.error("Failed to start voice:", error);
  }

  // Stop voice
  // client.stopVoice();

  function updateMicButton(active: boolean, muted: boolean) {
    const btn = document.getElementById("mute-btn")!;
    if (!active) {
      btn.textContent = "No mic";
    } else if (muted) {
      btn.textContent = "Unmute";
    } else {
      btn.textContent = "Mute";
    }
  }
}
```

---

## 3. Video Call

Camera video alongside audio.

```typescript
async function videoCallDemo() {
  const client = new AvesClient({
    signalingUrl: "ws://localhost:8080",
    video: { width: 1280, height: 720, frameRate: 30 },
  });

  const roomId = await client.createRoom();
  // Share roomId with another peer

  // --- Local video preview ---
  const localVideo = document.getElementById("local-video") as HTMLVideoElement;
  const remoteVideoContainer = document.getElementById("remote-videos")!;

  client.on("remoteVideoTrack", (peerId, stream) => {
    const video = document.createElement("video");
    video.id = `remote-${peerId}`;
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    remoteVideoContainer.appendChild(video);
  });

  client.on("localVideoStateChange", (state) => {
    document.getElementById("camera-btn")!.textContent = state.active
      ? state.muted
        ? "Camera off"
        : "Camera on"
      : "Start camera";
  });

  // --- Start camera ---
  const stream = await client.startVideo();
  localVideo.srcObject = stream;
  localVideo.play();

  // --- Start audio too ---
  await client.startVoice();

  // --- Toggle camera ---
  document.getElementById("camera-btn")!.onclick = () => {
    const state = client.getLocalVideoState();
    if (!state.active) {
      client.startVideo();
    } else {
      client.setVideoMuted(!state.muted);
    }
  };

  // --- Stop everything ---
  // client.stopVideo();
  // client.stopVoice();
}
```

---

## 4. Screen Sharing

Sharing a screen or application window.

```typescript
async function screenShareDemo() {
  const client = new AvesClient({ signalingUrl: "ws://localhost:8080" });
  const roomId = await client.createRoom();

  client.on("screenShareStateChange", (state) => {
    const btn = document.getElementById("share-btn")!;
    btn.textContent = state.active ? "Stop sharing" : "Share screen";
  });

  // Remote peers see the screen share via the remoteVideoTrack event
  client.on("remoteVideoTrack", (peerId, stream) => {
    const video = document.getElementById(`remote-${peerId}`) as HTMLVideoElement;
    if (video) {
      video.srcObject = stream;
    }
  });

  document.getElementById("share-btn")!.onclick = async () => {
    const state = client.getScreenShareState();
    if (state.active) {
      client.stopScreenShare();
    } else {
      try {
        await client.startScreenShare();
      } catch (error) {
        console.error("Screen share failed:", error);
      }
    }
  };
}
```

---

## 5. File Transfer

Sending and receiving files with progress tracking.

```typescript
async function fileTransferDemo() {
  const client = new AvesClient({ signalingUrl: "ws://localhost:8080" });

  // --- Track all file events ---
  client.on("fileTransferStarted", (peerId, info) => {
    console.log(
      `${info.direction === "send" ? "Sending" : "Receiving"} "${info.name}"` +
        ` (${formatSize(info.size)})`
    );
    addTransferUI(info);
  });

  client.on("fileTransferProgress", (peerId, progress) => {
    updateProgressBar(
      progress.transferId,
      Math.round(progress.progress)
    );
  });

  client.on("fileTransferCompleted", (peerId, result) => {
    console.log(`Transfer of "${result.name}" completed`);

    if (result.direction === "receive" && result.blob) {
      // Trigger download of received file
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.name;
      a.click();
      URL.revokeObjectURL(url);
    }

    markTransferComplete(result.transferId);
  });

  client.on("fileTransferFailed", (peerId, info, error) => {
    console.error(`Transfer failed: ${error.message}`);
    showTransferError(info?.name ?? "unknown", error.message);
  });

  // --- Send a file (e.g. from an <input type="file">) ---
  document.getElementById("file-input")!.onchange = async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      const results = await client.sendFile(file, {
        fileName: file.name,
        mimeType: file.type,
        lastModified: file.lastModified,
        // Omit peerId to broadcast to all connected peers
      });
      console.log("File transfer initiated:", results);
    } catch (error) {
      console.error("Failed to send file:", error);
    }
  };

  // --- Send to a specific peer ---
  async function sendFileToPeer(file: File, peerId: string) {
    const results = await client.sendFile(file, {
      peerId,
      fileName: file.name,
      mimeType: file.type,
    });
    return results[0];
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
```

---

## 6. Multi-Peer Room

Creating a room with multiple participants and broadcasting messages.

```typescript
async function multiPeerDemo() {
  // This could run on three separate browser tabs
  const client = new AvesClient({
    signalingUrl: "ws://localhost:8080",
    debug: true,
  });

  const roomId = await client.createRoom();
  console.log("Room created:", roomId);

  // --- Join the room with a display name ---
  const participants = await client.joinRoom(roomId, "Alice");
  console.log("Participants in room:", participants);

  // --- React to new peers ---
  client.on("userJoined", (user) => {
    console.log(`${user.name} joined!`);
    client.sendMessage({
      type: "system",
      text: `Welcome to the room, ${user.name}!`,
    });
  });

  client.on("userLeft", (userId) => {
    const p = participants.find((p) => p.id === userId);
    console.log(`${p?.name ?? userId} left`);
  });

  // --- Connection health monitoring ---
  client.on("connectionStateChange", (peerId, state) => {
    const participant = participants.find((p) => p.id === peerId);
    const name = participant?.name ?? peerId;
    updateConnectionUI(name, state);
  });

  // --- Broadcast to everyone ---
  document.getElementById("send-btn")!.onclick = () => {
    const input = document.getElementById("msg-input") as HTMLInputElement;
    if (input.value.trim()) {
      client.sendMessage({
        type: "chat",
        text: input.value,
        sender: client.getCurrentUserId(),
        timestamp: Date.now(),
      });
      input.value = "";
    }
  };

  // --- Send to one specific peer ---
  function whisper(peerName: string, text: string) {
    const target = client
      .getParticipants()
      .find((p) => p.name === peerName && p.id !== client.getCurrentUserId());
    if (target) {
      client.sendMessageToPeer(target.id, {
        type: "whisper",
        text,
        timestamp: Date.now(),
      });
    }
  }

  // --- Leave gracefully ---
  // await client.leaveRoom();

  function updateConnectionUI(name: string, state: string) {
    const el = document.getElementById(`peer-${name}`);
    if (el) {
      el.className = `connection-${state}`;
    }
  }
}
```

---

## 7. Full Lifecycle (Room Creator)

Complete lifecycle: create room, join as host, handle events, clean up.

```typescript
async function fullLifecycleDemo() {
  const client = new AvesClient({
    signalingUrl: "ws://localhost:8080",
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      {
        urls: "turn:turn.example.com:3478",
        username: "user",
        credential: "pass",
      },
    ],
    fileChunkSize: 64 * 1024, // 64 KB chunks
    reconnect: {
      maxAttempts: 10,
      delay: 2000,
    },
    debug: false,
  });

  client.on("error", (error) => {
    console.error(`[${error.code}] ${error.message}`);
    if (error.retryable) {
      // Show retry UI
    }
  });

  try {
    // 1. Create room
    const roomId = await client.createRoom();
    navigator.clipboard?.writeText(roomId);
    console.log("Room ready:", roomId);

    // 2. Join as host
    const participants = await client.joinRoom(roomId, "host-001", "Host");
    console.log("Joined with ID:", client.getCurrentUserId());

    // 3. Start media
    const audioStream = await client.startVoice();
    const videoStream = await client.startVideo({ width: 640, height: 480 });

    // 4. Use throughout session...
    // (message handling, file transfer, etc.)

  } catch (error) {
    console.error("Lifecycle error:", error);
  }

  // 5. Clean shutdown
  async function shutdown() {
    await client.leaveRoom();
    client.destroy(); // Full teardown, no reuse
  }

  window.addEventListener("beforeunload", shutdown);
}
```

---

## Common Patterns

### Check if a peer is connected

```typescript
function isPeerConnected(client: AvesClient, peerId: string): boolean {
  return client.getConnectionState(peerId) === "connected";
}
```

### Wait for all peers to connect

```typescript
function waitForAllPeers(client: AvesClient): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      const allConnected = client
        .getParticipants()
        .filter((p) => p.id !== client.getCurrentUserId())
        .every((p) => client.getConnectionState(p.id) === "connected");
      if (allConnected) resolve();
    };
    client.on("connectionStateChange", check);
    check();
  });
}
```

### Reconnection awareness

```typescript
client.on("signalingStateChange", (state) => {
  if (state === "disconnected" && client.getCurrentUserId()) {
    showReconnectBanner();
  }
  if (state === "connected") {
    hideReconnectBanner();
  }
});
```
