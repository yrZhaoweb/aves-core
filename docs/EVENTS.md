# AvesClient Events Reference

AvesClient extends `EventEmitter<AvesClientEvents>`. All events are emitted with typed payloads. Use the `on(event, callback)` method to subscribe and `off(event, callback)` to unsubscribe.

```typescript
interface AvesClientEvents {
  signalingStateChange: [state: string];
  error: [error: AvesError];
  userJoined: [user: Participant];
  userLeft: [userId: string];
  connectionStateChange: [peerId: string, state: RTCPeerConnectionState];
  dataChannelStateChange: [peerId: string, state: RTCDataChannelState];
  message: [peerId: string, message: AvesMessage];
  remoteAudioTrack: [peerId: string, stream: MediaStream, track: MediaStreamTrack];
  remoteVideoTrack: [peerId: string, stream: MediaStream, track: MediaStreamTrack];
  localAudioStateChange: [state: LocalAudioState];
  localVideoStateChange: [state: LocalVideoState];
  screenShareStateChange: [state: ScreenShareState];
  fileTransferStarted: [peerId: string, info: FileTransferInfo];
  fileTransferProgress: [peerId: string, progress: FileTransferProgress];
  fileTransferCompleted: [peerId: string, result: FileTransferResult];
  fileTransferFailed: [peerId: string, info: FileTransferInfo | null, error: AvesError];
}
```

---

## `signalingStateChange`

**Payload:** `[state: string]`

Fires when the WebSocket connection to the signaling server changes state.

| State value | Meaning |
|---|---|
| `"connected"` | WebSocket opened. |
| `"disconnected"` | WebSocket closed or failed. Triggers auto-reconnect if configured. |
| `"reconnecting"` | Attempting to reconnect (SignalingClient internal state). |

**When it fires:**
- Connection established or lost with the signaling server.
- On reconnect, the client automatically restores the room session.

**Example:**
```typescript
client.on("signalingStateChange", (state) => {
  console.log(`Signaling: ${state}`);
  if (state === "connected") {
    // WebSocket is ready
  }
  if (state === "disconnected" && client.getCurrentUserId()) {
    showReconnectIndicator();
  }
});
```

---

## `error`

**Payload:** `[error: AvesError]`

Fires when any non-fatal error occurs anywhere in the client -- signaling, WebRTC, media, or file transfer.

**When it fires:**
- Signaling errors (room create/join fails).
- WebRTC connection or ICE failures.
- Media capture failures.
- File transfer errors (also covered by `fileTransferFailed`).
- Message parse errors from a remote peer.

**Example:**
```typescript
client.on("error", (error) => {
  console.error(`[${error.code}] ${error.message} (retryable: ${error.retryable})`);
  if (error.retryable) {
    // Prompt user to retry
  }
});
```

---

## `userJoined`

**Payload:** `[user: Participant]`

```typescript
interface Participant {
  id: string;
  name: string;
}
```

**When it fires:** A new peer has joined the room. The client automatically attempts to establish a WebRTC connection with the new peer.

**Example:**
```typescript
client.on("userJoined", (user) => {
  console.log(`${user.name} (${user.id}) joined the room`);
  updateParticipantList();
});
```

---

## `userLeft`

**Payload:** `[userId: string]`

**When it fires:** A peer has left the room. The client automatically closes the peer connection and data channels with that peer.

**Example:**
```typescript
client.on("userLeft", (userId) => {
  console.log(`Peer ${userId} left`);
  removeFromParticipantList(userId);
});
```

---

## `connectionStateChange`

**Payload:** `[peerId: string, state: RTCPeerConnectionState]`

Fires when the `RTCPeerConnection` state changes for a specific peer. Maps directly to the browser's `RTCPeerConnection.onconnectionstatechange`.

| State | Meaning |
|---|---|
| `"new"` | Connection created, no ICE processing yet. |
| `"connecting"` | ICE gathering/connectivity checks in progress. |
| `"connected"` | ICE checks passed, media and data can flow. |
| `"disconnected"` | Connectivity lost temporarily (may self-recover). |
| `"failed"` | Irrecoverable. Client automatically closes the peer connection. |
| `"closed"` | Connection closed intentionally. |

**When it fires:** Any state transition on a peer's `RTCPeerConnection`.

**Example:**
```typescript
client.on("connectionStateChange", (peerId, state) => {
  updatePeerStatusUI(peerId, state);
  if (state === "failed") {
    showReconnectPrompt(peerId);
  }
});
```

---

## `dataChannelStateChange`

**Payload:** `[peerId: string, state: RTCDataChannelState]`

Fires when the main "data" data channel state changes for a specific peer.

| State | Meaning |
|---|---|
| `"connecting"` | Channel being negotiated. |
| `"open"` | Channel ready to send/receive messages. |
| `"closing"` | Channel being torn down. |
| `"closed"` | Channel closed. |

**When it fires:** The main message channel opens or closes.

**Example:**
```typescript
client.on("dataChannelStateChange", (peerId, state) => {
  if (state === "open") {
    console.log(`Data channel ready for ${peerId}`);
  }
});
```

---

## `message`

**Payload:** `[peerId: string, message: AvesMessage]`

Fires when a JSON message is received from a peer over the main data channel.

