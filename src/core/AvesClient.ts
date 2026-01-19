import { EventEmitter } from "./EventEmitter";
import { WebRTCManager } from "./WebRTCManager";
import { SignalingClient } from "./SignalingClient";
import { AvesClientConfig, Participant } from "../types/types";

/**
 * AvesClient - Main client class for WebRTC communication
 *
 * This class coordinates WebRTCManager and SignalingClient to provide
 * a simple API for WebRTC-based real-time communication.
 *
 * Features:
 * - Room management (create, join, leave)
 * - Automatic WebRTC connection establishment
 * - Message sending and receiving
 * - Connection state monitoring
 * - Automatic reconnection
 */
export class AvesClient extends EventEmitter {
  private config: Required<AvesClientConfig>;
  private webrtcManager: WebRTCManager;
  private signalingClient: SignalingClient;
  private currentRoomId: string | null = null;
  private currentUserId: string | null = null;
  private participants: Map<string, Participant> = new Map();

  constructor(config: AvesClientConfig) {
    super();

    // Apply default configuration
    const maxAttempts = config.reconnect?.maxAttempts ?? 5;
    const delay = config.reconnect?.delay ?? 3000;

    this.config = {
      signalingUrl: config.signalingUrl,
      iceServers: config.iceServers || [
        { urls: "stun:stun.l.google.com:19302" },
      ],
      reconnect: {
        maxAttempts,
        delay,
      },
      debug: config.debug ?? false,
    };

    // Initialize WebRTC manager
    this.webrtcManager = new WebRTCManager(this.config.iceServers);

    // Initialize signaling client
    this.signalingClient = new SignalingClient({
      maxAttempts,
      delay,
    });

    // Setup event forwarding and coordination
    this.setupEventHandlers();
  }

  /**
   * Setup event handlers to coordinate between components
   */
  private setupEventHandlers(): void {
    // Forward signaling state changes
    this.signalingClient.on("stateChange", (state: string) => {
      this.emit("signalingStateChange", state);
    });

    // Forward errors
    this.signalingClient.on("error", (error: Error) => {
      this.emit("error", error);
    });

    // Handle user joined - establish WebRTC connection
    this.signalingClient.on("userJoined", async (user: Participant) => {
      this.participants.set(user.id, user);
      this.emit("userJoined", user);

      // Initiate WebRTC connection (we are the offerer)
      if (this.currentUserId) {
        await this.initiateConnection(user.id);
      }
    });

    // Handle user left - cleanup connection
    this.signalingClient.on("userLeft", (userId: string) => {
      this.participants.delete(userId);
      this.webrtcManager.closePeerConnection(userId);
      this.emit("userLeft", userId);
    });

    // Handle incoming offer - create answer
    this.signalingClient.on(
      "offer",
      async (fromId: string, offer: RTCSessionDescriptionInit) => {
        try {
          const pc = this.webrtcManager.createPeerConnection(fromId);

          // Setup ICE candidate forwarding
          this.webrtcManager.onIceCandidate(fromId, (candidate) => {
            if (this.currentUserId) {
              this.signalingClient.sendIceCandidate(
                fromId,
                this.currentUserId,
                candidate
              );
            }
          });

          // Setup connection state monitoring
          this.webrtcManager.onConnectionStateChange(fromId, (state) => {
            this.emit("connectionStateChange", fromId, state);
          });

          // Setup DataChannel state monitoring
          this.webrtcManager.onDataChannelStateChange(fromId, (state) => {
            this.emit("dataChannelStateChange", fromId, state);
          });

          // Create and send answer
          const answer = await this.webrtcManager.createAnswer(fromId, offer);
          if (this.currentUserId) {
            this.signalingClient.sendAnswer(fromId, this.currentUserId, answer);
          }
        } catch (error) {
          this.emit(
            "error",
            new Error(`Failed to handle offer from ${fromId}: ${error}`)
          );
        }
      }
    );

    // Handle incoming answer - set remote description
    this.signalingClient.on(
      "answer",
      async (fromId: string, answer: RTCSessionDescriptionInit) => {
        try {
          await this.webrtcManager.setRemoteAnswer(fromId, answer);
        } catch (error) {
          this.emit(
            "error",
            new Error(`Failed to handle answer from ${fromId}: ${error}`)
          );
        }
      }
    );

    // Handle incoming ICE candidate
    this.signalingClient.on(
      "iceCandidate",
      async (fromId: string, candidate: RTCIceCandidateInit) => {
        try {
          await this.webrtcManager.addIceCandidate(fromId, candidate);
        } catch (error) {
          this.emit(
            "error",
            new Error(`Failed to add ICE candidate from ${fromId}: ${error}`)
          );
        }
      }
    );

    // Forward messages from WebRTC
    this.webrtcManager.onMessage((peerId: string, message: any) => {
      this.emit("message", peerId, message);
    });
  }

