# aves-core: Video Calling & Screen Sharing — Implementation Plan

## Overview

Add video calling (camera) and screen sharing (`getDisplayMedia`) to aves-core.
Both features reuse the existing RTCPeerConnection infrastructure; the core work is adding
parallel video track management alongside the existing audio pipeline.

**Scope**: aves-core only. aves-node requires zero changes (it relays signaling, not media).

---

## 1. types/types.ts — New Types

Add the following types after `LocalAudioState` (around line 94):

```typescript
export interface LocalVideoState {
  active: boolean;
  muted: boolean; // video track enabled/disabled (camera on/off)
}

export type ScreenShareSource = "camera" | "screen";

export interface ScreenShareState {
  active: boolean;
  source: ScreenShareSource;
}

export interface AvesVideoConstraints {
  width?: number;
  height?: number;
  frameRate?: number;
  facingMode?: "user" | "environment";
  deviceId?: string;
}
```

What and why:
- `LocalVideoState` mirrors `LocalAudioState` — consistent API shape, caller already knows this pattern.
- `ScreenShareState` captures whether sharing is active and which source is live. Since camera and
  screen share a single video transceiver, `source` tells the caller what the remote side sees.
- `AvesVideoConstraints` accepts standard `getUserMedia` video constraints. Optional — omit to get
  browser defaults. We expose a named interface so callers get autocomplete and type checking,
  rather than passing a raw `MediaTrackConstraints` blob.

Update `AvesClientConfig` to accept optional video constraints:

```typescript
export interface AvesClientConfig {
  signalingUrl: string;
  iceServers?: RTCIceServer[];
  fileChunkSize?: number;
  video?: AvesVideoConstraints;  // <-- new
  reconnect?: {
    maxAttempts?: number;
    delay?: number;
  };
  debug?: boolean;
}
```

---

## 2. WebRTCManager.ts — New Video & Screen Share Pipeline

### 2.1 New private fields (add after existing audio fields, around line 109)

```typescript
// --- Video ---
private videoSenders: Map<string, RTCRtpSender | null>;
private remoteVideoStreams: Map<string, MediaStream>;
private localVideoStream: MediaStream | null;
private localVideoTrack: MediaStreamTrack | null;
private isVideoMuted: boolean;
private videoConstraints: AvesVideoConstraints;

// --- Screen Share ---
private screenShareStream: MediaStream | null;
private screenShareTrack: MediaStreamTrack | null;
private screenShareActive: boolean;
// Track the pre-screen-share camera track so we can restore it.
private cameraTrackBeforeShare: MediaStreamTrack | null;

// --- Callbacks ---
private remoteVideoTrackCallbacks: Set<
  (peerId: string, stream: MediaStream, track: MediaStreamTrack) => void
>;
private localVideoStateCallbacks: Set<(state: LocalVideoState) => void>;
private screenShareStateCallbacks: Set<(state: ScreenShareState) => void>;
```

Design notes:
- `videoSenders` is a `Map<string, RTCRtpSender | null>` (same pattern as `audioSenders`).
  Null means the transceiver was created but no track is attached yet.
- `cameraTrackBeforeShare` is necessary because when we start screen sharing, we replace the
  video sender's track with the display track. When screen sharing ends, we need to restore
  the camera track. Storing it explicitly avoids having to query `localVideoStream.getVideoTracks()[0]`
  which might have changed racefully.
- Callbacks follow the existing Set-based pattern — every method that registers a callback
  stores it in a Set, and when the event fires, we iterate the Set.

### 2.2 Constructor changes

Initialize the new fields in the constructor, around line 130-134:

```typescript
// --- Video ---
this.videoSenders = new Map();
this.remoteVideoStreams = new Map();
this.localVideoStream = null;
this.localVideoTrack = null;
this.isVideoMuted = false;
this.videoConstraints = {};

// --- Screen Share ---
this.screenShareStream = null;
this.screenShareTrack = null;
this.screenShareActive = false;
this.cameraTrackBeforeShare = null;

// --- Callbacks ---
this.remoteVideoTrackCallbacks = new Set();
this.localVideoStateCallbacks = new Set();
this.screenShareStateCallbacks = new Set();
```

The constructor should also accept `videoConstraints` as an optional third parameter:

```typescript
constructor(
  iceServers: RTCIceServer[],
  fileChunkSize = DEFAULT_FILE_CHUNK_SIZE,
  videoConstraints: AvesVideoConstraints = {},
) {
  // ... existing init ...
  this.videoConstraints = videoConstraints;
}
```

