# aves-core Troubleshooting

## Signaling Does Not Connect

Check:

- `signalingUrl` uses the right protocol: `ws://` locally, `wss://` in production.
- The signaling server accepts WebSocket upgrades.
- Reverse proxy timeouts are not closing idle WebSocket connections.
- Browser console does not show mixed-content errors.

## `joinRoom` Fails

Common causes:

- Room ID does not exist.
- The same user ID is already joined from another connection.
- The server rejected room password or capacity.
- The request timed out because the signaling server did not respond.

Listen to `error` and inspect `code`, `stage`, and `retryable`.

## DataChannel Never Opens

Check:

- Both peers are in the same room.
- ICE candidates are exchanged by the signaling server.
- TURN is configured for restrictive networks.
- Browser devtools WebRTC internals show selected candidate pairs.

Use:

```ts
const snapshot = client.getConnectionSnapshot();
console.log(snapshot.peers);
```

## ICE Fails

ICE failures usually mean peers cannot find a direct path.

Fixes:

- Add a TURN server.
- Verify TURN credentials.
- Test from different networks, not only localhost.
- Check firewalls and corporate proxy restrictions.

## Media Capture Fails

Check:

- Page is served over HTTPS.
- Browser permissions are granted.
- Device exists and is not already exclusively used.
- Safari/iOS support is acceptable for your target workflow.

## Screen Share Fails

Screen sharing may be unavailable in embedded browsers, older mobile browsers, or insecure contexts. Always feature-detect and show a fallback.

## File Transfer Stalls

Check:

- File data channel is open.
- File is not too large for the expected session length.
- Browser tab is not backgrounded or suspended.
- Progress events are being rendered in the UI.

## Reconnect Creates Duplicate UI State

Use stable user IDs when joining:

```ts
await client.joinRoom(roomId, userId, userName);
```

Clear application-level listeners on component unmount and call `client.destroy()` when the user exits the workflow.
