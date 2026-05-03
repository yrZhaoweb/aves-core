import { AvesError } from "../AvesError";
import {
  AvesVideoConstraints,
  LocalAudioState,
  LocalVideoState,
  ScreenShareState,
} from "../../types/types";

/**
 * Browser API extension types — methods that exist at runtime but are not yet
 * fully reflected in TypeScript's lib.dom.d.ts for RTCPeerConnection.
 * Intersection types allow the optional override that `interface extends` cannot.
 */
type PeerConnectionWithAddTrack = RTCPeerConnection & {
  addTrack?: (track: MediaStreamTrack, ...streams: MediaStream[]) => RTCRtpSender;
};

type PeerConnectionWithAddTransceiver = RTCPeerConnection & {
  addTransceiver?: (
    trackOrKind: string | MediaStreamTrack,
    init?: RTCRtpTransceiverInit,
  ) => RTCRtpTransceiver;
};

export class MediaTrackManager {
  readonly audioSenders = new Map<string, RTCRtpSender | null>();
  readonly remoteAudioStreams = new Map<string, MediaStream>();
  readonly videoSenders = new Map<string, RTCRtpSender | null>();
  readonly remoteVideoStreams = new Map<string, MediaStream>();

  private localAudioStream: MediaStream | null = null;
  private localAudioTrack: MediaStreamTrack | null = null;
  private isMuted = false;
  private localVideoStream: MediaStream | null = null;
  private localVideoTrack: MediaStreamTrack | null = null;
  private isVideoMuted = false;
  private readonly videoConstraints: AvesVideoConstraints;
  private screenShareStream: MediaStream | null = null;
  private screenShareTrack: MediaStreamTrack | null = null;
  private screenShareActive = false;
  private cameraTrackBeforeShare: MediaStreamTrack | null = null;
  readonly remoteAudioTrackCallbacks = new Set<
    (peerId: string, stream: MediaStream, track: MediaStreamTrack) => void
  >();
  readonly localAudioStateCallbacks = new Set<
    (state: LocalAudioState) => void
  >();
  readonly remoteVideoTrackCallbacks = new Set<
    (peerId: string, stream: MediaStream, track: MediaStreamTrack) => void
  >();
  readonly localVideoStateCallbacks = new Set<
    (state: LocalVideoState) => void
  >();
  readonly screenShareStateCallbacks = new Set<
    (state: ScreenShareState) => void
  >();

  constructor(
    private readonly peerConnections: Map<string, RTCPeerConnection>,
    private readonly getActivePeers: () => string[],
    videoConstraints: AvesVideoConstraints = {},
  ) {
    this.videoConstraints = videoConstraints;
  }

  bindPeerConnection(peerId: string, pc: RTCPeerConnection): void {
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
        const existingStream = this.remoteVideoStreams.get(peerId);
        if (existingStream) {
          existingStream.getVideoTracks().forEach((track) => track.stop());
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
  }

  async startVoice(): Promise<MediaStream> {
    if (this.localAudioStream && this.localAudioTrack) {
      this.emitLocalAudioState();
      return this.localAudioStream;
    }

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== "function"
    ) {
      throw new AvesError({
        message: "Audio capture is not available in this environment",
        code: "MEDIA_NOT_AVAILABLE",
        stage: "transport",
        retryable: false,
      });
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const [track] = stream.getAudioTracks();

    if (!track) {
      throw new AvesError({
        message: "No audio track available from getUserMedia",
        code: "MEDIA_CAPTURE_FAILED",
        stage: "transport",
        retryable: false,
      });
    }

    track.enabled = !this.isMuted;
    this.localAudioStream = stream;
    this.localAudioTrack = track;

    await Promise.all(
      this.getActivePeers().map((peerId) => this.syncLocalAudioTrack(peerId)),
    );

    this.emitLocalAudioState();
    return stream;
  }

  stopVoice(): void {
    if (this.localAudioTrack) {
      this.audioSenders.forEach((sender) => {
        if (sender && typeof sender.replaceTrack === "function") {
          void sender.replaceTrack(null);
        }
      });

      this.localAudioTrack.stop();
    }

    if (this.localAudioStream) {
      this.localAudioStream.getTracks().forEach((track) => {
        if (track.readyState !== "ended") {
          track.stop();
        }
      });
    }

    this.localAudioTrack = null;
    this.localAudioStream = null;
    this.emitLocalAudioState();
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;

    if (this.localAudioTrack) {
      this.localAudioTrack.enabled = !muted;
    }

    this.emitLocalAudioState();
  }

  getLocalAudioState(): LocalAudioState {
    return {
      active: !!this.localAudioTrack,
      muted: this.isMuted,
    };
  }

  getRemoteAudioStream(peerId: string): MediaStream | null {
    return this.remoteAudioStreams.get(peerId) ?? null;
  }

  async startVideo(constraints?: AvesVideoConstraints): Promise<MediaStream> {
    if (this.localVideoStream && this.localVideoTrack) {
      this.emitLocalVideoState();
      return this.localVideoStream;
    }

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== "function"
    ) {
      throw new AvesError({
        message: "Video capture is not available in this environment",
        code: "MEDIA_NOT_AVAILABLE",
        stage: "transport",
        retryable: false,
      });
    }

    const mergedConstraints = { ...this.videoConstraints, ...constraints };
    const stream = await navigator.mediaDevices.getUserMedia({
      video: mergedConstraints,
    });
    const [track] = stream.getVideoTracks();

    if (!track) {
      throw new AvesError({
        message: "No video track available from getUserMedia",
        code: "MEDIA_CAPTURE_FAILED",
        stage: "transport",
        retryable: false,
      });
    }

    track.enabled = !this.isVideoMuted;
    this.localVideoStream = stream;
    this.localVideoTrack = track;

    if (!this.screenShareActive) {
      await Promise.all(
        this.getActivePeers().map((peerId) => this.syncLocalVideoTrack(peerId)),
      );
    }

    this.emitLocalVideoState();
    return stream;
  }

