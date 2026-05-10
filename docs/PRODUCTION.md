# aves-core Production Guide

`@yrzhao/aves-core` runs in the browser and creates direct WebRTC connections. Production reliability depends on the page origin, signaling transport, ICE servers, and room size.

## Required Transport

- Serve the web app over HTTPS.
- Use WSS for the signaling URL.
- Do not use `ws://` or plain HTTP outside local development.
- Camera, microphone, and screen-share APIs require a secure context in modern browsers.

## ICE Servers

Use STUN for discovery and TURN for fallback:

```ts
new AvesClient({
  signalingUrl: "wss://signal.example.com",
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:turn.example.com:3478",
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    },
  ],
});
```

STUN alone is not enough for production. Some NATs and corporate firewalls require TURN relay.

## Room Size

Aves uses a full-mesh topology. In a room of `n` participants, each browser maintains `n - 1` peer connections.

Recommended starting limits:

- Text-only rooms: 2-8 participants.
- Voice/video rooms: 2-4 participants.
- Screen sharing: 2-4 participants.

For larger rooms, use an SFU architecture instead of full mesh.

## File Transfer

Files are sent over a dedicated WebRTC data channel.

Recommendations:

- Keep `fileChunkSize` between 16 KiB and 64 KiB.
- Show transfer progress and failure states in the UI.
- Avoid assuming large transfers will survive tab sleep, mobile backgrounding, or network changes.
- Add application-level retry/resume if large files matter to your product.

## Media Permissions

Handle these cases in your app:

- User denies microphone or camera permission.
- Browser has no matching input device.
- Screen sharing is not supported on the platform.
- Track ends because the user stops sharing from browser chrome.

Listen for `error`, `localAudioStateChange`, `localVideoStateChange`, and `screenShareStateChange`.

## Reconnect Behavior

The signaling WebSocket can reconnect and rejoin a room with the same user ID. Existing peer connections are rebuilt after signaling restoration.

Set reconnect values based on product expectations:

```ts
reconnect: {
  maxAttempts: 5,
  delay: 3000,
  requestTimeoutMs: 30000,
}
```

## Diagnostics

Use `getConnectionSnapshot()` for support panels and smoke tests:

```ts
const snapshot = client.getConnectionSnapshot();
```

Use `waitForPeer(peerId)` before sending important direct messages:

```ts
await client.waitForPeer(peerId, { timeoutMs: 10000 });
client.sendMessageToPeer(peerId, payload);
```

## Deployment Checklist

- HTTPS and WSS are enabled.
- TURN credentials are configured and rotated safely.
- Room size limits are enforced by product UI or server policy.
- Errors are surfaced to users and collected by monitoring.
- Browser smoke tests cover at least Chromium.
- Safari/mobile behavior is manually verified when supported.
