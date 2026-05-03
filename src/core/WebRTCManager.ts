import { AvesError } from "./AvesError";
import {
  AvesMessage,
  AvesVideoConstraints,
  FileTransferInfo,
  FileTransferOptions,
  FileTransferProgress,
  FileTransferResult,
  LocalAudioState,
  LocalVideoState,
  ScreenShareState,
} from "../types/types";
import {
  FILE_CHANNEL_LABEL,
  MESSAGE_CHANNEL_LABEL,
  PeerChannels,
  getChannelKind,
  isPeerChannels,
  normalizePeerChannels,
} from "./webrtc/channels";
import {
  DEFAULT_FILE_CHUNK_SIZE,
  FileControlMessage,
  FileTransferManager,
  IncomingTransfer,
  OutgoingTransfer,
  ReadyResolver,
  isFileControlMessage,
} from "./webrtc/fileTransfer";
import { MediaTrackManager } from "./webrtc/mediaTracks";
import { errorMessage, serializeUserMessage } from "./webrtc/messages";

/**
 * WebRTCManager - Manages WebRTC PeerConnections, DataChannels, and media tracks
 */
export class WebRTCManager {
  private peerConnections: Map<string, RTCPeerConnection>;
  private dataChannels: Map<string, PeerChannels>;
  private iceServers: RTCIceServer[];
  private fileTransfers: FileTransferManager;
  private messageCallbacks: Set<(peerId: string, message: AvesMessage) => void>;
  private connectionStateCallbacks: Map<
    string,
    Set<(state: RTCPeerConnectionState) => void>
  >;
  private dataChannelStateCallbacks: Map<
    string,
    Set<(state: RTCDataChannelState) => void>
  >;
  private iceCandidateCallbacks: Map<
    string,
    Set<(candidate: RTCIceCandidateInit) => void>
  >;
  private outgoingTransfers: Map<string, OutgoingTransfer>;
  private incomingTransfers: Map<string, IncomingTransfer>;
  private readyResolvers: Map<string, ReadyResolver>;
  private completionResolvers: Map<string, ReadyResolver>;
  private fileTransferStartedCallbacks: Set<
    (peerId: string, info: FileTransferInfo) => void
  >;
  private fileTransferProgressCallbacks: Set<
    (peerId: string, progress: FileTransferProgress) => void
  >;
  private fileTransferCompletedCallbacks: Set<
    (peerId: string, result: FileTransferResult) => void
  >;
  private fileTransferFailedCallbacks: Set<
    (peerId: string, info: FileTransferInfo | null, error: AvesError) => void
  >;
  private mediaTracks: MediaTrackManager;
  private videoSenders: Map<string, RTCRtpSender | null>;
  private remoteAudioTrackCallbacks: Set<
    (peerId: string, stream: MediaStream, track: MediaStreamTrack) => void
  >;
  private localAudioStateCallbacks: Set<(state: LocalAudioState) => void>;
  private remoteVideoTrackCallbacks: Set<
    (peerId: string, stream: MediaStream, track: MediaStreamTrack) => void
  >;
  private localVideoStateCallbacks: Set<(state: LocalVideoState) => void>;
  private screenShareStateCallbacks: Set<(state: ScreenShareState) => void>;

  // --- Error Callbacks ---
  private errorCallbacks: Set<(error: AvesError) => void>;

