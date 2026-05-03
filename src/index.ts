/**
 * aves-core - WebRTC client library
 *
 * Main exports for the aves-core package
 */

// Main client class
export { AvesClient } from "./core/AvesClient";
export type { AvesClientEvents } from "./core/AvesClient";

// Core components (for advanced usage)
export { AvesError } from "./core/AvesError";
export type { AvesErrorCode } from "./core/AvesError";
export { EventEmitter } from "./core/EventEmitter";
export { WebRTCManager } from "./core/WebRTCManager";
export { SignalingClient } from "./core/SignalingClient";

// Type definitions
export type {
  Participant,
  AvesMessage,
  AvesClientConfig,
  AvesVideoConstraints,
  FileTransferOptions,
  FileTransferInfo,
  FileTransferProgress,
  FileTransferResult,
  LocalAudioState,
  LocalVideoState,
  ScreenShareState,
  ScreenShareSource,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  SignalingMessage,
  SignalingErrorCode,
  SignalingErrorStage,
  SignalingErrorPayload,
  JoinRoomResult,
  ReconnectConfig,
} from "./types/types";
