# Aves Core

Browser WebRTC client library for peer-to-peer rooms. `@yrzhao/aves-core` connects to an `aves-node` signaling server, builds a full-mesh WebRTC topology, and provides typed APIs for messages, file transfer, voice, video, screen sharing, reconnect restore, and diagnostics.

Version: `1.1.0`

## Install

```bash
npm install @yrzhao/aves-core
```

## Quick Start

```ts
import { AvesClient } from "@yrzhao/aves-core";

const client = new AvesClient({
  signalingUrl: "wss://signal.example.com",
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:turn.example.com:3478",
      username: "turn-user",
      credential: "turn-password",
    },
  ],
});

client.on("message", (peerId, message) => {
  console.log("message from", peerId, message);
});

client.on("error", (error) => {
  console.error(error.code, error.stage, error.message);
});

const roomId = await client.createRoom();
await client.joinRoom(roomId, "Alice");

await client.waitForPeer("peer-user-id");
client.sendMessage({ text: "hello" });
```

## What It Does

- Creates and joins signaling rooms through `aves-node`.
- Builds direct WebRTC peer connections between every participant in a room.
- Sends JSON messages over a data channel.
- Sends files over a dedicated file data channel.
- Captures and forwards microphone, camera, and screen-share tracks.
- Restores room membership after transient signaling disconnects.
- Emits typed events for application state and errors.
- Exposes connection snapshots for diagnostics panels and smoke tests.

## What It Does Not Do

- It does not host a signaling server. Use `@yrzhao/aves-node`.
- It does not relay media or data traffic. Peers communicate directly.
- It does not replace TURN. Production networks still need TURN fallback.
- It does not encrypt beyond WebRTC/WebSocket transport guarantees. Use HTTPS/WSS.
- It is not an SFU. Full-mesh rooms are best for small groups.

## Core API

### Rooms

```ts
const roomId = await client.createRoom();
const existingParticipants = await client.joinRoom(roomId, "Alice");
await client.leaveRoom();
client.destroy();
```

### Messages

```ts
client.sendMessage({ kind: "chat", text: "hello" });
client.sendMessageToPeer(peerId, { kind: "private", text: "hi" });
```

### Peer Readiness And Diagnostics

```ts
await client.waitForPeer(peerId, { timeoutMs: 10000 });

const snapshot = client.getConnectionSnapshot();
console.log(snapshot.signalingConnected, snapshot.peers);
```

### Files

```ts
await client.sendFile(file, {
  fileName: file.name,
  mimeType: file.type || "application/octet-stream",
});

client.on("fileTransferProgress", (_peerId, progress) => {
  console.log(Math.round(progress.progress * 100));
});
```

### Media

```ts
await client.startVoice();
client.setMuted(true);
client.stopVoice();

await client.startVideo({ width: 1280, height: 720, frameRate: 30 });
client.setVideoMuted(true);
client.stopVideo();

await client.startScreenShare();
client.stopScreenShare();
```

## Configuration

```ts
new AvesClient({
  signalingUrl: "wss://signal.example.com",
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  fileChunkSize: 16 * 1024,
  video: { width: 1280, height: 720, frameRate: 30 },
  reconnect: {
    maxAttempts: 5,
    delay: 3000,
    requestTimeoutMs: 30000,
  },
  debug: false,
});
```

## Events

| Event | Arguments |
| --- | --- |
| `signalingStateChange` | `(state)` |
| `userJoined` | `(participant)` |
| `userLeft` | `(userId)` |
| `connectionStateChange` | `(peerId, state)` |
| `dataChannelStateChange` | `(peerId, state)` |
| `message` | `(peerId, message)` |
| `remoteAudioTrack` / `remoteVideoTrack` | `(peerId, stream, track)` |
| `localAudioStateChange` / `localVideoStateChange` | `(state)` |
| `screenShareStateChange` | `(state)` |
| `fileTransferStarted` / `fileTransferProgress` / `fileTransferCompleted` / `fileTransferFailed` | transfer lifecycle payloads |
| `error` | `(AvesError)` |

## Production Notes

- Use HTTPS for the web app and WSS for signaling.
- Configure TURN for restrictive NATs, enterprise networks, and mobile carriers.
- Keep rooms small. Full mesh requires each peer to maintain one connection to every other peer.
- Prefer small to medium files over data channels. Very large files need application-level resume/retry UX.
- Test Safari and mobile browsers separately if they are target platforms.

See [PRODUCTION.md](docs/PRODUCTION.md) and [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Browser Support

Modern Chromium, Firefox, and Safari versions with WebRTC, DataChannel, `getUserMedia`, and `getDisplayMedia` support. Screen sharing and media permissions vary by browser and platform.

MIT