  constructor(
    iceServers: RTCIceServer[],
    fileChunkSize = DEFAULT_FILE_CHUNK_SIZE,
    videoConstraints: AvesVideoConstraints = {},
  ) {
    this.peerConnections = new Map();
    this.dataChannels = new Map();
    this.iceServers = iceServers;
    this.fileTransfers = new FileTransferManager({
      fileChunkSize,
      getActivePeers: () => this.getActivePeers(),
      isFileChannelReady: (peerId) => this.isFileChannelReady(peerId),
      getMessageChannel: (peerId) => this.getMessageChannel(peerId),
      getFileChannel: (peerId) => this.getFileChannel(peerId),
    });
    this.messageCallbacks = new Set();
    this.connectionStateCallbacks = new Map();
    this.dataChannelStateCallbacks = new Map();
    this.iceCandidateCallbacks = new Map();
    this.outgoingTransfers = this.fileTransfers.outgoingTransfers;
    this.incomingTransfers = this.fileTransfers.incomingTransfers;
    this.readyResolvers = this.fileTransfers.readyResolvers;
    this.completionResolvers = this.fileTransfers.completionResolvers;
    this.fileTransferStartedCallbacks =
      this.fileTransfers.fileTransferStartedCallbacks;
    this.fileTransferProgressCallbacks =
      this.fileTransfers.fileTransferProgressCallbacks;
    this.fileTransferCompletedCallbacks =
      this.fileTransfers.fileTransferCompletedCallbacks;
    this.fileTransferFailedCallbacks =
      this.fileTransfers.fileTransferFailedCallbacks;
    this.mediaTracks = new MediaTrackManager(
      this.peerConnections,
      () => this.getActivePeers(),
      videoConstraints,
    );
    this.videoSenders = this.mediaTracks.videoSenders;
    this.remoteAudioTrackCallbacks = this.mediaTracks.remoteAudioTrackCallbacks;
    this.localAudioStateCallbacks = this.mediaTracks.localAudioStateCallbacks;
    this.remoteVideoTrackCallbacks = this.mediaTracks.remoteVideoTrackCallbacks;
    this.localVideoStateCallbacks = this.mediaTracks.localVideoStateCallbacks;
    this.screenShareStateCallbacks = this.mediaTracks.screenShareStateCallbacks;
    this.errorCallbacks = new Set();
  }

