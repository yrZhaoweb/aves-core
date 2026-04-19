import { EventEmitter } from "./EventEmitter";
import { WebRTCManager } from "./WebRTCManager";
import { SignalingClient } from "./SignalingClient";
import {
  AvesClientConfig,
  FileTransferInfo,
  FileTransferOptions,
  FileTransferProgress,
  FileTransferResult,
  LocalAudioState,
  Participant,
} from "../types/types";

/**
 * AvesClient - Main client class for WebRTC communication.
 */
export class AvesClient extends EventEmitter {
  private config: Required<
    Pick<AvesClientConfig, "signalingUrl" | "iceServers" | "fileChunkSize" | "debug">
  > & {
    reconnect: {
      maxAttempts: number;
      delay: number;
    };
  };
  private webrtcManager: WebRTCManager;
  private signalingClient: SignalingClient;
  private currentRoomId: string | null = null;
  private currentUserId: string | null = null;
  private currentUserName: string | null = null;
  private participants: Map<string, Participant> = new Map();
  private preparedPeers: Set<string> = new Set();
  private shouldRestoreSession = false;

  constructor(config: AvesClientConfig) {
    super();

    const maxAttempts = config.reconnect?.maxAttempts ?? 5;
    const delay = config.reconnect?.delay ?? 3000;

    this.config = {
      signalingUrl: config.signalingUrl,
      iceServers: config.iceServers || [
        { urls: "stun:stun.l.google.com:19302" },
      ],
      fileChunkSize: config.fileChunkSize ?? 16 * 1024,
      reconnect: {
        maxAttempts,
        delay,
      },
      debug: config.debug ?? false,
    };

    this.webrtcManager = new WebRTCManager(
      this.config.iceServers,
      this.config.fileChunkSize,
    );
    this.signalingClient = new SignalingClient({
      maxAttempts,
      delay,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.signalingClient.on("stateChange", (state: string) => {
      this.emit("signalingStateChange", state);

      if (
        state === "disconnected" &&
        this.currentRoomId &&
        this.currentUserId &&
        this.currentUserName
      ) {
        this.shouldRestoreSession = true;
      }

      if (state === "connected" && this.shouldRestoreSession) {
        this.shouldRestoreSession = false;
        void this.restoreRoomSession();
      }
    });

    this.signalingClient.on("error", (error: Error) => {
      this.emit("error", error);
    });

    this.signalingClient.on("userJoined", async (user: Participant) => {
      this.participants.set(user.id, user);
      this.emit("userJoined", user);

      if (this.currentUserId && this.currentUserId < user.id) {
        await this.initiateConnection(user.id);
      }
    });

    this.signalingClient.on("userLeft", (userId: string) => {
      this.participants.delete(userId);
      this.preparedPeers.delete(userId);
      this.webrtcManager.closePeerConnection(userId);
      this.emit("userLeft", userId);
    });

    this.signalingClient.on(
      "offer",
      async (fromId: string, offer: RTCSessionDescriptionInit) => {
        try {
          this.preparePeerConnection(fromId);
          const answer = await this.webrtcManager.createAnswer(fromId, offer);

          if (this.currentUserId) {
            this.signalingClient.sendAnswer(fromId, this.currentUserId, answer);
          }
        } catch (error) {
          this.emit(
            "error",
            new Error(`Failed to handle offer from ${fromId}: ${error}`),
          );
        }
      },
    );

    this.signalingClient.on(
      "answer",
      async (fromId: string, answer: RTCSessionDescriptionInit) => {
        try {
          await this.webrtcManager.setRemoteAnswer(fromId, answer);
        } catch (error) {
          this.emit(
            "error",
            new Error(`Failed to handle answer from ${fromId}: ${error}`),
          );
        }
      },
    );

    this.signalingClient.on(
      "iceCandidate",
      async (fromId: string, candidate: RTCIceCandidateInit) => {
        try {
          await this.webrtcManager.addIceCandidate(fromId, candidate);
        } catch (error) {
          this.emit(
            "error",
            new Error(`Failed to add ICE candidate from ${fromId}: ${error}`),
          );
        }
      },
    );

    this.webrtcManager.onMessage((peerId: string, message: any) => {
      this.emit("message", peerId, message);
    });

    this.webrtcManager.onFileTransferStarted(
      (peerId: string, info: FileTransferInfo) => {
        this.emit("fileTransferStarted", peerId, info);
      },
    );

    this.webrtcManager.onFileTransferProgress(
      (peerId: string, progress: FileTransferProgress) => {
        this.emit("fileTransferProgress", peerId, progress);
      },
    );

    this.webrtcManager.onFileTransferCompleted(
      (peerId: string, result: FileTransferResult) => {
        this.emit("fileTransferCompleted", peerId, result);
      },
    );

    this.webrtcManager.onFileTransferFailed(
      (peerId: string, info: FileTransferInfo | null, error: Error) => {
        this.emit("fileTransferFailed", peerId, info, error);
      },
    );

    this.webrtcManager.onRemoteAudioTrack(
      (peerId: string, stream: MediaStream, track: MediaStreamTrack) => {
        this.emit("remoteAudioTrack", peerId, stream, track);
      },
    );

    this.webrtcManager.onLocalAudioStateChange((state: LocalAudioState) => {
      this.emit("localAudioStateChange", state);
    });
  }

  private async restoreRoomSession(): Promise<void> {
    if (!this.currentRoomId || !this.currentUserId || !this.currentUserName) {
      return;
    }

    try {
      this.webrtcManager.closeAll();
      this.participants.clear();
      this.preparedPeers.clear();

      const joinResult = await this.signalingClient.joinRoom(
        this.currentRoomId,
        this.currentUserId,
        this.currentUserName,
      );
      this.currentUserId = joinResult.userId;
      const participants = joinResult.participants;

      this.participants.clear();
      participants.forEach((participant) =>
        this.participants.set(participant.id, participant),
      );

      for (const participant of participants) {
        if (
          participant.id !== this.currentUserId &&
          this.currentUserId < participant.id
        ) {
          await this.initiateConnection(participant.id);
        }
      }
    } catch (error) {
      this.currentRoomId = null;
      this.currentUserId = null;
      this.currentUserName = null;
      this.participants.clear();
      this.preparedPeers.clear();
      this.emit(
        "error",
        new Error(`Failed to restore room session: ${error}`),
      );
    }
  }

  private preparePeerConnection(peerId: string): RTCPeerConnection {
    const pc = this.webrtcManager.createPeerConnection(peerId);

    if (this.preparedPeers.has(peerId)) {
      return pc;
    }
    this.preparedPeers.add(peerId);

    this.webrtcManager.onIceCandidate(peerId, (candidate) => {
      if (this.currentUserId) {
        this.signalingClient.sendIceCandidate(
          peerId,
          this.currentUserId,
          candidate,
        );
      }
    });

    this.webrtcManager.onConnectionStateChange(peerId, (state) => {
      if (
        state === "failed" ||
        state === "disconnected" ||
        state === "closed"
      ) {
        this.preparedPeers.delete(peerId);
      }
      this.emit("connectionStateChange", peerId, state);
    });

    this.webrtcManager.onDataChannelStateChange(peerId, (state) => {
      this.emit("dataChannelStateChange", peerId, state);
    });

    return pc;
  }

  private async initiateConnection(peerId: string): Promise<void> {
    try {
      this.preparePeerConnection(peerId);
      const offer = await this.webrtcManager.createOffer(peerId);

      if (this.currentUserId) {
        this.signalingClient.sendOffer(peerId, this.currentUserId, offer);
      }
    } catch (error) {
      this.emit(
        "error",
        new Error(`Failed to initiate connection with ${peerId}: ${error}`),
      );
    }
  }

  async createRoom(): Promise<string> {
    if (!this.signalingClient.isConnected()) {
      await this.signalingClient.connect(this.config.signalingUrl);
    }

    const roomId = await this.signalingClient.createRoom();
    this.currentRoomId = roomId;
    return roomId;
  }

  async joinRoom(roomId: string, userName: string): Promise<Participant[]>;
  async joinRoom(
    roomId: string,
    userId: string,
    userName: string,
  ): Promise<Participant[]>;
  async joinRoom(
    roomId: string,
    userIdOrName: string,
    maybeUserName?: string,
  ): Promise<Participant[]> {
    if (!this.signalingClient.isConnected()) {
      await this.signalingClient.connect(this.config.signalingUrl);
    }

    const requestedUserId = maybeUserName ? userIdOrName : null;
    const userName = maybeUserName ?? userIdOrName;

    this.currentUserId = requestedUserId;
    this.currentRoomId = roomId;
    this.currentUserName = userName;

    const joinResult = requestedUserId
      ? await this.signalingClient.joinRoom(roomId, requestedUserId, userName)
      : await this.signalingClient.joinRoom(roomId, userName);
    const participants = joinResult.participants;
    this.currentUserId = joinResult.userId;

    this.participants.clear();
    participants.forEach((participant) => this.participants.set(participant.id, participant));

    for (const participant of participants) {
      if (
        this.currentUserId &&
        participant.id !== this.currentUserId &&
        this.currentUserId < participant.id
      ) {
        await this.initiateConnection(participant.id);
      }
    }

    return participants;
  }

  async leaveRoom(): Promise<void> {
    if (this.currentUserId) {
      await this.signalingClient.leaveRoom(this.currentUserId);
    }
    this.webrtcManager.closeAll();
    this.participants.clear();
    this.preparedPeers.clear();
    this.currentRoomId = null;
    this.currentUserId = null;
    this.currentUserName = null;
    this.shouldRestoreSession = false;
  }

  sendMessage(message: any): void {
    this.webrtcManager.sendMessage(message);
  }

  sendMessageToPeer(peerId: string, message: any): void {
    this.webrtcManager.sendMessageToPeer(peerId, message);
  }

  async sendFile(
    blob: Blob,
    options: FileTransferOptions = {},
  ): Promise<FileTransferInfo[]> {
    return this.webrtcManager.sendFile(blob, options);
  }

  async startVoice(): Promise<MediaStream> {
    return this.webrtcManager.startVoice();
  }

  stopVoice(): void {
    this.webrtcManager.stopVoice();
  }

  setMuted(muted: boolean): void {
    this.webrtcManager.setMuted(muted);
  }

  getLocalAudioState(): LocalAudioState {
    return this.webrtcManager.getLocalAudioState();
  }

  getRemoteAudioStream(peerId: string): MediaStream | null {
    return this.webrtcManager.getRemoteAudioStream(peerId);
  }

  getConnectionState(peerId: string): RTCPeerConnectionState {
    return this.webrtcManager.isConnected(peerId) ? "connected" : "closed";
  }

  getParticipants(): Participant[] {
    return Array.from(this.participants.values());
  }

  getCurrentUserId(): string | null {
    return this.currentUserId;
  }

  isConnected(): boolean {
    return this.signalingClient.isConnected();
  }

  destroy(): void {
    this.currentRoomId = null;
    this.currentUserId = null;
    this.currentUserName = null;
    this.shouldRestoreSession = false;
    this.participants.clear();
    this.preparedPeers.clear();
    this.signalingClient.disconnect();
    this.webrtcManager.destroy();
    this.removeAllListeners();
  }
}
