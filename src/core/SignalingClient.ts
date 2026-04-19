import { EventEmitter } from "./EventEmitter";
import {
  JoinRoomResult,
  LeaveRoomResult,
  Participant,
  ReconnectConfig,
  SignalingErrorCode,
  SignalingErrorPayload,
  SignalingErrorStage,
  SignalingMessage,
} from "../types/types";

class SignalingClientError extends Error {
  code: SignalingErrorCode;
  stage: SignalingErrorStage;
  retryable: boolean;
  requestId?: string;

  constructor(payload: SignalingErrorPayload) {
    super(payload.message);
    this.name = "SignalingClientError";
    this.code = payload.code;
    this.stage = payload.stage;
    this.retryable = payload.retryable;
    this.requestId = payload.requestId;
  }
}

interface PendingRequest<T> {
  type: "create-room" | "join-room" | "leave-room";
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

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
  private pendingRequests: Map<string, PendingRequest<any>> = new Map();
  private requestCounter = 0;

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
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    this.rejectPendingRequests(
      new SignalingClientError({
        message: "Signaling connection closed",
        code: "SERVER_ERROR",
        stage: "transport",
        retryable: true,
      }),
    );
    this.emit("stateChange", "disconnected");
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Handle WebSocket disconnection and attempt reconnection
   */
  private handleDisconnect(): void {
    this.ws = null;
    this.rejectPendingRequests(
      new SignalingClientError({
        message: "Signaling connection closed",
        code: "SERVER_ERROR",
        stage: "transport",
        retryable: true,
      }),
    );

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
          this.resolvePendingRequest(message.requestId, "create-room", message.roomId);
          break;

        case "room-joined":
          this.resolvePendingRequest(message.requestId, "join-room", {
            participants: message.participants,
            userId: message.userId,
          });
          break;

        case "room-left":
          this.resolvePendingRequest(message.requestId, "leave-room", {
            roomId: message.roomId,
            userId: message.userId,
          });
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
          this.handleErrorMessage(message);
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
    const requestId = this.createRequestId("create-room");
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        type: "create-room",
        resolve,
        reject,
      });
      try {
        this.send({ type: "create-room", requestId });
      } catch (error) {
        this.pendingRequests.delete(requestId);
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
  joinRoom(roomId: string, userName: string): Promise<JoinRoomResult>;
  joinRoom(roomId: string, userId: string, userName: string): Promise<JoinRoomResult>;
  joinRoom(
    roomId: string,
    userIdOrName: string,
    maybeUserName?: string
  ): Promise<JoinRoomResult> {
    const requestId = this.createRequestId("join-room");
    const userId = maybeUserName ? userIdOrName : undefined;
    const userName = maybeUserName ?? userIdOrName;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        type: "join-room",
        resolve,
        reject,
      });
      try {
        this.send({ type: "join-room", roomId, userId, userName, requestId });
      } catch (error) {
        this.pendingRequests.delete(requestId);
        reject(error);
      }
    });
  }

  /**
   * Leave the current room
   */
  leaveRoom(userId: string): Promise<void> {
    const requestId = this.createRequestId("leave-room");

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        type: "leave-room",
        resolve: () => resolve(),
        reject,
      });
      try {
        this.send({ type: "leave-room", userId, requestId });
      } catch (error) {
        this.pendingRequests.delete(requestId);
        reject(error);
      }
    });
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
  private resolvePendingRequest<T>(
    requestId: string | undefined,
    requestType: PendingRequest<T>["type"],
    value: T,
  ): void {
    const request = requestId
      ? (this.pendingRequests.get(requestId) as PendingRequest<T> | undefined)
      : this.findPendingRequestByType<T>(requestType);

    if (request) {
      request.resolve(value);
      if (requestId) {
        this.pendingRequests.delete(requestId);
      } else {
        this.deletePendingRequestByReference(request);
      }
    }
  }

  private handleErrorMessage(message: Extract<SignalingMessage, { type: "error" }>): void {
    const error = new SignalingClientError(message);

    if (message.requestId) {
      const request = this.pendingRequests.get(message.requestId);
      if (request) {
        request.reject(error);
        this.pendingRequests.delete(message.requestId);
      }
    } else {
      this.rejectPendingRequests(error);
    }

    this.emit("error", error);
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

  private createRequestId(prefix: string): string {
    this.requestCounter += 1;
    return `${prefix}-${Date.now()}-${this.requestCounter}`;
  }

  private findPendingRequestByType<T>(
    requestType: PendingRequest<T>["type"],
  ): PendingRequest<T> | undefined {
    for (const request of this.pendingRequests.values()) {
      if (request.type === requestType) {
        return request as PendingRequest<T>;
      }
    }
    return undefined;
  }

  private deletePendingRequestByReference(request: PendingRequest<any>): void {
    for (const [requestId, candidate] of this.pendingRequests.entries()) {
      if (candidate === request) {
        this.pendingRequests.delete(requestId);
        return;
      }
    }
  }
}
