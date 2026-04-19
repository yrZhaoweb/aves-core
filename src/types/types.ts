// Shared types for aves-core

export interface Participant {
  id: string;
  name: string;
}

export type SignalingErrorCode =
  | "INVALID_MESSAGE_FORMAT"
  | "INVALID_MESSAGE"
  | "ROOM_NOT_FOUND"
  | "ROOM_CREATE_FAILED"
  | "ROOM_JOIN_FAILED"
  | "JOIN_ROOM_MISSING_FIELDS"
  | "ALREADY_JOINED"
  | "LEAVE_NOT_JOINED"
  | "LEAVE_USER_MISMATCH"
  | "SIGNALING_NOT_AUTHENTICATED"
  | "SIGNALING_FORBIDDEN"
  | "SIGNALING_TARGET_NOT_FOUND"
  | "SIGNALING_TARGET_ROOM_MISMATCH"
  | "SERVER_ERROR"
  | (string & {});

export type SignalingErrorStage =
  | "protocol"
  | "room"
  | "signaling"
  | "transport"
  | "server"
  | (string & {});

export interface SignalingErrorPayload {
  message: string;
  code: SignalingErrorCode;
  stage: SignalingErrorStage;
  retryable: boolean;
  requestId?: string;
}

export interface JoinRoomResult {
  participants: Participant[];
  userId: string;
}

export interface LeaveRoomResult {
  roomId: string;
  userId: string;
}

export interface AvesClientConfig {
  signalingUrl: string;
  iceServers?: RTCIceServer[];
  fileChunkSize?: number;
  reconnect?: {
    maxAttempts?: number;
    delay?: number;
  };
  debug?: boolean;
}

export interface FileTransferOptions {
  peerId?: string;
  fileName?: string;
  mimeType?: string;
  lastModified?: number;
  chunkSize?: number;
}

export type FileTransferDirection = "send" | "receive";

export interface FileTransferInfo {
  transferId: string;
  peerId: string;
  direction: FileTransferDirection;
  name: string;
  size: number;
  mimeType: string;
  lastModified: number;
}

export interface FileTransferProgress extends FileTransferInfo {
  bytesTransferred: number;
  progress: number;
}

export interface FileTransferResult extends FileTransferInfo {
  blob?: Blob;
}

export interface LocalAudioState {
  active: boolean;
  muted: boolean;
}

// Signaling message types
export type SignalingMessage =
  | { type: "create-room"; requestId?: string }
  | { type: "room-created"; roomId: string; requestId?: string }
  | {
      type: "join-room";
      roomId: string;
      userId?: string;
      userName: string;
      requestId?: string;
    }
  | {
      type: "room-joined";
      participants: Participant[];
      userId: string;
      requestId?: string;
    }
  | { type: "leave-room"; userId: string; requestId?: string }
  | { type: "room-left"; roomId: string; userId: string; requestId?: string }
  | { type: "user-joined"; user: Participant }
  | { type: "user-left"; userId: string }
  | {
      type: "offer";
      fromId: string;
      targetId: string;
      offer: RTCSessionDescriptionInit;
    }
  | {
      type: "answer";
      fromId: string;
      targetId: string;
      answer: RTCSessionDescriptionInit;
    }
  | {
      type: "ice-candidate";
      fromId: string;
      targetId: string;
      candidate: RTCIceCandidateInit;
    }
  | ({ type: "error" } & SignalingErrorPayload);

export interface ReconnectConfig {
  maxAttempts: number;
  delay: number;
}
