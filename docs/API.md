# AvesClient API Reference

## Constructor

### `new AvesClient(config)`

Creates a new AvesClient instance and establishes internal event wiring between the WebSocket signaling layer and the WebRTC peer connection manager.

#### `AvesClientConfig`

| Property | Type | Default | Description |
|---|---|---|---|
| `signalingUrl` | `string` | _(required)_ | WebSocket URL of the aves-node signaling server (e.g. `ws://localhost:8080`). |
| `iceServers` | `RTCIceServer[]` | `[{ urls: "stun:stun.l.google.com:19302" }]` | ICE server configuration passed to each `RTCPeerConnection`. At minimum a STUN server is needed for NAT traversal. |
| `fileChunkSize` | `number` | `16384` (16 KB) | Size in bytes of each binary chunk sent over the file data channel. Must be a positive integer. |
| `video` | `AvesVideoConstraints` | `{}` | Default video constraints applied when `startVideo()` is called without explicit constraints. |
| `reconnect.maxAttempts` | `number` | `5` | Maximum WebSocket reconnection attempts before giving up. |
| `reconnect.delay` | `number` | `3000` | Base delay in milliseconds between reconnection attempts (exponential backoff is applied in SignalingClient). |
| `reconnect.requestTimeoutMs` | `number` | `30000` | Timeout for correlated room requests (`createRoom`, `joinRoom`, `leaveRoom`) before the returned promise rejects with `SIGNALING_REQUEST_TIMEOUT`. |
| `debug` | `boolean` | `false` | Enable verbose internal logging for debugging. |

#### `AvesVideoConstraints`

| Property | Type | Description |
|---|---|---|
| `width` | `number` | Target video width in pixels. |
| `height` | `number` | Target video height in pixels. |
| `frameRate` | `number` | Target frame rate (fps). |
| `facingMode` | `"user" \| "environment"` | Camera preference. `"user"` for front-facing, `"environment"` for rear-facing. |
| `deviceId` | `string` | Specific camera device ID. |

---

## Room Lifecycle

### `createRoom(): Promise<string>`

Creates a new room on the signaling server and returns its room ID.

- If the WebSocket is not connected, this method connects first.
- The client does **not** join the room automatically -- call `joinRoom()` separately (or use the overload that creates and joins).

**Returns:** `string` -- the room ID to share with other peers.

**Errors:**
- `AvesError` with code `ROOM_CREATE_FAILED` if the server rejects the request.

---

### `joinRoom(roomId, userName): Promise<Participant[]>`
### `joinRoom(roomId, userId, userName): Promise<Participant[]>`

Joins an existing room. Two overloads are available:

- **Without `userId`**: the server assigns a unique user ID.
- **With `userId`**: requests a specific user ID (the server may reject it).

Once joined, the client automatically initiates WebRTC peer connections with existing participants where its user ID sorts lower than theirs (full-mesh topology -- each peer pair connects once).

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `roomId` | `string` | The room ID from `createRoom()`. |
| `userIdOrName` | `string` | Either a user ID (first overload) or a display name (second overload). |
| `maybeUserName` | `string` | Display name when `userIdOrName` is treated as user ID. |

**Returns:** `Promise<Participant[]>` -- the list of participants already in the room (including yourself).

**Errors:**
- `AvesError` with code `ROOM_NOT_FOUND` if the room does not exist.
- `AvesError` with code `ROOM_JOIN_FAILED` on other join failures.

---

### `leaveRoom(): Promise<void>`

Leaves the current room. Closes all peer connections, clears participant state, and notifies the signaling server.

- Safe to call even if not currently in a room (no-op at the client level).
- After calling, the client is back to an unjoined state and can `joinRoom()` again.

**Errors:**
- `AvesError` with code `LEAVE_NOT_JOINED` if the server considers the user not in a room.

---

## Messaging

## Diagnostics

### `getConnectionSnapshot(): AvesConnectionSnapshot`

Returns a synchronous diagnostic snapshot of the current room and peer state.

```ts
const snapshot = client.getConnectionSnapshot();
console.log(snapshot.peers);
```

