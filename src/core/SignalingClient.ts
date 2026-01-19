import { EventEmitter } from "./EventEmitter";
import { Participant, SignalingMessage, ReconnectConfig } from "../types/types";

/**
 * SignalingClient manages WebSocket connection and signaling message exchange
 * Extends EventEmitter to provide event-driven communication
 */
export class SignalingClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectConfig: ReconnectConfig;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private url: string = "";
  private shouldReconnect: boolean = true;
  private pendingRequests: Map<
    string,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  > = new Map();

  constructor(reconnectConfig: ReconnectConfig) {
    super();
    this.reconnectConfig = reconnectConfig;
  }

  /**
   * Connect to the signaling server
   * @param url - WebSocket server URL
   * @returns Promise that resolves when connected
   */
  connect(url: string): Promise<void> {
    this.url = url;
    this.shouldReconnect = true;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          this.emit("stateChange", "connected");
          resolve();
        };

        this.ws.onclose = () => {
          this.emit("stateChange", "disconnected");
          this.handleDisconnect();
        };

        this.ws.onerror = (error) => {
          this.emit("error", new Error("WebSocket error"));
          reject(new Error("WebSocket connection failed"));
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.emit("stateChange", "connecting");
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the signaling server
   */
  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.emit("stateChange", "disconnected");
  }

  /**
   * Handle WebSocket disconnection and attempt reconnection
   */
  private handleDisconnect(): void {
    this.ws = null;

    if (!this.shouldReconnect) {
      return;
    }

    if (this.reconnectAttempts < this.reconnectConfig.maxAttempts) {
      this.reconnectAttempts++;
      this.reconnectTimer = setTimeout(() => {
        this.connect(this.url).catch((error) => {
          // Connection failed, will retry on next attempt
        });
      }, this.reconnectConfig.delay);
    } else {
      this.emit(
        "error",
        new Error(
          `Max reconnection attempts (${this.reconnectConfig.maxAttempts}) reached`
        )
      );
    }
  }

  /**
   * Handle incoming WebSocket messages
   * @param data - Raw message data
   */
  private handleMessage(data: string): void {
    try {
      const message: SignalingMessage = JSON.parse(data);

      switch (message.type) {
        case "room-created":
          this.resolvePendingRequest("create-room", message.roomId);
          break;

        case "room-joined":
          this.resolvePendingRequest("join-room", message.participants);
          break;

        case "user-joined":
          this.emit("userJoined", message.user);
          break;

        case "user-left":
          this.emit("userLeft", message.userId);
          break;

        case "offer":
          this.emit("offer", message.fromId, message.offer);
          break;

        case "answer":
          this.emit("answer", message.fromId, message.answer);
          break;

        case "ice-candidate":
          this.emit("iceCandidate", message.fromId, message.candidate);
          break;

        case "error":
          this.rejectPendingRequests(new Error(message.message));
          this.emit("error", new Error(message.message));
          break;
      }
    } catch (error) {
      this.emit("error", new Error("Failed to parse signaling message"));
    }
  }

  /**
   * Send a message to the signaling server
   * @param message - Signaling message to send
   */
  private send(message: SignalingMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected");
    }
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Create a new room
   * @returns Promise that resolves with the room ID
   */
  createRoom(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.pendingRequests.set("create-room", { resolve, reject });
      try {
        this.send({ type: "create-room" });
      } catch (error) {
        this.pendingRequests.delete("create-room");
        reject(error);
      }
    });
  }

  /**
   * Join an existing room
   * @param roomId - Room ID to join
   * @param userId - User ID
   * @param userName - User name
   * @returns Promise that resolves with the list of participants
   */
  joinRoom(
    roomId: string,
    userId: string,
    userName: string
  ): Promise<Participant[]> {
    return new Promise((resolve, reject) => {
      this.pendingRequests.set("join-room", { resolve, reject });
      try {
        this.send({ type: "join-room", roomId, userId, userName });
      } catch (error) {
        this.pendingRequests.delete("join-room");
        reject(error);
      }
    });
  }

  /**
   * Leave the current room
   */
  leaveRoom(): void {
    // In the current design, leaving is handled by disconnecting
    // or the server will handle it when the connection closes
    // This method is here for API completeness
  }

  /**
   * Send an offer to a peer
   * @param targetId - Target peer ID
   * @param fromId - Sender ID
   * @param offer - RTC session description (offer)
   */
  sendOffer(
    targetId: string,
    fromId: string,
    offer: RTCSessionDescriptionInit
  ): void {
    this.send({ type: "offer", targetId, fromId, offer });
  }

  /**
   * Send an answer to a peer
   * @param targetId - Target peer ID
   * @param fromId - Sender ID
   * @param answer - RTC session description (answer)
   */
  sendAnswer(
    targetId: string,
    fromId: string,
    answer: RTCSessionDescriptionInit
  ): void {
    this.send({ type: "answer", targetId, fromId, answer });
  }

  /**
   * Send an ICE candidate to a peer
   * @param targetId - Target peer ID
   * @param fromId - Sender ID
   * @param candidate - ICE candidate
   */
  sendIceCandidate(
    targetId: string,
    fromId: string,
    candidate: RTCIceCandidateInit
  ): void {
    this.send({ type: "ice-candidate", targetId, fromId, candidate });
  }

  /**
   * Resolve a pending request
   * @param requestType - Type of request to resolve
   * @param value - Value to resolve with
   */
  private resolvePendingRequest(requestType: string, value: any): void {
    const request = this.pendingRequests.get(requestType);
    if (request) {
      request.resolve(value);
      this.pendingRequests.delete(requestType);
    }
  }

  /**
   * Reject all pending requests
   * @param error - Error to reject with
   */
  private rejectPendingRequests(error: Error): void {
    for (const [key, request] of this.pendingRequests) {
      request.reject(error);
    }
    this.pendingRequests.clear();
  }
}
