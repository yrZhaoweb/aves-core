import { EventEmitter } from "./EventEmitter";
import { AvesError } from "./AvesError";
import {
  JoinRoomResult,
  Participant,
  ReconnectConfig,
  SignalingErrorPayload,
  SignalingMessage,
} from "../types/types";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type SignalingClientEvents = {
  stateChange: [state: string];
  error: [error: AvesError];
  userJoined: [user: Participant];
  userLeft: [userId: string];
  offer: [fromId: string, offer: RTCSessionDescriptionInit];
  answer: [fromId: string, answer: RTCSessionDescriptionInit];
  iceCandidate: [fromId: string, candidate: RTCIceCandidateInit];
};

interface PendingRequest<T> {
  type: "create-room" | "join-room" | "leave-room";
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * SignalingClient manages WebSocket connection and signaling message exchange
 * Extends EventEmitter to provide event-driven communication
 */
export class SignalingClient extends EventEmitter<SignalingClientEvents> {
  private ws: WebSocket | null = null;
  private reconnectConfig: ReconnectConfig;
  private requestTimeoutMs: number;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private url: string = "";
  private shouldReconnect: boolean = true;
  private pendingRequests: Map<string, PendingRequest<any>> = new Map();
  private requestCounter = 0;

  constructor(reconnectConfig: ReconnectConfig) {
    super();
    this.reconnectConfig = reconnectConfig;
    this.requestTimeoutMs =
      reconnectConfig.requestTimeoutMs && reconnectConfig.requestTimeoutMs > 0
        ? reconnectConfig.requestTimeoutMs
        : DEFAULT_REQUEST_TIMEOUT_MS;
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
          this.emit("error", new AvesError({ message: "WebSocket error", code: "SERVER_ERROR", stage: "transport", retryable: true }));
          reject(new AvesError({ message: "WebSocket connection failed", code: "SERVER_ERROR", stage: "transport", retryable: true }));
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.emit("stateChange", "connecting");
      } catch (error) {
        reject(new AvesError({ message: `WebSocket construction failed: ${errorMessage(error)}`, code: "SERVER_ERROR", stage: "transport", retryable: true }));
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
      new AvesError({
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
      new AvesError({
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
          this.emit(
            "error",
            new AvesError({
              message: `Reconnection attempt ${this.reconnectAttempts} failed: ${errorMessage(error)}`,
              code: "SERVER_ERROR",
              stage: "transport",
              retryable: true,
            }),
          );
        });
      }, this.reconnectConfig.delay);
    } else {
      this.emit(
        "error",
        new AvesError({
          message: `Max reconnection attempts (${this.reconnectConfig.maxAttempts}) reached`,
          code: "SERVER_ERROR",
          stage: "transport",
          retryable: false,
        }),
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
      this.emit("error", new AvesError({ message: "Failed to parse signaling message", code: "INVALID_MESSAGE_FORMAT", stage: "protocol", retryable: false }));
    }
  }