### 2.3 setupPeerConnection — Pre-create video transceiver

**This is the key architectural decision.** We pre-create a video transceiver alongside the
audio transceiver, even before `startVideo()` is called. Why: if we create the transceiver
on `startVideo()`, a new SDP negotiation is required. By pre-creating it, `startVideo()`
only needs `sender.replaceTrack()`, which is a lightweight operation that doesn't trigger
re-negotiation.

Modify `setupPeerConnection` (line 564-582). Replace the `pc.ontrack` handler and add the
video sender:

```typescript
pc.ontrack = (event) => {
  const stream =
    event.streams[0] ??
    (typeof MediaStream !== "undefined"
      ? new MediaStream([event.track])
      : (null as unknown as MediaStream));

  if (event.track.kind === "audio") {
    this.remoteAudioStreams.set(peerId, stream);
    this.remoteAudioTrackCallbacks.forEach((callback) =>
      callback(peerId, stream, event.track),
    );
  } else if (event.track.kind === "video") {
    // If this peer already had a video stream, add the new track to it.
    const existingStream = this.remoteVideoStreams.get(peerId);
    if (existingStream) {
      existingStream.getVideoTracks().forEach((t) => t.stop());
      existingStream.addTrack(event.track);
    } else {
      this.remoteVideoStreams.set(peerId, stream);
    }
    this.remoteVideoTrackCallbacks.forEach((callback) =>
      callback(peerId, stream, event.track),
    );
  }
};

this.audioSenders.set(peerId, this.createTransceiverSender(pc, "audio"));
this.videoSenders.set(peerId, this.createTransceiverSender(pc, "video"));
void this.syncLocalAudioTrack(peerId);
```

Notice: the key change to `ontrack` is that we now handle `track.kind === "video"` in addition
to `"audio"`. For video, we manage the stream in `remoteVideoStreams`. If a new video track
arrives for a peer that already had one (e.g., peer switched from camera to screen share),
we stop the old video tracks and replace with the new one. This is because we're using a single
video transceiver, so old tracks should be cleaned up.

Refactor `createAudioSender` into a generic `createTransceiverSender`:

```typescript
private createTransceiverSender(
  pc: RTCPeerConnection,
  kind: "audio" | "video",
): RTCRtpSender | null {
  const transceiverCapable = pc as RTCPeerConnection & {
    addTransceiver?: (
      trackOrKind: string | MediaStreamTrack,
      init?: RTCRtpTransceiverInit,
    ) => RTCRtpTransceiver;
  };

  if (typeof transceiverCapable.addTransceiver === "function") {
    const transceiver = transceiverCapable.addTransceiver(kind, {
      direction: "sendrecv",
    });
    return transceiver.sender;
  }

  return null;
}
```

Delete the old `createAudioSender` method (replaced by generic version).

### 2.4 startVideo() — Begin camera capture

```typescript
async startVideo(constraints?: AvesVideoConstraints): Promise<MediaStream> {
  // If already active, return the existing stream immediately (idempotent).
  if (this.localVideoStream && this.localVideoTrack) {
    this.emitLocalVideoState();
    return this.localVideoStream;
  }

  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== "function"
  ) {
    throw new Error("Video capture is not available in this environment");
  }

  const mergedConstraints = { ...this.videoConstraints, ...constraints };
  const stream = await navigator.mediaDevices.getUserMedia({
    video: mergedConstraints,
  });
  const [track] = stream.getVideoTracks();

  if (!track) {
    throw new Error("No video track available from getUserMedia");
  }

  track.enabled = !this.isVideoMuted;
  this.localVideoStream = stream;
  this.localVideoTrack = track;

  // If screen sharing is active, don't replace — screen share takes priority.
  // But we still store the track so it can be restored when screen share ends.
  if (!this.screenShareActive) {
    await Promise.all(
      this.getActivePeers().map((peerId) => this.syncLocalVideoTrack(peerId)),
    );
  }

  this.emitLocalVideoState();
  return stream;
}
```

Key behaviors:
- Idempotent: calling `startVideo()` twice returns the same stream.
- Respects screen share priority: if screen sharing is active, camera track is stored but
  not sent to peers. When screen sharing stops, the camera track is restored automatically.
- Constraints merging: constructor-level defaults + per-call overrides. Callers who want
  to change resolution mid-session call `startVideo({ width: 1920, height: 1080 })`.

### 2.5 stopVideo() — Stop camera capture