- The `message` value is the parsed JSON payload.
- `AvesMessage` is a JSON value: finite numbers, strings, booleans, `null`, arrays, and plain objects.
- File control messages (prefixed with `__aves`) are intercepted automatically and do **not** fire this event.

**When it fires:** Any non-file-control message arrives from any peer.

**Example:**
```typescript
client.on("message", (peerId, message) => {
  if (typeof message === "object" && message !== null && "text" in message) {
    displayChatMessage(peerId, (message as { text: string }).text);
  }
});
```

---

## `remoteAudioTrack`

**Payload:** `[peerId: string, stream: MediaStream, track: MediaStreamTrack]`

Fires when a remote peer adds or replaces an audio track on the `RTCPeerConnection`.

**When it fires:** The `ontrack` event fires on a peer connection with an audio track.

**Example:**
```typescript
client.on("remoteAudioTrack", (peerId, stream, track) => {
  const audioElement = document.createElement("audio");
  audioElement.srcObject = stream;
  audioElement.autoplay = true;
  document.body.appendChild(audioElement);
});
```

---

## `remoteVideoTrack`

**Payload:** `[peerId: string, stream: MediaStream, track: MediaStreamTrack]`

Fires when a remote peer adds or replaces a video track on the `RTCPeerConnection`.

**When it fires:** The `ontrack` event fires on a peer connection with a video track. If the peer already has a video stream, the new track replaces the old one.

**Example:**
```typescript
client.on("remoteVideoTrack", (peerId, stream, track) => {
  const videoElement = document.getElementById(`video-${peerId}`) as HTMLVideoElement;
  if (videoElement) {
    videoElement.srcObject = stream;
    videoElement.play();
  }
});
```

---

## `localAudioStateChange`

**Payload:** `[state: LocalAudioState]`

```typescript
interface LocalAudioState {
  active: boolean;  // true if a microphone track is active
  muted: boolean;   // true if the track is muted
}
```

**When it fires:**
- Voice capture started or stopped.
- Mute toggled.

**Example:**
```typescript
client.on("localAudioStateChange", (state) => {
  updateMicrophoneIcon(state.active ? (state.muted ? "muted" : "live") : "off");
});
```

---

## `localVideoStateChange`

**Payload:** `[state: LocalVideoState]`

```typescript
interface LocalVideoState {
  active: boolean;  // true if a camera track is active
  muted: boolean;   // true if the track is muted
}
```

**When it fires:**
- Video capture started or stopped.
- Video mute toggled.

**Example:**
```typescript
client.on("localVideoStateChange", (state) => {
  updateCameraIcon(state.active ? (state.muted ? "muted" : "live") : "off");
});
```

---

## `screenShareStateChange`

**Payload:** `[state: ScreenShareState]`

```typescript
interface ScreenShareState {
  active: boolean;
  source: "camera" | "screen";
}
```

**When it fires:**
- Screen sharing started or stopped (including via the browser's native stop button).

**Example:**
```typescript
client.on("screenShareStateChange", (state) => {
  if (state.active) {
    showScreenShareOverlay();
  } else {
    hideScreenShareOverlay();
  }
});
```

---

## `fileTransferStarted`

**Payload:** `[peerId: string, info: FileTransferInfo]`

```typescript
interface FileTransferInfo {
  transferId: string;
  peerId: string;
  direction: "send" | "receive";
  name: string;
  size: number;
  mimeType: string;
  lastModified: number;
}
```

**When it fires:** A file transfer begins, either as a sender or receiver.

**Example:**
```typescript
client.on("fileTransferStarted", (peerId, info) => {
  addFileTransferUI(peerId, info);
});
```

---

## `fileTransferProgress`

**Payload:** `[peerId: string, progress: FileTransferProgress]`

```typescript
interface FileTransferProgress extends FileTransferInfo {
  bytesTransferred: number;
  progress: number;  // 0-100
}
```

**When it fires:** After each chunk is sent or received. The `progress` field is a percentage (0-100).

**Example:**
```typescript
client.on("fileTransferProgress", (peerId, progress) => {
  updateProgressBar(peerId, progress.progress);
  updateSpeedIndicator(progress.bytesTransferred);
});
```

---

## `fileTransferCompleted`

**Payload:** `[peerId: string, result: FileTransferResult]`

```typescript
interface FileTransferResult extends FileTransferInfo {
  blob?: Blob;  // Present only for the receiving side
}
```

**When it fires:** A file transfer has completed successfully. The `blob` property is only set on the receiving side and contains the reassembled file.

**Example:**
```typescript
client.on("fileTransferCompleted", (peerId, result) => {
  if (result.direction === "receive" && result.blob) {
    const url = URL.createObjectURL(result.blob);
    // Trigger download or preview
    saveFile(result.name, url);
  }
  markTransferComplete(peerId, result.transferId);
});
```

---

## `fileTransferFailed`

**Payload:** `[peerId: string, info: FileTransferInfo | null, error: AvesError]`

**When it fires:** A file transfer fails for any reason -- channel closed, timeout, peer error, or any transport error.

**Example:**
```typescript
client.on("fileTransferFailed", (peerId, info, error) => {
  console.error(`File transfer failed: ${error.message} (code: ${error.code})`);
  showTransferError(peerId, info?.name ?? "unknown", error.message);
});
```
