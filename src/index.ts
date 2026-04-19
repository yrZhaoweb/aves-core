/**
 * aves-core - WebRTC client library
 *
 * Main exports for the aves-core package
 */

// Main client class
export { AvesClient } from "./core/AvesClient";

// Core components (for advanced usage)
export { EventEmitter } from "./core/EventEmitter";
export { WebRTCManager } from "./core/WebRTCManager";
export { SignalingClient } from "./core/SignalingClient";

// Type definitions
export type {
  Participant,
  AvesClientConfig,
  FileTransferOptions,
  FileTransferInfo,
  FileTransferProgress,
  FileTransferResult,
  LocalAudioState,
  SignalingMessage,
  SignalingErrorCode,
  SignalingErrorStage,
  SignalingErrorPayload,
  JoinRoomResult,
  LeaveRoomResult,
  ReconnectConfig,
} from "./types/types";
