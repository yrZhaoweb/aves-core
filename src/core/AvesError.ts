import type { SignalingErrorCode, SignalingErrorStage } from "../types/types";

/**
 * All error codes used across the aves ecosystem.
 * Signaling codes come from the shared type; runtime codes extend it.
 */
export type AvesErrorCode =
  | SignalingErrorCode
  | "WEBRTC_CONNECTION_FAILED"
  | "WEBRTC_DATACHANNEL_FAILED"
  | "WEBRTC_ICE_FAILED"
  | "MEDIA_CAPTURE_FAILED"
  | "MEDIA_NOT_AVAILABLE"
  | "FILE_TRANSFER_FAILED"
  | "FILE_TRANSFER_TIMEOUT"
  | "FILE_TRANSFER_REJECTED"
  | "FILE_CHANNEL_NOT_READY"
  | "MESSAGE_CHANNEL_NOT_READY"
  | "MESSAGE_PARSE_FAILED"
  | "MESSAGE_SEND_FAILED"
  | "MESSAGE_SERIALIZE_FAILED"
  | "UNKNOWN_ERROR"
  | (string & {});

/**
 * Structured error class used throughout aves-core and aves-node.
 *
 * Every error carries the operation context (peerId, roomId, requestId)
 * so callers can react programmatically instead of string-matching error messages.
 *
 * The `cause` field preserves the original error (e.g. from a WebSocket
 * or getUserMedia failure) for debugging.
 */
export class AvesError extends Error {
  readonly code: AvesErrorCode;
  readonly stage: SignalingErrorStage;
  readonly retryable: boolean;
  readonly peerId?: string;
  readonly roomId?: string;
  readonly requestId?: string;
  readonly cause?: unknown;

  constructor(opts: {
    message: string;
    code: AvesErrorCode;
    stage: SignalingErrorStage;
    retryable: boolean;
    peerId?: string;
    roomId?: string;
    requestId?: string;
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = "AvesError";
    this.code = opts.code;
    this.stage = opts.stage;
    this.retryable = opts.retryable;
    this.peerId = opts.peerId;
    this.roomId = opts.roomId;
    this.requestId = opts.requestId;
    this.cause = opts.cause;
  }

  /**
   * Serialise to a plain object for logging or transmission over the wire.
   * `cause` is deliberately excluded — it may contain non-serialisable objects.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      stage: this.stage,
      retryable: this.retryable,
      peerId: this.peerId,
      roomId: this.roomId,
      requestId: this.requestId,
    };
  }
}
