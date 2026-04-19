import {
  FileTransferInfo,
  FileTransferOptions,
  FileTransferProgress,
  FileTransferResult,
  LocalAudioState,
} from "../types/types";

const DEFAULT_FILE_CHUNK_SIZE = 16 * 1024;
const FILE_CHANNEL_LABEL = "file";
const MESSAGE_CHANNEL_LABEL = "data";
const FILE_PROTOCOL = "aves:file-control";
const FILE_READY_TIMEOUT_MS = 10000;
const FILE_COMPLETE_TIMEOUT_MS = 10000;
const FILE_END_MARKER_PREFIX = "__aves_file_end__:";

type ChannelKind = "message" | "file";

interface PeerChannels {
  message?: RTCDataChannel;
  file?: RTCDataChannel;
}

interface OutgoingTransfer extends FileTransferInfo {
  blob: Blob;
  chunkSize: number;
}

interface IncomingTransfer extends FileTransferInfo {
  chunks: BlobPart[];
  bytesTransferred: number;
}

type FileControlMessage =
  | {
      __aves: typeof FILE_PROTOCOL;
      kind: "file-meta";
      transfer: Omit<FileTransferInfo, "peerId" | "direction">;
    }
  | {
      __aves: typeof FILE_PROTOCOL;
      kind: "file-ready";
      transferId: string;
    }
  | {
      __aves: typeof FILE_PROTOCOL;
      kind: "file-complete";
      transferId: string;
    }
  | {
      __aves: typeof FILE_PROTOCOL;
      kind: "file-error";
      transferId: string;
      message: string;
    };

interface ReadyResolver {
  transferId: string;
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * WebRTCManager - Manages WebRTC PeerConnections, DataChannels, and media tracks
 */
export class WebRTCManager {
  private peerConnections: Map<string, RTCPeerConnection>;
  private dataChannels: Map<string, PeerChannels>;
  private iceServers: RTCIceServer[];
  private fileChunkSize: number;
  private messageCallbacks: Set<(peerId: string, message: any) => void>;
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
    (peerId: string, info: FileTransferInfo | null, error: Error) => void
  >;
  private remoteAudioTrackCallbacks: Set<
    (peerId: string, stream: MediaStream, track: MediaStreamTrack) => void
  >;
  private localAudioStateCallbacks: Set<(state: LocalAudioState) => void>;
  private outgoingTransfers: Map<string, OutgoingTransfer>;
  private incomingTransfers: Map<string, IncomingTransfer>;
  private readyResolvers: Map<string, ReadyResolver>;
  private completionResolvers: Map<string, ReadyResolver>;
  private audioSenders: Map<string, RTCRtpSender | null>;
  private remoteAudioStreams: Map<string, MediaStream>;
  private localAudioStream: MediaStream | null;
  private localAudioTrack: MediaStreamTrack | null;
  private isMuted: boolean;

  constructor(iceServers: RTCIceServer[], fileChunkSize = DEFAULT_FILE_CHUNK_SIZE) {
    this.peerConnections = new Map();
    this.dataChannels = new Map();
    this.iceServers = iceServers;
    this.fileChunkSize = this.validateChunkSize(fileChunkSize);
    this.messageCallbacks = new Set();
    this.connectionStateCallbacks = new Map();
    this.dataChannelStateCallbacks = new Map();
    this.iceCandidateCallbacks = new Map();
    this.fileTransferStartedCallbacks = new Set();
    this.fileTransferProgressCallbacks = new Set();
    this.fileTransferCompletedCallbacks = new Set();
    this.fileTransferFailedCallbacks = new Set();
    this.remoteAudioTrackCallbacks = new Set();
    this.localAudioStateCallbacks = new Set();
    this.outgoingTransfers = new Map();
    this.incomingTransfers = new Map();
    this.readyResolvers = new Map();
    this.completionResolvers = new Map();
    this.audioSenders = new Map();
    this.remoteAudioStreams = new Map();
    this.localAudioStream = null;
    this.localAudioTrack = null;
    this.isMuted = false;
  }