```typescript
stopVideo(): void {
  if (this.localVideoTrack) {
    // If we were showing camera (not screen share), detach from peers.
    if (!this.screenShareActive) {
      this.videoSenders.forEach((sender) => {
        if (sender && typeof sender.replaceTrack === "function") {
          void sender.replaceTrack(null);
        }
      });
    }

    this.localVideoTrack.stop();
  }

  if (this.localVideoStream) {
    this.localVideoStream.getTracks().forEach((track) => {
      if (track.readyState !== "ended") {
        track.stop();
      }
    });
  }

  this.localVideoTrack = null;
  this.localVideoStream = null;
  this.cameraTrackBeforeShare = null;
  this.emitLocalVideoState();
}
```

### 2.6 syncLocalVideoTrack — Mirror of syncLocalAudioTrack

```typescript
private async syncLocalVideoTrack(peerId: string): Promise<void> {
  const pc = this.peerConnections.get(peerId);
  if (!pc) {
    return;
  }

  let sender = this.videoSenders.get(peerId) ?? null;

  if (sender && typeof sender.replaceTrack === "function") {
    await sender.replaceTrack(this.localVideoTrack);
    return;
  }

  // Fallback: addTrack if replaceTrack not available (shouldn't happen with
  // modern browsers, but kept for safety).
  if (
    this.localVideoTrack &&
    typeof (pc as RTCPeerConnection & {
      addTrack?: (track: MediaStreamTrack, ...streams: MediaStream[]) => RTCRtpSender;
    }).addTrack === "function"
  ) {
    const addTrackCapable = pc as RTCPeerConnection & {
      addTrack: (track: MediaStreamTrack, ...streams: MediaStream[]) => RTCRtpSender;
    };
    const stream = this.localVideoStream ??
      (typeof MediaStream !== "undefined"
        ? new MediaStream([this.localVideoTrack])
        : undefined);

    sender = stream
      ? addTrackCapable.addTrack(this.localVideoTrack, stream)
      : addTrackCapable.addTrack(this.localVideoTrack);
    this.videoSenders.set(peerId, sender);
  }
}
```

### 2.7 startScreenShare() — Begin screen sharing

```typescript
async startScreenShare(): Promise<MediaStream> {
  if (this.screenShareActive && this.screenShareStream) {
    this.emitScreenShareState();
    return this.screenShareStream;
  }

  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getDisplayMedia !== "function"
  ) {
    throw new Error("Screen sharing is not available in this environment");
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  const [track] = stream.getVideoTracks();

  if (!track) {
    throw new Error("No video track available from getDisplayMedia");
  }

  // Save the current camera track so we can restore it when screen sharing stops.
  this.cameraTrackBeforeShare = this.localVideoTrack;

  // Switch the video sender to the display track.
  this.screenShareStream = stream;
  this.screenShareTrack = track;
  this.screenShareActive = true;

  await Promise.all(
    this.getActivePeers().map(async (peerId) => {
      const sender = this.videoSenders.get(peerId);
      if (sender && typeof sender.replaceTrack === "function") {
        await sender.replaceTrack(track);
      }
    }),
  );

  // IMPORTANT: Browser fires this when the user clicks "Stop sharing" in the
  // browser's share bar. We must listen and auto-restore.
  track.onended = () => {
    this.stopScreenShare();
  };

  this.emitScreenShareState();
  return stream;
}
```

`track.onended` is critical. When the user clicks the browser's native stop-sharing button,
the track ends. Without this handler, the remote side would see a frozen frame indefinitely.

### 2.8 stopScreenShare() — End screen sharing, restore camera

```typescript
stopScreenShare(): void {
  if (!this.screenShareActive) {
    return;
  }

  // Stop the display track.
  if (this.screenShareTrack) {
    this.screenShareTrack.stop();
  }
  if (this.screenShareStream) {
    this.screenShareStream.getTracks().forEach((track) => {
      if (track.readyState !== "ended") {
        track.stop();
      }
    });
  }

  this.screenShareStream = null;
  this.screenShareTrack = null;
  this.screenShareActive = false;

  // Restore the camera track, if it existed before screen sharing.
  const restoreTrack = this.cameraTrackBeforeShare;
  this.cameraTrackBeforeShare = null;

  if (restoreTrack && restoreTrack.readyState === "live") {
    this.localVideoTrack = restoreTrack;
    void Promise.all(
      this.getActivePeers().map(async (peerId) => {
        const sender = this.videoSenders.get(peerId);
        if (sender && typeof sender.replaceTrack === "function") {
          await sender.replaceTrack(restoreTrack);
        }
      }),
    );
  } else {
    // No camera to restore — detach video from peers.
    void Promise.all(
      this.getActivePeers().map(async (peerId) => {
        const sender = this.videoSenders.get(peerId);
        if (sender && typeof sender.replaceTrack === "function") {
          await sender.replaceTrack(null);
        }
      }),
    );
  }

  this.emitScreenShareState();
  this.emitLocalVideoState();
}
```