```ts
interface AvesConnectionSnapshot {
  roomId: string | null;
  currentUserId: string | null;
  signalingConnected: boolean;
  participantCount: number;
  participants: Participant[];
  peers: AvesPeerSnapshot[];
}

interface AvesPeerSnapshot {
  peerId: string;
  participant?: Participant;
  connectionState: RTCPeerConnectionState;
  dataChannelState: RTCDataChannelState | "closed";
  messageChannelReady: boolean;
  fileChannelReady: boolean;
}
```

Use this for diagnostics panels, automated smoke tests, and support logs. It does not mutate connection state.

### `waitForPeer(peerId, options?): Promise<AvesPeerSnapshot>`

Resolves when the peer's message data channel is open. When `requireFileChannel` is true, it also waits for the file channel.

```ts
await client.waitForPeer(peerId, {
  timeoutMs: 10000,
  requireFileChannel: false,
});

client.sendMessageToPeer(peerId, { kind: "ready" });
```

Options:

| Property | Type | Default | Description |
|---|---|---|---|
| `timeoutMs` | `number` | `30000` | Maximum wait before rejecting with `WEBRTC_CONNECTION_FAILED`. |
| `requireFileChannel` | `boolean` | `false` | Also require the file transfer channel to be open. |

---

### `sendMessage(message): void`

Broadcasts a JSON-serializable message to **every** connected peer.

- Peers whose data channel is not yet open are silently skipped.
- The `message` value is serialized with `JSON.stringify` before sending.
- Messages must be JSON values: finite numbers, strings, booleans, `null`, arrays, and plain objects. `NaN`, `Infinity`, `undefined`, functions, class instances, and circular structures are rejected before sending.

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `message` | `AvesMessage` | Any supported JSON value. |

**Errors:**
- `AvesError` with code `MESSAGE_SERIALIZE_FAILED` if the message is not a supported JSON value.

---

### `sendMessageToPeer(peerId, message): void`

Sends a JSON-serializable message to a **specific** peer by their user ID.

The same JSON value restrictions as `sendMessage()` apply.

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `peerId` | `string` | Target peer's user ID. |
| `message` | `AvesMessage` | Any supported JSON value. |

**Errors:**
- `AvesError` with code `FILE_CHANNEL_NOT_READY` if the peer's data channel is not in the `"open"` state.
- `AvesError` with code `MESSAGE_SERIALIZE_FAILED` if the message is not a supported JSON value.

---

## File Transfer

### `sendFile(blob, options?): Promise<FileTransferInfo[]>`

Sends a file (as a `Blob`) to one or all connected peers using the dedicated file data channel and the `aves:file-control` protocol.

**Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `blob` | `Blob` | _(required)_ | The file data to send. |
| `options` | `FileTransferOptions` | `{}` | Optional transfer parameters. |

#### `FileTransferOptions`

| Property | Type | Default | Description |
|---|---|---|---|
| `peerId` | `string` | _(broadcast to all)_ | Target a specific peer. Omit to send to every connected peer with an open file channel. |
| `fileName` | `string` | `blob.name \|\| "shared-file"` | Override the file name. |
| `mimeType` | `string` | `blob.type \|\| "application/octet-stream"` | Override the MIME type. |
| `lastModified` | `number` | `blob.lastModified \|\| Date.now()` | Override the last-modified timestamp. |
| `chunkSize` | `number` | `config.fileChunkSize` | Override chunk size for this specific transfer. Must be a positive integer. |

**Returns:** `Promise<FileTransferInfo[]>` -- one entry per target peer. See `FileTransferInfo` below.

**Errors:**
- `AvesError` with code `FILE_CHANNEL_NOT_READY` if no file channels are open.
- `AvesError` with code `FILE_TRANSFER_FAILED` if a transfer is already in progress for the target peer (one at a time per peer).

Progress and completion are reported via events (see EVENTS.md).

---

## Voice / Audio

### `startVoice(): Promise<MediaStream>`

Starts capturing audio from the local microphone via `getUserMedia({ audio: true })`. The audio track is sent to all active peer connections via `RTCRtpSender.replaceTrack()`.

- Idempotent: if audio is already active, returns the existing stream.
- Throws if `navigator.mediaDevices.getUserMedia` is unavailable.

**Returns:** `Promise<MediaStream>` -- the local audio stream.