  /**
   * Send a message to the signaling server
   * @param message - Signaling message to send
   */
  private send(message: SignalingMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new AvesError({ message: "WebSocket is not connected", code: "SERVER_ERROR", stage: "transport", retryable: true });
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
      this.trackPendingRequest(requestId, "create-room", resolve, reject);
      try {
        this.send({ type: "create-room", requestId });
      } catch (error) {
        this.deletePendingRequest(requestId);
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
      this.trackPendingRequest(requestId, "join-room", resolve, reject);
      try {
        this.send({ type: "join-room", roomId, userId, userName, requestId });
      } catch (error) {
        this.deletePendingRequest(requestId);
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
      this.trackPendingRequest(requestId, "leave-room", () => resolve(), reject);
      try {
        this.send({ type: "leave-room", userId, requestId });
      } catch (error) {
        this.deletePendingRequest(requestId);
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
    try {
      this.send({ type: "offer", targetId, fromId, offer });
    } catch (error) {
      this.emit(
        "error",
        new AvesError({ message: `Failed to send offer to ${targetId}: ${errorMessage(error)}`, code: "SERVER_ERROR", stage: "transport", retryable: true, peerId: targetId }),
      );
    }
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
    try {
      this.send({ type: "answer", targetId, fromId, answer });
    } catch (error) {
      this.emit(
        "error",
        new AvesError({ message: `Failed to send answer to ${targetId}: ${errorMessage(error)}`, code: "SERVER_ERROR", stage: "transport", retryable: true, peerId: targetId }),
      );
    }
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
    try {
      this.send({ type: "ice-candidate", targetId, fromId, candidate });
    } catch (error) {
      this.emit(
        "error",
        new AvesError({ message: `Failed to send ICE candidate to ${targetId}: ${errorMessage(error)}`, code: "WEBRTC_ICE_FAILED", stage: "transport", retryable: true, peerId: targetId }),
      );
    }
  }

  /**
   * Resolve a pending request by its requestId.
   * If the server response omitted the requestId, we reject all pending
   * requests of that type rather than guessing which one to resolve.
   */
  private resolvePendingRequest<T>(
    requestId: string | undefined,
    requestType: PendingRequest<T>["type"],
    value: T,
  ): void {
    if (!requestId) {
      // Server response missing requestId — can't match to a specific request.
      // Reject all pending requests of this type so they don't hang forever.
      this.rejectPendingRequestsByType(
        requestType,
        new AvesError({
          message: `Server responded to ${requestType} without requestId`,
          code: "SERVER_ERROR",
          stage: "transport",
          retryable: true,
        }),
      );
      return;
    }

    const request = this.pendingRequests.get(requestId) as
      | PendingRequest<T>
      | undefined;

    if (request) {
      this.deletePendingRequest(requestId);
      request.resolve(value);
    }
  }

  private handleErrorMessage(message: Extract<SignalingMessage, { type: "error" }>): void {
    const error = new AvesError(message);

    if (message.requestId) {
      const request = this.pendingRequests.get(message.requestId);
      if (request) {
        this.deletePendingRequest(message.requestId);
        request.reject(error);
      }
    }

    this.emit("error", error);
  }

  private trackPendingRequest<T>(
    requestId: string,
    type: PendingRequest<T>["type"],
    resolve: (value: T) => void,
    reject: (error: Error) => void,
  ): void {
    const timeoutId = setTimeout(() => {
      const request = this.pendingRequests.get(requestId);
      if (!request) {
        return;
      }

      this.pendingRequests.delete(requestId);
      const error = new AvesError({
        message: `Signaling request ${type} timed out after ${this.requestTimeoutMs}ms`,
        code: "SIGNALING_REQUEST_TIMEOUT",
        stage: "transport",
        retryable: true,
        requestId,
      });
      request.reject(error);
      this.emit("error", error);
    }, this.requestTimeoutMs);

    this.pendingRequests.set(requestId, {
      type,
      resolve,
      reject,
      timeoutId,
    });
  }

  private deletePendingRequest(requestId: string): void {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      return;
    }

    clearTimeout(request.timeoutId);
    this.pendingRequests.delete(requestId);
  }

  /**
   * Reject all pending requests
   * @param error - Error to reject with
   */
  private rejectPendingRequests(error: Error): void {
    for (const [key, request] of this.pendingRequests) {
      clearTimeout(request.timeoutId);
      request.reject(error);
    }
    this.pendingRequests.clear();
  }

  /**
   * Reject all pending requests of a specific type.
   */
  private rejectPendingRequestsByType<T>(
    requestType: PendingRequest<T>["type"],
    error: Error,
  ): void {
    for (const [requestId, request] of this.pendingRequests) {
      if (request.type === requestType) {
        clearTimeout(request.timeoutId);
        request.reject(error);
        this.pendingRequests.delete(requestId);
      }
    }
  }

  private createRequestId(prefix: string): string {
    this.requestCounter += 1;
    return `${prefix}-${Date.now()}-${this.requestCounter}`;
  }
}