### 2.9 setVideoMuted — Toggle camera on/off

Mirrors `setMuted` (for audio):

```typescript
setVideoMuted(muted: boolean): void {
  this.isVideoMuted = muted;

  // Only toggle the camera track, not screen share track.
  // Screen sharing should never be "muted" — if the user wants to hide
  // their screen, they stop sharing entirely.
  if (this.localVideoTrack) {
    this.localVideoTrack.enabled = !muted;
  }

  this.emitLocalVideoState();
}
```

### 2.10 Getters

```typescript
getLocalVideoState(): LocalVideoState {
  return {
    active: !!this.localVideoTrack,
    muted: this.isVideoMuted,
  };
}

getScreenShareState(): ScreenShareState {
  return {
    active: this.screenShareActive,
    source: this.screenShareActive ? "screen" : "camera",
  };
}

getRemoteVideoStream(peerId: string): MediaStream | null {
  return this.remoteVideoStreams.get(peerId) ?? null;
}
```

### 2.11 Callback registration methods

These follow the exact same pattern as the existing audio/transfer callbacks:

```typescript
onRemoteVideoTrack(
  callback: (peerId: string, stream: MediaStream, track: MediaStreamTrack) => void,
): void {
  this.remoteVideoTrackCallbacks.add(callback);
}

onLocalVideoStateChange(callback: (state: LocalVideoState) => void): void {
  this.localVideoStateCallbacks.add(callback);
}

onScreenShareStateChange(callback: (state: ScreenShareState) => void): void {
  this.screenShareStateCallbacks.add(callback);
}
```

### 2.12 Emit helpers

```typescript
private emitLocalVideoState(): void {
  const state = this.getLocalVideoState();
  this.localVideoStateCallbacks.forEach((callback) => callback(state));
}

private emitScreenShareState(): void {
  const state = this.getScreenShareState();
  this.screenShareStateCallbacks.forEach((callback) => callback(state));
}
```

### 2.13 Cleanup — closePeerConnection, closeAll, destroy

`closePeerConnection` (line 470-492) needs to delete video-related per-peer state:

```typescript
closePeerConnection(peerId: string): void {
  // ... existing cleanup ...
  this.videoSenders.delete(peerId);         // new
  this.remoteVideoStreams.delete(peerId);   // new
  this.connectionStateCallbacks.delete(peerId);
  // ... remaining existing cleanup ...
}
```

`closeAll` calls `stopVoice()`. Add `stopVideo()` and `stopScreenShare()`:

```typescript
closeAll(): void {
  this.getActivePeers().forEach((peerId) => {
    this.closePeerConnection(peerId);
  });
  this.stopVoice();
  this.stopVideo();
  this.stopScreenShare();
}
```

`destroy` must clear the new callback sets:

```typescript
destroy(): void {
  this.closeAll();
  // ... existing callback clears ...
  this.remoteVideoTrackCallbacks.clear();    // new
  this.localVideoStateCallbacks.clear();     // new
  this.screenShareStateCallbacks.clear();    // new
}
```

---

## 3. AvesClient.ts — Public API

### 3.1 setupEventHandlers — Add video and screen share event forwarding

After the existing audio handler section (around line 188), add:

```typescript
this.webrtcManager.onRemoteVideoTrack(
  (peerId: string, stream: MediaStream, track: MediaStreamTrack) => {
    this.emit("remoteVideoTrack", peerId, stream, track);
  },
);

this.webrtcManager.onLocalVideoStateChange((state: LocalVideoState) => {
  this.emit("localVideoStateChange", state);
});

this.webrtcManager.onScreenShareStateChange((state: ScreenShareState) => {
  this.emit("screenShareStateChange", state);
});
```

### 3.2 New public methods

Add after the existing audio methods (after `setMuted` around line 378):