  /**
   * Initiate a WebRTC connection with a peer (as offerer)
   */
  private async initiateConnection(peerId: string): Promise<void> {
    try {
      const pc = this.webrtcManager.createPeerConnection(peerId);

      // Setup ICE candidate forwarding
      this.webrtcManager.onIceCandidate(peerId, (candidate) => {
        if (this.currentUserId) {
          this.signalingClient.sendIceCandidate(
            peerId,
            this.currentUserId,
            candidate
          );
        }
      });

      // Setup connection state monitoring
      this.webrtcManager.onConnectionStateChange(peerId, (state) => {
        this.emit("connectionStateChange", peerId, state);
      });

      // Setup DataChannel state monitoring
      this.webrtcManager.onDataChannelStateChange(peerId, (state) => {
        this.emit("dataChannelStateChange", peerId, state);
      });

      // Create and send offer
      const offer = await this.webrtcManager.createOffer(peerId);
      if (this.currentUserId) {
        this.signalingClient.sendOffer(peerId, this.currentUserId, offer);
      }
    } catch (error) {
      this.emit(
        "error",
        new Error(`Failed to initiate connection with ${peerId}: ${error}`)
      );
    }
  }

  /**
   * Create a new room
   * @returns Promise that resolves with the room ID
   */
  async createRoom(): Promise<string> {
    // Connect to signaling server if not connected
    if (!this.isConnected()) {
      await this.signalingClient.connect(this.config.signalingUrl);
    }

    const roomId = await this.signalingClient.createRoom();
    this.currentRoomId = roomId;
    return roomId;
  }

  /**
   * Join an existing room
   * @param roomId - Room ID to join
   * @param userId - User ID
   * @param userName - User name
   * @returns Promise that resolves with the list of current participants
   */
  async joinRoom(
    roomId: string,
    userId: string,
    userName: string
  ): Promise<Participant[]> {
    // Connect to signaling server if not connected
    if (!this.isConnected()) {
      await this.signalingClient.connect(this.config.signalingUrl);
    }

    this.currentUserId = userId;
    this.currentRoomId = roomId;

    const participants = await this.signalingClient.joinRoom(
      roomId,
      userId,
      userName
    );

    // Store participants
    this.participants.clear();
    participants.forEach((p) => this.participants.set(p.id, p));

    // Initiate WebRTC connections with all existing participants
    for (const participant of participants) {
      if (participant.id !== userId) {
        await this.initiateConnection(participant.id);
      }
    }

    return participants;
  }

  /**
   * Leave the current room
   * Disconnects from signaling server and closes all WebRTC connections
   */
  async leaveRoom(): Promise<void> {
    this.signalingClient.leaveRoom();
    this.webrtcManager.closeAll();
    this.participants.clear();
    this.currentRoomId = null;
    this.currentUserId = null;
    this.signalingClient.disconnect();
  }

  /**
   * Send a message to all connected peers
   * @param message - Message to send (will be JSON serialized)
   * @throws Error if any DataChannel is not ready
   */
  sendMessage(message: any): void {
    this.webrtcManager.sendMessage(message);
  }

  /**
   * Send a message to a specific peer
   * @param peerId - Target peer ID
   * @param message - Message to send (will be JSON serialized)
   * @throws Error if DataChannel is not ready
   */
  sendMessageToPeer(peerId: string, message: any): void {
    this.webrtcManager.sendMessageToPeer(peerId, message);
  }

  /**
   * Get the connection state for a specific peer
   * @param peerId - Peer ID
   * @returns Connection state or 'closed' if peer not found
   */
  getConnectionState(peerId: string): RTCPeerConnectionState {
    return this.webrtcManager.isConnected(peerId) ? "connected" : "closed";
  }

  /**
   * Get the list of current participants in the room
   * @returns Array of participants
   */
  getParticipants(): Participant[] {
    return Array.from(this.participants.values());
  }

  /**
   * Check if connected to the signaling server
   * @returns true if connected, false otherwise
   */
  isConnected(): boolean {
    // Check if we have an active signaling connection
    // This is a simplified check - in production you might want more sophisticated state tracking
    return this.currentRoomId !== null;
  }

  /**
   * Destroy the client and clean up all resources
   * Closes all connections and removes all event listeners
   */
  destroy(): void {
    this.signalingClient.disconnect();
    this.webrtcManager.closeAll();
    this.participants.clear();
    this.currentRoomId = null;
    this.currentUserId = null;
    this.removeAllListeners();
  }
}