  stopVideo(): void {
    if (this.localVideoTrack) {
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

  setVideoMuted(muted: boolean): void {
    this.isVideoMuted = muted;

    if (this.localVideoTrack) {
      this.localVideoTrack.enabled = !muted;
    }

    this.emitLocalVideoState();
  }

  getLocalVideoState(): LocalVideoState {
    return {
      active: !!this.localVideoTrack,
      muted: this.isVideoMuted,
    };
  }

  getRemoteVideoStream(peerId: string): MediaStream | null {
    return this.remoteVideoStreams.get(peerId) ?? null;
  }

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
      throw new AvesError({
        message: "Screen sharing is not available in this environment",
        code: "MEDIA_NOT_AVAILABLE",
        stage: "transport",
        retryable: false,
      });
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
    });
    const [track] = stream.getVideoTracks();

    if (!track) {
      throw new AvesError({
        message: "No video track available from getDisplayMedia",
        code: "MEDIA_CAPTURE_FAILED",
        stage: "transport",
        retryable: false,
      });
    }

    this.cameraTrackBeforeShare = this.localVideoTrack;

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

    track.onended = () => {
      this.stopScreenShare();
    };

    this.emitScreenShareState();
    return stream;
  }

  stopScreenShare(): void {
    if (!this.screenShareActive) {
      return;
    }

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

  getScreenShareState(): ScreenShareState {
    return {
      active: this.screenShareActive,
      source: this.screenShareActive ? "screen" : "camera",
    };
  }

  onRemoteAudioTrack(
    callback: (peerId: string, stream: MediaStream, track: MediaStreamTrack) => void,
  ): void {
    this.remoteAudioTrackCallbacks.add(callback);
  }

  onLocalAudioStateChange(callback: (state: LocalAudioState) => void): void {
    this.localAudioStateCallbacks.add(callback);
  }

  onRemoteVideoTrack(
    callback: (
      peerId: string,
      stream: MediaStream,
      track: MediaStreamTrack,
    ) => void,
  ): void {
    this.remoteVideoTrackCallbacks.add(callback);
  }

  onLocalVideoStateChange(callback: (state: LocalVideoState) => void): void {
    this.localVideoStateCallbacks.add(callback);
  }

  onScreenShareStateChange(callback: (state: ScreenShareState) => void): void {
    this.screenShareStateCallbacks.add(callback);
  }

  closePeer(peerId: string): void {
    this.audioSenders.delete(peerId);
    this.remoteAudioStreams.delete(peerId);
    this.videoSenders.delete(peerId);
    this.remoteVideoStreams.delete(peerId);
  }

  clearCallbacks(): void {
    this.remoteAudioTrackCallbacks.clear();
    this.localAudioStateCallbacks.clear();
    this.remoteVideoTrackCallbacks.clear();
    this.localVideoStateCallbacks.clear();
    this.screenShareStateCallbacks.clear();
  }

  private createTransceiverSender(
    pc: RTCPeerConnection,
    kind: "audio" | "video",
  ): RTCRtpSender | null {
    const capable = pc as PeerConnectionWithAddTransceiver;

    if (typeof capable.addTransceiver === "function") {
      const transceiver = capable.addTransceiver(kind, {
        direction: "sendrecv",
      });
      return transceiver.sender;
    }

    return null;
  }

  private async syncLocalAudioTrack(peerId: string): Promise<void> {
    const pc = this.peerConnections.get(peerId);
    if (!pc) {
      return;
    }

    let sender = this.audioSenders.get(peerId) ?? null;

    if (sender && typeof sender.replaceTrack === "function") {
      await sender.replaceTrack(this.localAudioTrack);
      return;
    }

    const addTrackCapable = pc as PeerConnectionWithAddTrack;

    if (
      this.localAudioTrack &&
      typeof addTrackCapable.addTrack === "function"
    ) {
      const stream =
        this.localAudioStream ??
        (typeof MediaStream !== "undefined"
          ? new MediaStream([this.localAudioTrack])
          : undefined);

      sender = stream
        ? addTrackCapable.addTrack!(this.localAudioTrack, stream)
        : addTrackCapable.addTrack!(this.localAudioTrack);
      this.audioSenders.set(peerId, sender);
    }
  }

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

    const addTrackCapable = pc as PeerConnectionWithAddTrack;

    if (
      this.localVideoTrack &&
      typeof addTrackCapable.addTrack === "function"
    ) {
      const stream =
        this.localVideoStream ??
        (typeof MediaStream !== "undefined"
          ? new MediaStream([this.localVideoTrack])
          : undefined);

      sender = stream
        ? addTrackCapable.addTrack!(this.localVideoTrack, stream)
        : addTrackCapable.addTrack!(this.localVideoTrack);
      this.videoSenders.set(peerId, sender);
    }
  }

  private emitLocalAudioState(): void {
    const state = this.getLocalAudioState();
    this.localAudioStateCallbacks.forEach((callback) => callback(state));
  }

  private emitLocalVideoState(): void {
    const state = this.getLocalVideoState();
    this.localVideoStateCallbacks.forEach((callback) => callback(state));
  }

  private emitScreenShareState(): void {
    const state = this.getScreenShareState();
    this.screenShareStateCallbacks.forEach((callback) => callback(state));
  }
}