**Errors:**
- `AvesError` with code `MEDIA_NOT_AVAILABLE` if the environment does not support `getUserMedia`.
- `AvesError` with code `MEDIA_CAPTURE_FAILED` if no audio track is returned.

---

### `stopVoice(): void`

Stops local audio capture. Replaces the audio track with `null` on all peer senders and stops all local tracks.

- Safe to call when audio is not active.

---

### `setMuted(muted): void`

Mutes or unmutes the local microphone. When muted, `track.enabled` is set to `false` on the local audio track, which signals the remote peer that audio is disabled.

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `muted` | `boolean` | `true` to mute, `false` to unmute. |

---

### `getLocalAudioState(): LocalAudioState`

Returns the current state of the local audio capture.

```typescript
interface LocalAudioState {
  active: boolean;   // true if a microphone track is active
  muted: boolean;    // true if the track is muted
}
```

---

### `getRemoteAudioStream(peerId): MediaStream | null`

Returns the remote audio stream for a specific peer, or `null` if no audio stream has been received yet.

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `peerId` | `string` | The peer's user ID. |

---

## Video

### `startVideo(constraints?): Promise<MediaStream>`

Starts capturing video from the local camera via `getUserMedia({ video: ... })`. Merges the provided constraints with the default constraints from the constructor config.

- Idempotent: if video is already active, returns the existing stream.
- Behind the scenes, uses `RTCRtpSender.replaceTrack()` to attach the video track to all peer connections.

**Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `constraints` | `AvesVideoConstraints` | `config.video` | Camera constraints, merged with constructor defaults. |

**Returns:** `Promise<MediaStream>` -- the local video stream.

**Errors:**
- `AvesError` with code `MEDIA_NOT_AVAILABLE` if the environment does not support `getUserMedia`.
- `AvesError` with code `MEDIA_CAPTURE_FAILED` if no video track is returned.

---

### `stopVideo(): void`

Stops local video capture. Replaces the video track with `null` on all peer senders and stops all local tracks.

- Safe to call when video is not active.

---

### `setVideoMuted(muted): void`

Mutes or unmutes the local camera. When muted, `track.enabled` is set to `false`, which signals the remote peer that video is disabled. The camera remains active (no `track.stop()`), so muting is fast.

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `muted` | `boolean` | `true` to mute, `false` to unmute. |

---

### `getLocalVideoState(): LocalVideoState`

Returns the current state of the local video capture.

```typescript
interface LocalVideoState {
  active: boolean;   // true if a camera track is active
  muted: boolean;    // true if the track is muted
}
```

---

### `getRemoteVideoStream(peerId): MediaStream | null`

Returns the remote video stream for a specific peer, or `null` if no video stream has been received yet.

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `peerId` | `string` | The peer's user ID. |

---

## Screen Share

### `startScreenShare(): Promise<MediaStream>`

Starts screen sharing via `navigator.mediaDevices.getDisplayMedia({ video: true })`. Replaces the camera video track with the display capture track on all active peer connections.

- If a camera video track was active, it is saved and restored when screen sharing stops.
- If the user stops screen sharing via the browser UI (`track.onended`), the client automatically calls `stopScreenShare()` internally.

**Returns:** `Promise<MediaStream>` -- the screen capture stream.

**Errors:**
- `AvesError` with code `MEDIA_NOT_AVAILABLE` if `getDisplayMedia` is unsupported.
- `AvesError` with code `MEDIA_CAPTURE_FAILED` if no display track is returned.

---

### `stopScreenShare(): void`

Stops screen sharing. Restores the previously active camera video track if one existed; otherwise sets the video track to null on all peer connections.

- Safe to call when screen sharing is not active.

---

### `getScreenShareState(): ScreenShareState`

Returns the current screen share state.

```typescript
interface ScreenShareState {
  active: boolean;
  source: "camera" | "screen";
}
```

When `active` is `false`, the `source` is always `"camera"`.

---

## Utility / Info

### `getConnectionState(peerId): RTCPeerConnectionState`

Returns the `RTCPeerConnectionState` for a specific peer.

| State | Meaning |
|---|---|
| `"new"` | Connection initiated, no ice candidate processed. |
| `"connecting"` | ICE gathering/connectivity checks in progress. |
| `"connected"` | ICE checks passed, media/data flows. |
| `"disconnected"` | Connectivity lost (may self-recover). |
| `"failed"` | Irrecoverable failure. |
| `"closed"` | Connection closed intentionally. |