  /**
   * Create a new PeerConnection for the specified peer.
   * If a connection already exists, returns the existing connection.
   */
  createPeerConnection(peerId: string): RTCPeerConnection {
    const existing = this.peerConnections.get(peerId);
    if (existing) {
      return existing;
    }

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
    });

    this.peerConnections.set(peerId, pc);
    this.dataChannels.set(peerId, {});
    this.setupPeerConnection(peerId, pc);

    return pc;
  }

  /**
   * Create an offer for the specified peer.
   * The offer side creates both the message and file channels.
   */
  async createOffer(peerId: string): Promise<RTCSessionDescriptionInit> {
    const pc = this.getPeerConnection(peerId);

    this.ensureDataChannel(peerId, pc, MESSAGE_CHANNEL_LABEL);
    this.ensureDataChannel(peerId, pc, FILE_CHANNEL_LABEL);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    return offer;
  }

  /**
   * Create an answer for the specified peer.
   * The answer side receives data channels from the remote offer.
   */
  async createAnswer(
    peerId: string,
    offer: RTCSessionDescriptionInit,
  ): Promise<RTCSessionDescriptionInit> {
    const pc = this.getPeerConnection(peerId);

    pc.ondatachannel = (event) => {
      this.setupDataChannel(peerId, event.channel);
    };

    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    return answer;
  }

  /**
   * Set the remote answer for the specified peer.
   */
  async setRemoteAnswer(
    peerId: string,
    answer: RTCSessionDescriptionInit,
  ): Promise<void> {
    const pc = this.getPeerConnection(peerId);
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  /**
   * Add an ICE candidate for the specified peer.
   */
  async addIceCandidate(
    peerId: string,
    candidate: RTCIceCandidateInit,
  ): Promise<void> {
    const pc = this.getPeerConnection(peerId);
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  /**
   * Send a JSON message to all connected peers.
   * Peers with unavailable channels are skipped gracefully;
   * the message is delivered to every ready peer.
   */
  sendMessage(message: AvesMessage): void {
    const payload = serializeUserMessage(message);

    this.dataChannels.forEach((storedChannels, peerId) => {
      const channels = normalizePeerChannels(storedChannels);

      if (!channels.message || channels.message.readyState !== "open") {
        return;
      }

      try {
        channels.message.send(payload);
      } catch (error) {
        this.emitError(
          new AvesError({ message: `Failed to send message to ${peerId}: ${errorMessage(error)}`, code: "MESSAGE_SEND_FAILED", stage: "transport", retryable: true, peerId }),
        );
      }
    });
  }

  /**
   * Send a JSON message to a specific peer.
   */
  sendMessageToPeer(peerId: string, message: AvesMessage): void {
    const dataChannel = this.getMessageChannel(peerId);

    if (dataChannel.readyState !== "open") {
      throw new AvesError({ message: `DataChannel not ready for ${peerId}, state: ${dataChannel.readyState}`, code: "MESSAGE_CHANNEL_NOT_READY", stage: "transport", retryable: true, peerId });
    }

    dataChannel.send(serializeUserMessage(message));
  }

  /**
   * Send a file to one peer or broadcast to every connected peer.
   */
  async sendFile(
    blob: Blob,
    options: FileTransferOptions = {},
  ): Promise<FileTransferInfo[]> {
    return this.fileTransfers.sendFile(blob, options);
  }

  /**
   * Start capturing local audio and bind it to current peer connections.
   */
  async startVoice(): Promise<MediaStream> {
    return this.mediaTracks.startVoice();
  }

  /**
   * Stop local audio capture and detach it from active peers.
   */
  stopVoice(): void {
    this.mediaTracks.stopVoice();
  }

  /**
   * Toggle local mute state.
   */
  setMuted(muted: boolean): void {
    this.mediaTracks.setMuted(muted);
  }

  /**
   * Read current local audio state.
   */
  getLocalAudioState(): LocalAudioState {
    return this.mediaTracks.getLocalAudioState();
  }

  /**
   * Read current remote audio stream for a peer.
   */
  getRemoteAudioStream(peerId: string): MediaStream | null {
    return this.mediaTracks.getRemoteAudioStream(peerId);
  }

  // ========== Video Methods ==========

  /**
   * Start capturing local camera video and bind it to current peer connections.
   * Idempotent: returns the existing stream if already active.
   */
  async startVideo(constraints?: AvesVideoConstraints): Promise<MediaStream> {
    return this.mediaTracks.startVideo(constraints);
  }

  /**
   * Stop local camera capture and detach it from active peers.
   */
  stopVideo(): void {
    this.mediaTracks.stopVideo();
  }

  /**
   * Toggle local video mute state (camera on/off).
   */
  setVideoMuted(muted: boolean): void {
    this.mediaTracks.setVideoMuted(muted);
  }

  /**
   * Read current local video state.
   */
  getLocalVideoState(): LocalVideoState {
    return this.mediaTracks.getLocalVideoState();
  }

  /**
   * Read current remote video stream for a peer.
   */
  getRemoteVideoStream(peerId: string): MediaStream | null {
    return this.mediaTracks.getRemoteVideoStream(peerId);
  }

  // ========== Screen Share Methods ==========

  /**
   * Start screen sharing. Replaces the camera video track with the display track
   * on all active peer connections. The camera track is saved and restored when
   * screen sharing stops.
   */
  async startScreenShare(): Promise<MediaStream> {
    return this.mediaTracks.startScreenShare();
  }

  /**
   * Stop screen sharing and restore the camera video track (if it was active).
   */
  stopScreenShare(): void {
    this.mediaTracks.stopScreenShare();
  }

  /**
   * Read current screen share state.
   */
  getScreenShareState(): ScreenShareState {
    return this.mediaTracks.getScreenShareState();
  }

  // ========== Video / Screen Share Callback Registration ==========

  /**
   * Register a callback for remote video tracks.
   */
  onRemoteVideoTrack(
    callback: (
      peerId: string,
      stream: MediaStream,
      track: MediaStreamTrack,
    ) => void,
  ): void {
    this.mediaTracks.onRemoteVideoTrack(callback);
  }

  /**
   * Register a callback for local video state changes.
   */
  onLocalVideoStateChange(
    callback: (state: LocalVideoState) => void,
  ): void {
    this.mediaTracks.onLocalVideoStateChange(callback);
  }

  /**
   * Register a callback for screen share state changes.
   */
  onScreenShareStateChange(
    callback: (state: ScreenShareState) => void,
  ): void {
    this.mediaTracks.onScreenShareStateChange(callback);
  }

  // ========== Error Callback Registration ==========

  /**
   * Register a callback for WebRTCManager-level errors
   * (e.g. DataChannel failures, message parse errors).
   */
  onError(callback: (error: AvesError) => void): void {
    this.errorCallbacks.add(callback);
  }

  // ========== Emit Helpers ==========

  private emitError(error: AvesError): void {
    this.errorCallbacks.forEach((callback) => callback(error));
  }

  /**
   * Register a callback for ICE candidates from the specified peer.
   */
  onIceCandidate(
    peerId: string,
    callback: (candidate: RTCIceCandidateInit) => void,
  ): void {
    // Ensure the peer connection exists
    this.getPeerConnection(peerId);

    let callbacks = this.iceCandidateCallbacks.get(peerId);
    if (!callbacks) {
      callbacks = new Set();
      this.iceCandidateCallbacks.set(peerId, callbacks);
    }
    callbacks.add(callback);
  }

  /**
   * Register a callback for connection state changes.
   */
  onConnectionStateChange(
    peerId: string,
    callback: (state: RTCPeerConnectionState) => void,
  ): void {
    let callbacks = this.connectionStateCallbacks.get(peerId);
    if (!callbacks) {
      callbacks = new Set();
      this.connectionStateCallbacks.set(peerId, callbacks);
    }
    callbacks.add(callback);
  }

  /**
   * Register a callback for main DataChannel state changes.
   */
  onDataChannelStateChange(
    peerId: string,
    callback: (state: RTCDataChannelState) => void,
  ): void {
    let callbacks = this.dataChannelStateCallbacks.get(peerId);
    if (!callbacks) {
      callbacks = new Set();
      this.dataChannelStateCallbacks.set(peerId, callbacks);
    }
    callbacks.add(callback);
  }

  /**
   * Register a callback for incoming user messages.
   */
  onMessage(callback: (peerId: string, message: AvesMessage) => void): void {
    this.messageCallbacks.add(callback);
  }

  onFileTransferStarted(
    callback: (peerId: string, info: FileTransferInfo) => void,
  ): void {
    this.fileTransfers.onStarted(callback);
  }

  onFileTransferProgress(
    callback: (peerId: string, progress: FileTransferProgress) => void,
  ): void {
    this.fileTransfers.onProgress(callback);
  }

  onFileTransferCompleted(
    callback: (peerId: string, result: FileTransferResult) => void,
  ): void {
    this.fileTransfers.onCompleted(callback);
  }

  onFileTransferFailed(
    callback: (peerId: string, info: FileTransferInfo | null, error: AvesError) => void,
  ): void {
    this.fileTransfers.onFailed(callback);
  }

  onRemoteAudioTrack(
    callback: (peerId: string, stream: MediaStream, track: MediaStreamTrack) => void,
  ): void {
    this.mediaTracks.onRemoteAudioTrack(callback);
  }

  onLocalAudioStateChange(callback: (state: LocalAudioState) => void): void {
    this.mediaTracks.onLocalAudioStateChange(callback);
  }

  /**
   * Close the connection with a specific peer.
   */
  closePeerConnection(peerId: string): void {
    this.failActiveTransfers(peerId, new AvesError({ message: `Peer connection closed for ${peerId}`, code: "WEBRTC_CONNECTION_FAILED", stage: "transport", retryable: false, peerId }));
    const channels = normalizePeerChannels(this.dataChannels.get(peerId));
    channels?.message?.close();
    channels?.file?.close();
    this.dataChannels.delete(peerId);

    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerId);
    }

    this.clearReadyResolver(peerId);
    this.clearCompletionResolver(peerId);
    this.outgoingTransfers.delete(peerId);
    this.incomingTransfers.delete(peerId);
    this.mediaTracks.closePeer(peerId);
    this.connectionStateCallbacks.delete(peerId);
    this.dataChannelStateCallbacks.delete(peerId);
    this.iceCandidateCallbacks.delete(peerId);
  }

  /**
   * Close all connections and clean up resources.
   */
  closeAll(): void {
    this.getActivePeers().forEach((peerId) => {
      this.closePeerConnection(peerId);
    });
    this.stopVoice();
    this.stopVideo();
    this.stopScreenShare();
  }

  destroy(): void {
    this.closeAll();
    this.messageCallbacks.clear();
    this.fileTransfers.clearCallbacks();
    this.mediaTracks.clearCallbacks();
    this.errorCallbacks.clear();
  }

  /**
   * Get all active peer IDs.
   */
  getActivePeers(): string[] {
    return Array.from(this.peerConnections.keys());
  }

  /**
   * Check if connected to a specific peer.
   */
  isConnected(peerId: string): boolean {
    const pc = this.peerConnections.get(peerId);
    return pc?.connectionState === "connected";
  }

  /**
   * Get the actual RTCPeerConnectionState for a peer.
   */
  getConnectionState(peerId: string): RTCPeerConnectionState {
    const pc = this.peerConnections.get(peerId);
    return pc?.connectionState ?? "closed";
  }

  /**
   * Check if the main DataChannel is ready for a specific peer.
   */
  isDataChannelReady(peerId: string): boolean {
    return (
      normalizePeerChannels(this.dataChannels.get(peerId)).message
        ?.readyState === "open"
    );
  }

  /**
   * Check if the file channel is ready for a specific peer.
   */
  isFileChannelReady(peerId: string): boolean {
    return (
      normalizePeerChannels(this.dataChannels.get(peerId)).file
        ?.readyState === "open"
    );
  }

  private setupPeerConnection(peerId: string, pc: RTCPeerConnection): void {
    pc.onconnectionstatechange = () => {
      const callbacks = this.connectionStateCallbacks.get(peerId);
      callbacks?.forEach((callback) => callback(pc.connectionState));

      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "closed" ||
        pc.connectionState === "disconnected"
      ) {
        this.closePeerConnection(peerId);
      }
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      const callbacks = this.iceCandidateCallbacks.get(peerId);
      callbacks?.forEach((cb) => cb(event.candidate!.toJSON()));
    };

    this.mediaTracks.bindPeerConnection(peerId, pc);
  }

  private ensureDataChannel(
    peerId: string,
    pc: RTCPeerConnection,
    label: typeof MESSAGE_CHANNEL_LABEL | typeof FILE_CHANNEL_LABEL,
  ): RTCDataChannel {
    const channels = this.dataChannels.get(peerId) ?? {};
    const kind = getChannelKind(label);
    const existing = channels[kind];

    if (existing) {
      return existing;
    }

    const channel = pc.createDataChannel(label);
    this.setupDataChannel(peerId, channel);
    return channel;
  }

  private setupDataChannel(peerId: string, dataChannel: RTCDataChannel): void {
    const kind = getChannelKind(dataChannel.label);
    const channels = normalizePeerChannels(this.dataChannels.get(peerId));
    channels[kind] = dataChannel;
    this.dataChannels.set(peerId, channels);

    if (kind === "file") {
      dataChannel.binaryType = "arraybuffer";
    }

    dataChannel.onopen = () => {
      if (kind !== "message") {
        return;
      }

      const callbacks = this.dataChannelStateCallbacks.get(peerId);
      callbacks?.forEach((callback) => callback(dataChannel.readyState));
    };

    dataChannel.onclose = () => {
      if (kind === "message") {
        const callbacks = this.dataChannelStateCallbacks.get(peerId);
        callbacks?.forEach((callback) => callback(dataChannel.readyState));
      }

      const storedChannels = this.dataChannels.get(peerId);
      if (storedChannels && isPeerChannels(storedChannels) && storedChannels[kind] === dataChannel) {
        delete storedChannels[kind];
        if (!storedChannels.message && !storedChannels.file) {
          this.dataChannels.delete(peerId);
        }
      }

      if (kind === "message" || kind === "file") {
        this.failActiveTransfers(
          peerId,
          new AvesError({ message: `${kind} channel closed during file transfer`, code: "WEBRTC_DATACHANNEL_FAILED", stage: "transport", retryable: true, peerId }),
        );
      }
    };

    dataChannel.onerror = (error) => {
      this.emitError(
        new AvesError({ message: `DataChannel error with ${peerId}: ${errorMessage(error)}`, code: "WEBRTC_DATACHANNEL_FAILED", stage: "transport", retryable: true, peerId }),
      );
      const transfer =
        kind === "file"
          ? this.outgoingTransfers.get(peerId) ?? this.incomingTransfers.get(peerId) ?? null
          : null;
      if (transfer) {
        this.emitFileTransferFailed(
          peerId,
          transfer,
          new AvesError({ message: `DataChannel error on ${kind} channel`, code: "WEBRTC_DATACHANNEL_FAILED", stage: "transport", retryable: true, peerId }),
        );
      }
    };

    dataChannel.onmessage = (event) => {
      if (kind === "file") {
        this.handleFileChunk(peerId, event.data);
        return;
      }

      this.handleMessageChannelMessage(peerId, event.data);
    };
  }

  private handleMessageChannelMessage(peerId: string, rawData: string): void {
    try {
      const message = JSON.parse(rawData);

      if (isFileControlMessage(message)) {
        this.handleFileControlMessage(peerId, message);
        return;
      }

      this.messageCallbacks.forEach((callback) =>
        callback(peerId, message as AvesMessage),
      );
    } catch (error) {
      this.emitError(
        new AvesError({ message: `Failed to parse message from ${peerId}: ${errorMessage(error)}`, code: "MESSAGE_PARSE_FAILED", stage: "transport", retryable: false, peerId }),
      );
    }
  }

  private handleFileControlMessage(
    peerId: string,
    message: FileControlMessage,
  ): void {
    this.fileTransfers.handleControlMessage(peerId, message);
  }

  private handleFileChunk(peerId: string, data: string | Blob | ArrayBuffer): void {
    this.fileTransfers.handleChunk(peerId, data);
  }

  private emitFileTransferFailed(
    peerId: string,
    info: FileTransferInfo | null,
    error: AvesError,
  ): void {
    this.fileTransfers.reportFailure(peerId, info, error);
  }

  private clearReadyResolver(peerId: string): void {
    this.fileTransfers.clearReadyResolver(peerId);
  }

  private clearCompletionResolver(peerId: string): void {
    this.fileTransfers.clearCompletionResolver(peerId);
  }

  private getPeerConnection(peerId: string): RTCPeerConnection {
    const pc = this.peerConnections.get(peerId);
    if (!pc) {
      throw new AvesError({ message: `No peer connection found for ${peerId}`, code: "WEBRTC_CONNECTION_FAILED", stage: "transport", retryable: false, peerId });
    }
    return pc;
  }

  private getMessageChannel(peerId: string): RTCDataChannel {
    const channel = normalizePeerChannels(this.dataChannels.get(peerId)).message;
    if (!channel) {
      throw new AvesError({ message: `No DataChannel found for ${peerId}`, code: "WEBRTC_DATACHANNEL_FAILED", stage: "transport", retryable: false, peerId });
    }
    return channel;
  }

  private getFileChannel(peerId: string): RTCDataChannel {
    const channel = normalizePeerChannels(this.dataChannels.get(peerId)).file;
    if (!channel) {
      throw new AvesError({ message: `No file channel found for ${peerId}`, code: "FILE_CHANNEL_NOT_READY", stage: "transport", retryable: false, peerId });
    }
    return channel;
  }

  private failActiveTransfers(peerId: string, error: AvesError): void {
    this.fileTransfers.failActiveTransfers(peerId, error);
  }
}
