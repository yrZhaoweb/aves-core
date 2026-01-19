// Shared types for aves-core

export interface Participant {
  id: string;
  name: string;
}

export interface AvesClientConfig {
  signalingUrl: string;
  iceServers?: RTCIceServer[];
  reconnect?: {
    maxAttempts?: number;
    delay?: number;
  };
  debug?: boolean;
}

// Signaling message types
export type SignalingMessage =
  | { type: "create-room" }
  | { type: "room-created"; roomId: string }
  | { type: "join-room"; roomId: string; userId: string; userName: string }
  | { type: "room-joined"; participants: Participant[] }
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
  | { type: "error"; message: string };

export interface ReconnectConfig {
  maxAttempts: number;
  delay: number;
}