If no connection exists for the given peer, returns `"closed"`.

---

### `getParticipants(): Participant[]`

Returns the list of participants currently in the room (from the client's local cache).

```typescript
interface Participant {
  id: string;
  name: string;
}
```

---

### `getCurrentUserId(): string | null`

Returns the current client's user ID assigned by the signaling server, or `null` if not in a room.

---

### `isConnected(): boolean`

Returns `true` if the WebSocket connection to the signaling server is currently open.

---

### `destroy(): void`

Completely tears down the client:

1. Leaves any active room (without signaling the server -- just clears local state).
2. Disconnects the WebSocket.
3. Destroys all peer connections and data channels.
4. Stops all media tracks (audio, video, screen share).
5. Removes all event listeners.

After calling `destroy()`, the instance should not be reused. Create a new `AvesClient` instead.

---

## Error Handling

All errors are of type `AvesError`:

| Property | Type | Description |
|---|---|---|
| `message` | `string` | Human-readable error description. |
| `code` | `AvesErrorCode` | Machine-readable error code for programmatic handling. |
| `stage` | `string` | Where the error originated: `"protocol"`, `"room"`, `"signaling"`, `"transport"`, `"server"`. |
| `retryable` | `boolean` | Whether the operation can be safely retried. |
| `peerId` | `string \| undefined` | The peer involved, if applicable. |
| `roomId` | `string \| undefined` | The room involved, if applicable. |
| `requestId` | `string \| undefined` | The signaling request correlating to the error. |
| `cause` | `unknown` | The original error (for debugging). |
| `toJSON()` | `object` | Serialises the error to a plain object (excludes `cause`). |

### All Error Codes

| Code | Stage | Description |
|---|---|---|
| `INVALID_MESSAGE_FORMAT` | protocol | Malformed message received. |
| `INVALID_MESSAGE` | protocol | Valid JSON but unexpected structure. |
| `ROOM_NOT_FOUND` | room | Room does not exist on server. |
| `ROOM_CREATE_FAILED` | room | Server failed to create the room. |
| `ROOM_JOIN_FAILED` | room | Server rejected join attempt. |
| `JOIN_ROOM_MISSING_FIELDS` | room | Join message missing required fields. |
| `ALREADY_JOINED` | room | User already in the room. |
| `LEAVE_NOT_JOINED` | room | User attempted to leave without joining. |
| `LEAVE_USER_MISMATCH` | room | User ID mismatch in leave request. |
| `SIGNALING_NOT_AUTHENTICATED` | signaling | Unauthorized signaling request. |
| `SIGNALING_FORBIDDEN` | signaling | Request explicitly forbidden. |
| `SIGNALING_TARGET_NOT_FOUND` | signaling | Target peer not found on server. |
| `SIGNALING_TARGET_ROOM_MISMATCH` | signaling | Target peer not in the same room. |
| `SERVER_ERROR` | server | Generic server-side error. |
| `WEBRTC_CONNECTION_FAILED` | transport | PeerConnection failed to establish. |
| `WEBRTC_DATACHANNEL_FAILED` | transport | DataChannel encountered an error. |
| `WEBRTC_ICE_FAILED` | transport | ICE candidate processing failed. |
| `MEDIA_CAPTURE_FAILED` | transport | getUserMedia/getDisplayMedia failed. |
| `MEDIA_NOT_AVAILABLE` | transport | Media APIs not available in this environment. |
| `FILE_TRANSFER_FAILED` | transport | File transfer generic failure. |
| `FILE_TRANSFER_TIMEOUT` | transport | File transfer timed out waiting for peer. |
| `FILE_TRANSFER_REJECTED` | transport | Receiver rejected the transfer. |
| `FILE_CHANNEL_NOT_READY` | transport | File data channel is not open. |
| `MESSAGE_PARSE_FAILED` | transport | Failed to parse incoming JSON message. |
| `MESSAGE_SEND_FAILED` | transport | Failed to send a message. |
| `MESSAGE_SERIALIZE_FAILED` | transport | Outgoing message is not a supported JSON value. |
| `UNKNOWN_ERROR` | server | Unclassified error. |