```typescript
// --- Video ---

async startVideo(constraints?: AvesVideoConstraints): Promise<MediaStream> {
  return this.webrtcManager.startVideo(constraints);
}

stopVideo(): void {
  this.webrtcManager.stopVideo();
}

setVideoMuted(muted: boolean): void {
  this.webrtcManager.setVideoMuted(muted);
}

getLocalVideoState(): LocalVideoState {
  return this.webrtcManager.getLocalVideoState();
}

getRemoteVideoStream(peerId: string): MediaStream | null {
  return this.webrtcManager.getRemoteVideoStream(peerId);
}

// --- Screen Share ---

async startScreenShare(): Promise<MediaStream> {
  return this.webrtcManager.startScreenShare();
}

stopScreenShare(): void {
  this.webrtcManager.stopScreenShare();
}

getScreenShareState(): ScreenShareState {
  return this.webrtcManager.getScreenShareState();
}
```

### 3.3 Import updates

Add to imports from `../types/types`:

```typescript
import {
  // ... existing imports ...
  LocalVideoState,
  ScreenShareState,
  AvesVideoConstraints,
} from "../types/types";
```

---

## 4. index.ts — Export new types

```typescript
export type {
  // ... existing exports ...
  LocalVideoState,
  ScreenShareState,
  ScreenShareSource,
  AvesVideoConstraints,
} from "./types/types";
```

---

## 5. Key Design Decisions (Why)

| Decision | Rationale |
|---|---|
| Pre-create video transceiver in `setupPeerConnection` | Avoids SDP re-negotiation when `startVideo()` is called. The transceiver exists from the moment the peer connection is created, and `replaceTrack` is a lightweight operation. |
| Screen share and camera share one video transceiver | Simpler SDP, less bandwidth negotiation complexity. Matches Google Meet behavior. If callers need both simultaneously, that can be a separate feature path with a second transceiver. |
| `cameraTrackBeforeShare` stored explicitly, not queried from stream | `localVideoStream.getVideoTracks()[0]` is racy — the stream may have been stopped or replaced between share start and share end. Explicit storage is deterministic. |
| `track.onended` handler in `startScreenShare` | The browser's native stop-sharing button fires `ended` on the track. Without this handler, peers would see a frozen last frame indefinitely. |
| Separate `setMuted` (audio) and `setVideoMuted` (video) | Avoids ambiguity. A single `setMuted` controlling both would require additional state tracking (did the user want to mute both, or just one?). Clarity over brevity. |
| Idempotent `startVoice`/`startVideo`/`startScreenShare` | If the caller calls `startVideo()` twice (e.g., from different UI paths), it should not create a second getUserMedia prompt or crash. Return the existing stream. |
| Video constraints merging: constructor + call arguments | Constructor sets defaults (e.g., `{ width: 640, height: 480 }`). Call arguments override per invocation. Standard pattern — `Object.assign` semantics. |

---

## 6. Change Summary

| File | Lines changed | New methods/types |
|---|---|---|
| `types/types.ts` | +25 | `LocalVideoState`, `ScreenShareState`, `ScreenShareSource`, `AvesVideoConstraints`, update to `AvesClientConfig` |
| `WebRTCManager.ts` | +180 | `startVideo`, `stopVideo`, `setVideoMuted`, `getLocalVideoState`, `getRemoteVideoStream`, `startScreenShare`, `stopScreenShare`, `getScreenShareState`, `syncLocalVideoTrack`, `emitLocalVideoState`, `emitScreenShareState`, `onRemoteVideoTrack`, `onLocalVideoStateChange`, `onScreenShareStateChange` |
| `AvesClient.ts` | +50 | Delegation wrappers for all new methods, new event forwarding in `setupEventHandlers` |
| `index.ts` | +4 | New type exports |
| **Total** | **~260 lines** | |

No changes needed in: aves-node, SignalingClient, EventEmitter, webrtc-demo.

---

## 7. Suggested Implementation Order

1. **types/types.ts** — define new types first (all downstream files import from here).
2. **WebRTCManager.ts** — add fields, constructor init, `setupPeerConnection` changes,
   then `startVideo`/`stopVideo`, then `startScreenShare`/`stopScreenShare`, then
   cleanup changes, then getters and callback methods last.
3. **AvesClient.ts** — add imports, event forwarding, public delegation methods.
4. **index.ts** — add type exports.
5. **Build & test** — `npm run build && npm test` to verify nothing broke.
6. **Add tests** — unit tests for `startVideo`/`stopVideo`/`startScreenShare`/`stopScreenShare`
   in `WebRTCManager.test.ts` and `AvesClient.test.ts`, property tests as follow-up.