  /**
   * Create a new PeerConnection for the specified peer.
   * If a connection already exists, returns the existing connection.
   */
  createPeerConnection(peerId: string): RTCPeerConnection {
    if (this.peerConnections.has(peerId)) {
      return this.peerConnections.get(peerId)!;
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
   */
  sendMessage(message: any): void {
    const errors: string[] = [];

    this.dataChannels.forEach((storedChannels, peerId) => {
      const channels = this.normalizePeerChannels(storedChannels);

      if (!channels.message || channels.message.readyState !== "open") {
        errors.push(peerId);
        return;
      }

      try {
        channels.message.send(JSON.stringify(message));
      } catch (error) {
        errors.push(peerId);
      }
    });

    if (errors.length > 0) {
      throw new Error(`DataChannel not ready for peers: ${errors.join(", ")}`);
    }
  }

  /**
   * Send a JSON message to a specific peer.
   */
  sendMessageToPeer(peerId: string, message: any): void {
    const dataChannel = this.getMessageChannel(peerId);

    if (dataChannel.readyState !== "open") {
      throw new Error(
        `DataChannel not ready for ${peerId}, state: ${dataChannel.readyState}`,
      );
    }

    dataChannel.send(JSON.stringify(message));
  }

  /**
   * Send a file to one peer or broadcast to every connected peer.
   */
  async sendFile(
    blob: Blob,
    options: FileTransferOptions = {},
  ): Promise<FileTransferInfo[]> {
    const peerIds = options.peerId
      ? [options.peerId]
      : this.getActivePeers().filter((peerId) => this.isFileChannelReady(peerId));

    if (peerIds.length === 0) {
      throw new Error("No file channel is ready");
    }

    const results: FileTransferInfo[] = [];

    for (const peerId of peerIds) {
      const info = await this.sendFileToPeer(peerId, blob, options);
      results.push(info);
    }

    return results;
  }

  /**
   * Start capturing local audio and bind it to current peer connections.
   */
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
      throw new Error("Audio capture is not available in this environment");
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const [track] = stream.getAudioTracks();

    if (!track) {
      throw new Error("No audio track available from getUserMedia");
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

  /**
   * Stop local audio capture and detach it from active peers.
   */
  stopVoice(): void {
    if (this.localAudioTrack) {
      this.audioSenders.forEach((sender, peerId) => {
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

  /**
   * Toggle local mute state.
   */
  setMuted(muted: boolean): void {
    this.isMuted = muted;

    if (this.localAudioTrack) {
      this.localAudioTrack.enabled = !muted;
    }

    this.emitLocalAudioState();
  }

  /**
   * Read current local audio state.
   */
  getLocalAudioState(): LocalAudioState {
    return {
      active: !!this.localAudioTrack,
      muted: this.isMuted,
    };
  }

  /**
   * Read current remote audio stream for a peer.
   */
  getRemoteAudioStream(peerId: string): MediaStream | null {
    return this.remoteAudioStreams.get(peerId) ?? null;
  }

  /**
   * Register a callback for ICE candidates from the specified peer.
   */
  onIceCandidate(
    peerId: string,
    callback: (candidate: RTCIceCandidateInit) => void,
  ): void {
    const pc = this.getPeerConnection(peerId);

    if (!this.iceCandidateCallbacks.has(peerId)) {
      this.iceCandidateCallbacks.set(peerId, new Set());
    }
    this.iceCandidateCallbacks.get(peerId)!.add(callback);

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      const callbacks = this.iceCandidateCallbacks.get(peerId);
      callbacks?.forEach((cb) => cb(event.candidate!.toJSON()));
    };
  }

  /**
   * Register a callback for connection state changes.
   */
  onConnectionStateChange(
    peerId: string,
    callback: (state: RTCPeerConnectionState) => void,
  ): void {
    if (!this.connectionStateCallbacks.has(peerId)) {
      this.connectionStateCallbacks.set(peerId, new Set());
    }
    this.connectionStateCallbacks.get(peerId)!.add(callback);
  }

  /**
   * Register a callback for main DataChannel state changes.
   */
  onDataChannelStateChange(
    peerId: string,
    callback: (state: RTCDataChannelState) => void,
  ): void {
    if (!this.dataChannelStateCallbacks.has(peerId)) {
      this.dataChannelStateCallbacks.set(peerId, new Set());
    }
    this.dataChannelStateCallbacks.get(peerId)!.add(callback);
  }

  /**
   * Register a callback for incoming user messages.
   */
  onMessage(callback: (peerId: string, message: any) => void): void {
    this.messageCallbacks.add(callback);
  }

  onFileTransferStarted(
    callback: (peerId: string, info: FileTransferInfo) => void,
  ): void {
    this.fileTransferStartedCallbacks.add(callback);
  }

  onFileTransferProgress(
    callback: (peerId: string, progress: FileTransferProgress) => void,
  ): void {
    this.fileTransferProgressCallbacks.add(callback);
  }

  onFileTransferCompleted(
    callback: (peerId: string, result: FileTransferResult) => void,
  ): void {
    this.fileTransferCompletedCallbacks.add(callback);
  }

  onFileTransferFailed(
    callback: (peerId: string, info: FileTransferInfo | null, error: Error) => void,
  ): void {
    this.fileTransferFailedCallbacks.add(callback);
  }

  onRemoteAudioTrack(
    callback: (peerId: string, stream: MediaStream, track: MediaStreamTrack) => void,
  ): void {
    this.remoteAudioTrackCallbacks.add(callback);
  }

  onLocalAudioStateChange(callback: (state: LocalAudioState) => void): void {
    this.localAudioStateCallbacks.add(callback);
  }

  /**
   * Close the connection with a specific peer.
   */
  closePeerConnection(peerId: string): void {
    this.failActiveTransfers(peerId, new Error(`Peer connection closed for ${peerId}`));
    const channels = this.normalizePeerChannels(this.dataChannels.get(peerId));
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
    this.audioSenders.delete(peerId);
    this.remoteAudioStreams.delete(peerId);
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
  }

  destroy(): void {
    this.closeAll();
    this.messageCallbacks.clear();
    this.fileTransferStartedCallbacks.clear();
    this.fileTransferProgressCallbacks.clear();
    this.fileTransferCompletedCallbacks.clear();
    this.fileTransferFailedCallbacks.clear();
    this.remoteAudioTrackCallbacks.clear();
    this.localAudioStateCallbacks.clear();
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
   * Check if the main DataChannel is ready for a specific peer.
   */
  isDataChannelReady(peerId: string): boolean {
    return (
      this.normalizePeerChannels(this.dataChannels.get(peerId)).message
        ?.readyState === "open"
    );
  }

  /**
   * Check if the file channel is ready for a specific peer.
   */
  isFileChannelReady(peerId: string): boolean {
    return (
      this.normalizePeerChannels(this.dataChannels.get(peerId)).file
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

    pc.ontrack = (event) => {
      if (event.track.kind !== "audio") {
        return;
      }

      const stream =
        event.streams[0] ??
        (typeof MediaStream !== "undefined"
          ? new MediaStream([event.track])
          : (null as unknown as MediaStream));

      this.remoteAudioStreams.set(peerId, stream);
      this.remoteAudioTrackCallbacks.forEach((callback) =>
        callback(peerId, stream, event.track),
      );
    };

    this.audioSenders.set(peerId, this.createAudioSender(pc));
    void this.syncLocalAudioTrack(peerId);
  }

  private createAudioSender(pc: RTCPeerConnection): RTCRtpSender | null {
    const transceiverCapable = pc as RTCPeerConnection & {
      addTransceiver?: (
        trackOrKind: string | MediaStreamTrack,
        init?: RTCRtpTransceiverInit,
      ) => RTCRtpTransceiver;
    };

    if (typeof transceiverCapable.addTransceiver === "function") {
      const transceiver = transceiverCapable.addTransceiver("audio", {
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

    if (
      this.localAudioTrack &&
      typeof (pc as RTCPeerConnection & {
        addTrack?: (
          track: MediaStreamTrack,
          ...streams: MediaStream[]
        ) => RTCRtpSender;
      }).addTrack === "function"
    ) {
      const addTrackCapable = pc as RTCPeerConnection & {
        addTrack: (
          track: MediaStreamTrack,
          ...streams: MediaStream[]
        ) => RTCRtpSender;
      };
      const stream =
        this.localAudioStream ??
        (typeof MediaStream !== "undefined"
          ? new MediaStream([this.localAudioTrack])
          : undefined);

      sender = stream
        ? addTrackCapable.addTrack(this.localAudioTrack, stream)
        : addTrackCapable.addTrack(this.localAudioTrack);
      this.audioSenders.set(peerId, sender);
    }
  }

  private ensureDataChannel(
    peerId: string,
    pc: RTCPeerConnection,
    label: typeof MESSAGE_CHANNEL_LABEL | typeof FILE_CHANNEL_LABEL,
  ): RTCDataChannel {
    const channels = this.dataChannels.get(peerId) ?? {};
    const kind: ChannelKind = label === FILE_CHANNEL_LABEL ? "file" : "message";
    const existing = channels[kind];

    if (existing) {
      return existing;
    }

    const channel = pc.createDataChannel(label);
    this.setupDataChannel(peerId, channel);
    return channel;
  }

  private setupDataChannel(peerId: string, dataChannel: RTCDataChannel): void {
    const kind: ChannelKind =
      dataChannel.label === FILE_CHANNEL_LABEL ? "file" : "message";
    const channels = this.normalizePeerChannels(this.dataChannels.get(peerId));
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
      if (storedChannels && this.isPeerChannels(storedChannels) && storedChannels[kind] === dataChannel) {
        delete storedChannels[kind];
        if (!storedChannels.message && !storedChannels.file) {
          this.dataChannels.delete(peerId);
        }
      }

      if (kind === "message" || kind === "file") {
        this.failActiveTransfers(
          peerId,
          new Error(`${kind} channel closed during file transfer`),
        );
      }
    };

    dataChannel.onerror = (error) => {
      console.error(
        `DataChannel error with ${peerId}:`,
        error,
      );
      const transfer =
        kind === "file"
          ? this.outgoingTransfers.get(peerId) ?? this.incomingTransfers.get(peerId) ?? null
          : null;
      if (transfer) {
        this.emitFileTransferFailed(
          peerId,
          transfer,
          new Error(`DataChannel error on ${kind} channel`),
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

      if (this.isFileControlMessage(message)) {
        this.handleFileControlMessage(peerId, message);
        return;
      }

      this.messageCallbacks.forEach((callback) => callback(peerId, message));
    } catch (error) {
      console.error(`Failed to parse message from ${peerId}:`, error);
    }
  }

  private async sendFileToPeer(
    peerId: string,
    blob: Blob,
    options: FileTransferOptions,
  ): Promise<FileTransferInfo> {
    const messageChannel = this.getMessageChannel(peerId);
    const fileChannel = this.getFileChannel(peerId);

    if (messageChannel.readyState !== "open") {
      throw new Error(`DataChannel not ready for ${peerId}`);
    }

    if (fileChannel.readyState !== "open") {
      throw new Error(`File channel not ready for ${peerId}`);
    }

    if (this.outgoingTransfers.has(peerId)) {
      throw new Error(`A file transfer is already active for ${peerId}`);
    }

    const transfer: OutgoingTransfer = {
      transferId: this.generateTransferId(),
      peerId,
      direction: "send",
      name: options.fileName || this.getBlobName(blob),
      size: blob.size,
      mimeType: options.mimeType || blob.type || "application/octet-stream",
      lastModified:
        options.lastModified ?? this.getBlobLastModified(blob) ?? Date.now(),
      blob,
      chunkSize: options.chunkSize ?? this.fileChunkSize,
    };
    transfer.chunkSize = this.validateChunkSize(transfer.chunkSize);

    this.outgoingTransfers.set(peerId, transfer);
    this.emitFileTransferStarted(peerId, transfer);
    this.emitFileTransferProgress(peerId, transfer, 0);

    try {
      const readyPromise = this.awaitTransferReady(peerId, transfer.transferId);
      this.sendFileControl(peerId, {
        __aves: FILE_PROTOCOL,
        kind: "file-meta",
        transfer: {
          transferId: transfer.transferId,
          name: transfer.name,
          size: transfer.size,
          mimeType: transfer.mimeType,
          lastModified: transfer.lastModified,
        },
      });

      await readyPromise;

      let offset = 0;
      while (offset < transfer.size) {
        const nextChunk = transfer.blob.slice(offset, offset + transfer.chunkSize);
        const buffer = await nextChunk.arrayBuffer();
        fileChannel.send(buffer);
        offset += buffer.byteLength;
        this.emitFileTransferProgress(peerId, transfer, offset);
      }

      const completionPromise = this.awaitTransferCompletion(
        peerId,
        transfer.transferId,
      );
      fileChannel.send(`${FILE_END_MARKER_PREFIX}${transfer.transferId}`);
      await completionPromise;

      const result: FileTransferResult = {
        ...transfer,
      };
      this.fileTransferCompletedCallbacks.forEach((callback) =>
        callback(peerId, result),
      );

      return transfer;
    } catch (error) {
      const transferError =
        error instanceof Error ? error : new Error("File transfer failed");
      this.sendFileControl(peerId, {
        __aves: FILE_PROTOCOL,
        kind: "file-error",
        transferId: transfer.transferId,
        message: transferError.message,
      });
      this.emitFileTransferFailed(peerId, transfer, transferError);
      throw transferError;
    } finally {
      this.clearReadyResolver(peerId);
      this.clearCompletionResolver(peerId);
      this.outgoingTransfers.delete(peerId);
    }
  }

  private handleFileControlMessage(
    peerId: string,
    message: FileControlMessage,
  ): void {
    switch (message.kind) {
      case "file-meta": {
        const transfer: IncomingTransfer = {
          transferId: message.transfer.transferId,
          peerId,
          direction: "receive",
          name: message.transfer.name,
          size: message.transfer.size,
          mimeType: message.transfer.mimeType,
          lastModified: message.transfer.lastModified,
          chunks: [],
          bytesTransferred: 0,
        };
        this.incomingTransfers.set(peerId, transfer);
        this.emitFileTransferStarted(peerId, transfer);
        this.emitFileTransferProgress(peerId, transfer, 0);
        this.sendFileControl(peerId, {
          __aves: FILE_PROTOCOL,
          kind: "file-ready",
          transferId: transfer.transferId,
        });
        break;
      }

      case "file-ready": {
        const resolver = this.readyResolvers.get(peerId);
        if (resolver && resolver.transferId === message.transferId) {
          clearTimeout(resolver.timeoutId);
          this.readyResolvers.delete(peerId);
          resolver.resolve();
        }
        break;
      }

      case "file-complete": {
        const resolver = this.completionResolvers.get(peerId);
        if (resolver && resolver.transferId === message.transferId) {
          clearTimeout(resolver.timeoutId);
          this.completionResolvers.delete(peerId);
          resolver.resolve();
          return;
        }
        break;
      }

      case "file-error": {
        const transfer =
          this.outgoingTransfers.get(peerId) ??
          this.incomingTransfers.get(peerId) ??
          null;
        this.emitFileTransferFailed(
          peerId,
          transfer,
          new Error(message.message),
        );
        this.outgoingTransfers.delete(peerId);
        this.incomingTransfers.delete(peerId);
        this.clearReadyResolver(peerId);
        this.clearCompletionResolver(peerId);
        break;
      }
    }
  }

  private handleFileChunk(peerId: string, data: string | Blob | ArrayBuffer): void {
    const transfer = this.incomingTransfers.get(peerId);
    if (!transfer) {
      return;
    }

    if (
      typeof data === "string" &&
      data === `${FILE_END_MARKER_PREFIX}${transfer.transferId}`
    ) {
      const result: FileTransferResult = {
        transferId: transfer.transferId,
        peerId,
        direction: "receive",
        name: transfer.name,
        size: transfer.size,
        mimeType: transfer.mimeType,
        lastModified: transfer.lastModified,
        blob: new Blob(transfer.chunks, { type: transfer.mimeType }),
      };

      this.fileTransferCompletedCallbacks.forEach((callback) =>
        callback(peerId, result),
      );
      this.sendFileControl(peerId, {
        __aves: FILE_PROTOCOL,
        kind: "file-complete",
        transferId: transfer.transferId,
      });
      this.incomingTransfers.delete(peerId);
      return;
    }

    transfer.chunks.push(data);
    transfer.bytesTransferred += this.getChunkSize(data);
    this.emitFileTransferProgress(peerId, transfer, transfer.bytesTransferred);
  }

  private emitFileTransferStarted(peerId: string, info: FileTransferInfo): void {
    this.fileTransferStartedCallbacks.forEach((callback) => callback(peerId, info));
  }

  private emitFileTransferProgress(
    peerId: string,
    info: FileTransferInfo,
    bytesTransferred: number,
  ): void {
    const progress: FileTransferProgress = {
      ...info,
      bytesTransferred: Math.min(bytesTransferred, info.size),
      progress:
        info.size === 0
          ? 100
          : Math.min(100, (bytesTransferred / info.size) * 100),
    };
    this.fileTransferProgressCallbacks.forEach((callback) =>
      callback(peerId, progress),
    );
  }

  private emitFileTransferFailed(
    peerId: string,
    info: FileTransferInfo | null,
    error: Error,
  ): void {
    this.fileTransferFailedCallbacks.forEach((callback) =>
      callback(peerId, info, error),
    );
  }

  private emitLocalAudioState(): void {
    const state = this.getLocalAudioState();
    this.localAudioStateCallbacks.forEach((callback) => callback(state));
  }

  private sendFileControl(peerId: string, message: FileControlMessage): void {
    const dataChannel = this.getMessageChannel(peerId);
    dataChannel.send(JSON.stringify(message));
  }

  private awaitTransferReady(peerId: string, transferId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.readyResolvers.delete(peerId);
        reject(new Error("Timed out waiting for file receiver readiness"));
      }, FILE_READY_TIMEOUT_MS);

      this.readyResolvers.set(peerId, {
        transferId,
        resolve,
        reject,
        timeoutId,
      });
    });
  }

  private clearReadyResolver(peerId: string): void {
    const resolver = this.readyResolvers.get(peerId);
    if (!resolver) {
      return;
    }

    clearTimeout(resolver.timeoutId);
    this.readyResolvers.delete(peerId);
  }

  private awaitTransferCompletion(peerId: string, transferId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.completionResolvers.delete(peerId);
        reject(new Error("Timed out waiting for file receiver confirmation"));
      }, FILE_COMPLETE_TIMEOUT_MS);

      this.completionResolvers.set(peerId, {
        transferId,
        resolve,
        reject,
        timeoutId,
      });
    });
  }

  private clearCompletionResolver(peerId: string): void {
    const resolver = this.completionResolvers.get(peerId);
    if (!resolver) {
      return;
    }

    clearTimeout(resolver.timeoutId);
    this.completionResolvers.delete(peerId);
  }

  private getPeerConnection(peerId: string): RTCPeerConnection {
    const pc = this.peerConnections.get(peerId);
    if (!pc) {
      throw new Error(`No peer connection found for ${peerId}`);
    }
    return pc;
  }

  private getMessageChannel(peerId: string): RTCDataChannel {
    const channel = this.normalizePeerChannels(this.dataChannels.get(peerId)).message;
    if (!channel) {
      throw new Error(`No DataChannel found for ${peerId}`);
    }
    return channel;
  }

  private getFileChannel(peerId: string): RTCDataChannel {
    const channel = this.normalizePeerChannels(this.dataChannels.get(peerId)).file;
    if (!channel) {
      throw new Error(`No file channel found for ${peerId}`);
    }
    return channel;
  }

  private isFileControlMessage(message: unknown): message is FileControlMessage {
    if (!message || typeof message !== "object") {
      return false;
    }

    const record = message as Record<string, unknown>;
    return record.__aves === FILE_PROTOCOL && typeof record.kind === "string";
  }

  private getChunkSize(data: string | Blob | ArrayBuffer): number {
    if (typeof data === "string") {
      return data.length;
    }

    if (data instanceof ArrayBuffer) {
      return data.byteLength;
    }

    return data.size;
  }

  private getBlobName(blob: Blob): string {
    const fileBlob = blob as Blob & { name?: string };
    return fileBlob.name || "shared-file";
  }

  private getBlobLastModified(blob: Blob): number | undefined {
    const fileBlob = blob as Blob & { lastModified?: number };
    return typeof fileBlob.lastModified === "number"
      ? fileBlob.lastModified
      : undefined;
  }

  private generateTransferId(): string {
    return `file-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private validateChunkSize(chunkSize: number): number {
    if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
      throw new Error("chunkSize must be a positive integer");
    }
    return chunkSize;
  }

  private failActiveTransfers(peerId: string, error: Error): void {
    const outgoingTransfer = this.outgoingTransfers.get(peerId) ?? null;
    const incomingTransfer = this.incomingTransfers.get(peerId) ?? null;

    if (outgoingTransfer) {
      this.emitFileTransferFailed(peerId, outgoingTransfer, error);
    }

    if (incomingTransfer) {
      this.emitFileTransferFailed(peerId, incomingTransfer, error);
    }

    const readyResolver = this.readyResolvers.get(peerId);
    if (readyResolver) {
      readyResolver.reject(error);
      this.clearReadyResolver(peerId);
    }

    const completionResolver = this.completionResolvers.get(peerId);
    if (completionResolver) {
      completionResolver.reject(error);
      this.clearCompletionResolver(peerId);
    }

    this.outgoingTransfers.delete(peerId);
    this.incomingTransfers.delete(peerId);
  }

  private normalizePeerChannels(
    channels: PeerChannels | RTCDataChannel | undefined,
  ): PeerChannels {
    if (!channels) {
      return {};
    }

    if (this.isPeerChannels(channels)) {
      return channels;
    }

    return {
      message: channels,
    };
  }

  private isPeerChannels(value: PeerChannels | RTCDataChannel): value is PeerChannels {
    return !("readyState" in value);
  }
}
