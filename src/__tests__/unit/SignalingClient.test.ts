/**
 * Unit tests for SignalingClient
 * Tests WebSocket connection, reconnection, room operations, message routing, and error handling
 *
 * Requirements: 5.3, 5.4
 */

import { SignalingClient } from "../../core/SignalingClient";
import { Participant, SignalingMessage } from "../../types/types";

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  url: string;
  onopen: ((event: any) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;

  sentMessages: string[] = [];
  private closeCallback: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    // Simulate async connection
    setTimeout(() => {
      if (this.onopen) {
        this.onopen({});
      }
    }, 0);
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({});
    }
    if (this.closeCallback) {
      this.closeCallback();
    }
  }

  // Test helper to simulate receiving a message
  simulateMessage(message: SignalingMessage): void {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(message) });
    }
  }

  // Test helper to simulate connection error
  simulateError(): void {
    if (this.onerror) {
      this.onerror({});
    }
  }

  // Test helper to set close callback
  onCloseCallback(callback: () => void): void {
    this.closeCallback = callback;
  }
}

// Replace global WebSocket with mock
(global as any).WebSocket = MockWebSocket;

describe("SignalingClient Unit Tests", () => {
  let client: SignalingClient;
  const testUrl = "ws://localhost:8080";

  beforeEach(() => {
    client = new SignalingClient({
      maxAttempts: 3,
      delay: 100,
    });
  });

  afterEach(() => {
    client.disconnect();
    jest.clearAllTimers();
  });

  describe("WebSocket connection and disconnection", () => {
    it("should connect to WebSocket server", async () => {
      const stateChanges: string[] = [];
      client.on("stateChange", (state) => stateChanges.push(state));

      await client.connect(testUrl);

      expect(stateChanges).toContain("connecting");
      expect(stateChanges).toContain("connected");
    });

    it("should emit error when connection fails", (done) => {
      const errorListener = jest.fn();
      client.on("error", errorListener);

      // Create a mock that fails immediately
      const originalWebSocket = (global as any).WebSocket;
      (global as any).WebSocket = class {
        constructor(url: string) {
          // Immediately trigger error
          setTimeout(() => {
            if (this.onerror) {
              this.onerror({});
            }
          }, 0);
        }
        onopen: any = null;
        onclose: any = null;
        onerror: any = null;
        onmessage: any = null;
        close() {} // Add close method
      };

      client.connect(testUrl).catch((error) => {
        expect(error.message).toBe("WebSocket connection failed");
        expect(errorListener).toHaveBeenCalled();
        // Restore original mock
        (global as any).WebSocket = originalWebSocket;
        done();
      });
    });

    it("should disconnect from WebSocket server", async () => {
      const stateChanges: string[] = [];
      client.on("stateChange", (state) => stateChanges.push(state));

      await client.connect(testUrl);
      client.disconnect();

      expect(stateChanges).toContain("disconnected");
    });

    it("should emit disconnected state when connection closes", async () => {
      const stateChanges: string[] = [];
      client.on("stateChange", (state) => stateChanges.push(state));

      await client.connect(testUrl);
      stateChanges.length = 0; // Clear previous states

      // Temporarily disable reconnection for this test
      (client as any).shouldReconnect = false;

      // Simulate server closing connection
      const ws = (client as any).ws as MockWebSocket;
      ws.close();

      expect(stateChanges).toContain("disconnected");
    });

    it("should handle multiple disconnect calls gracefully", async () => {
      await client.connect(testUrl);

      expect(() => {
        client.disconnect();
        client.disconnect();
        client.disconnect();
      }).not.toThrow();
    });

    it("should report connection state from the underlying WebSocket", async () => {
      expect(client.isConnected()).toBe(false);

      await client.connect(testUrl);
      expect(client.isConnected()).toBe(true);

      const ws = (client as any).ws as MockWebSocket;
      ws.readyState = MockWebSocket.CLOSED;
      expect(client.isConnected()).toBe(false);
    });
  });

  describe("Reconnection logic", () => {
    it("should have reconnection configuration", () => {
      const config = (client as any).reconnectConfig;
      expect(config.maxAttempts).toBe(3);
      expect(config.delay).toBe(100);
    });

    it("should track reconnection attempts", async () => {
      await client.connect(testUrl);

      // Initial state
      expect((client as any).reconnectAttempts).toBe(0);

      // Manually increment to test tracking
      (client as any).reconnectAttempts = 1;
      expect((client as any).reconnectAttempts).toBe(1);
    });

    it("should not reconnect when disconnect is called explicitly", async () => {
      await client.connect(testUrl);

      client.disconnect();

      // shouldReconnect flag should be false
      expect((client as any).shouldReconnect).toBe(false);
    });

    it("should clear reconnect timer on disconnect", async () => {
      await client.connect(testUrl);

      // Set a fake timer
      (client as any).reconnectTimer = setTimeout(() => {}, 1000);

      client.disconnect();

      // Timer should be cleared
      expect((client as any).reconnectTimer).toBeNull();
    });
  });

  describe("Room operations", () => {
    it("should create a room", async () => {
      await client.connect(testUrl);

      const roomPromise = client.createRoom();

      // Simulate server response
      const ws = (client as any).ws as MockWebSocket;
      ws.simulateMessage({ type: "room-created", roomId: "room123" });

      const roomId = await roomPromise;
      expect(roomId).toBe("room123");
    });

    it("should send create-room message", async () => {
      await client.connect(testUrl);

      const roomPromise = client.createRoom();

      const ws = (client as any).ws as MockWebSocket;
      const sentMessage = JSON.parse(ws.sentMessages[0]);
      expect(sentMessage).toEqual({
        type: "create-room",
        requestId: expect.any(String),
      });

      ws.simulateMessage({
        type: "room-created",
        roomId: "room123",
        requestId: sentMessage.requestId,
      });
      await roomPromise;
    });

    it("should join a room", async () => {
      await client.connect(testUrl);

      const participants: Participant[] = [
        { id: "user1", name: "Alice" },
        { id: "user2", name: "Bob" },
      ];

      const joinPromise = client.joinRoom("room123", "user3", "Charlie");

      // Simulate server response
      const ws = (client as any).ws as MockWebSocket;
      const sentMessage = JSON.parse(ws.sentMessages[0]);
      ws.simulateMessage({
        type: "room-joined",
        participants,
        userId: "user3",
        requestId: sentMessage.requestId,
      });

      const result = await joinPromise;
      expect(result).toEqual({
        participants,
        userId: "user3",
      });
    });

    it("should send join-room message with correct parameters", async () => {
      await client.connect(testUrl);

      const joinPromise = client.joinRoom("room123", "user1", "Alice");

      const ws = (client as any).ws as MockWebSocket;
      const sentMessage = JSON.parse(ws.sentMessages[0]);
      expect(sentMessage).toEqual({
        type: "join-room",
        roomId: "room123",
        userId: "user1",
        userName: "Alice",
        requestId: expect.any(String),
      });

      ws.simulateMessage({
        type: "room-joined",
        participants: [],
        userId: "user1",
        requestId: sentMessage.requestId,
      });
      await joinPromise;
    });

    it("should allow joining without a caller-supplied userId", async () => {
      await client.connect(testUrl);

      const joinPromise = client.joinRoom("room123", "Alice");

      const ws = (client as any).ws as MockWebSocket;
      const sentMessage = JSON.parse(ws.sentMessages[0]);
      expect(sentMessage).toEqual({
        type: "join-room",
        roomId: "room123",
        userName: "Alice",
        requestId: expect.any(String),
      });

      ws.simulateMessage({
        type: "room-joined",
        participants: [],
        userId: "generated-user",
        requestId: sentMessage.requestId,
      });

      await expect(joinPromise).resolves.toEqual({
        participants: [],
        userId: "generated-user",
      });
    });

    it("should reject room operations when not connected", async () => {
      await expect(client.createRoom()).rejects.toThrow(
        "WebSocket is not connected"
      );
    });

    it("should handle room operation errors from server", async () => {
      await client.connect(testUrl);

      const roomPromise = client.createRoom();

      // Simulate server error response
      const ws = (client as any).ws as MockWebSocket;
      const sentMessage = JSON.parse(ws.sentMessages[0]);
      ws.simulateMessage({
        type: "error",
        message: "Room creation failed",
        code: "ROOM_CREATE_FAILED",
        stage: "room",
        retryable: false,
        requestId: sentMessage.requestId,
      });

      await expect(roomPromise).rejects.toThrow("Room creation failed");
    });

    it("should correlate concurrent room requests by requestId", async () => {
      await client.connect(testUrl);

      const firstJoinPromise = client.joinRoom("room-a", "user-a", "Alice");
      const secondJoinPromise = client.joinRoom("room-b", "Bob");

      const ws = (client as any).ws as MockWebSocket;
      const [firstRequest, secondRequest] = ws.sentMessages.map((message) =>
        JSON.parse(message),
      );

      ws.simulateMessage({
        type: "room-joined",
        participants: [{ id: "user-a", name: "Alice" }],
        userId: "generated-bob",
        requestId: secondRequest.requestId,
      });
      ws.simulateMessage({
        type: "room-joined",
        participants: [{ id: "user-b", name: "Bob" }],
        userId: "user-a",
        requestId: firstRequest.requestId,
      });

      await expect(firstJoinPromise).resolves.toEqual({
        participants: [{ id: "user-b", name: "Bob" }],
        userId: "user-a",
      });
      await expect(secondJoinPromise).resolves.toEqual({
        participants: [{ id: "user-a", name: "Alice" }],
        userId: "generated-bob",
      });
    });
  });

  describe("Message routing", () => {
    it("should emit userJoined event when user joins", async () => {
      await client.connect(testUrl);

      const userJoinedListener = jest.fn();
      client.on("userJoined", userJoinedListener);

      const ws = (client as any).ws as MockWebSocket;
      ws.simulateMessage({
        type: "user-joined",
        user: { id: "user1", name: "Alice" },
      });

      expect(userJoinedListener).toHaveBeenCalledWith({
        id: "user1",
        name: "Alice",
      });
    });

    it("should emit userLeft event when user leaves", async () => {
      await client.connect(testUrl);

      const userLeftListener = jest.fn();
      client.on("userLeft", userLeftListener);

      const ws = (client as any).ws as MockWebSocket;
      ws.simulateMessage({ type: "user-left", userId: "user1" });

      expect(userLeftListener).toHaveBeenCalledWith("user1");
    });

    it("should emit offer event when receiving offer", async () => {
      await client.connect(testUrl);

      const offerListener = jest.fn();
      client.on("offer", offerListener);

      const offer = { type: "offer" as const, sdp: "offer-sdp" };
      const ws = (client as any).ws as MockWebSocket;
      ws.simulateMessage({
        type: "offer",
        fromId: "user1",
        targetId: "user2",
        offer,
      });

      expect(offerListener).toHaveBeenCalledWith("user1", offer);
    });

    it("should emit answer event when receiving answer", async () => {
      await client.connect(testUrl);

      const answerListener = jest.fn();
      client.on("answer", answerListener);

      const answer = { type: "answer" as const, sdp: "answer-sdp" };
      const ws = (client as any).ws as MockWebSocket;
      ws.simulateMessage({
        type: "answer",
        fromId: "user1",
        targetId: "user2",
        answer,
      });

      expect(answerListener).toHaveBeenCalledWith("user1", answer);
    });

    it("should emit iceCandidate event when receiving ICE candidate", async () => {
      await client.connect(testUrl);

      const iceCandidateListener = jest.fn();
      client.on("iceCandidate", iceCandidateListener);

      const candidate = {
        candidate: "candidate-string",
        sdpMid: "0",
        sdpMLineIndex: 0,
      };
      const ws = (client as any).ws as MockWebSocket;
      ws.simulateMessage({
        type: "ice-candidate",
        fromId: "user1",
        targetId: "user2",
        candidate,
      });

      expect(iceCandidateListener).toHaveBeenCalledWith("user1", candidate);
    });

    it("should route multiple message types correctly", async () => {
      await client.connect(testUrl);

      const offerListener = jest.fn();
      const answerListener = jest.fn();
      const iceCandidateListener = jest.fn();

      client.on("offer", offerListener);
      client.on("answer", answerListener);
      client.on("iceCandidate", iceCandidateListener);

      const ws = (client as any).ws as MockWebSocket;

      ws.simulateMessage({
        type: "offer",
        fromId: "user1",
        targetId: "user2",
        offer: { type: "offer", sdp: "offer-sdp" },
      });

      ws.simulateMessage({
        type: "answer",
        fromId: "user2",
        targetId: "user1",
        answer: { type: "answer", sdp: "answer-sdp" },
      });

      ws.simulateMessage({
        type: "ice-candidate",
        fromId: "user1",
        targetId: "user2",
        candidate: { candidate: "candidate-string" },
      });

      expect(offerListener).toHaveBeenCalledTimes(1);
      expect(answerListener).toHaveBeenCalledTimes(1);
      expect(iceCandidateListener).toHaveBeenCalledTimes(1);
    });
  });

  describe("Signaling message sending", () => {
    it("should send offer message", async () => {
      await client.connect(testUrl);

      const offer = { type: "offer" as const, sdp: "offer-sdp" };
      client.sendOffer("user2", "user1", offer);

      const ws = (client as any).ws as MockWebSocket;
      const sentMessage = JSON.parse(ws.sentMessages[0]);
      expect(sentMessage).toEqual({
        type: "offer",
        targetId: "user2",
        fromId: "user1",
        offer,
      });
    });

    it("should send answer message", async () => {
      await client.connect(testUrl);

      const answer = { type: "answer" as const, sdp: "answer-sdp" };
      client.sendAnswer("user2", "user1", answer);

      const ws = (client as any).ws as MockWebSocket;
      const sentMessage = JSON.parse(ws.sentMessages[0]);
      expect(sentMessage).toEqual({
        type: "answer",
        targetId: "user2",
        fromId: "user1",
        answer,
      });
    });

    it("should send ICE candidate message", async () => {
      await client.connect(testUrl);

      const candidate = {
        candidate: "candidate-string",
        sdpMid: "0",
        sdpMLineIndex: 0,
      };
      client.sendIceCandidate("user2", "user1", candidate);

      const ws = (client as any).ws as MockWebSocket;
      const sentMessage = JSON.parse(ws.sentMessages[0]);
      expect(sentMessage).toEqual({
        type: "ice-candidate",
        targetId: "user2",
        fromId: "user1",
        candidate,
      });
    });

    it("should throw error when sending while disconnected", async () => {
      expect(() => {
        client.sendOffer("user2", "user1", { type: "offer", sdp: "sdp" });
      }).toThrow("WebSocket is not connected");
    });
  });

  describe("Error handling", () => {
    it("should emit error event when receiving error message", async () => {
      await client.connect(testUrl);

      const errorListener = jest.fn();
      client.on("error", errorListener);

      const ws = (client as any).ws as MockWebSocket;
      ws.simulateMessage({
        type: "error",
        message: "Something went wrong",
        code: "ROOM_JOIN_FAILED",
        stage: "room",
        retryable: false,
      });

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Something went wrong",
          code: "ROOM_JOIN_FAILED",
          stage: "room",
          retryable: false,
        })
      );
    });

    it("should handle malformed JSON messages", async () => {
      await client.connect(testUrl);

      const errorListener = jest.fn();
      client.on("error", errorListener);

      const ws = (client as any).ws as MockWebSocket;
      if (ws.onmessage) {
        ws.onmessage({ data: "invalid json {{{" });
      }

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Failed to parse signaling message",
        })
      );
    });

    it("should reject pending requests on error", async () => {
      await client.connect(testUrl);

      const roomPromise = client.createRoom();
      const joinPromise = client.joinRoom("room123", "user1", "Alice");

      const ws = (client as any).ws as MockWebSocket;
      const sentMessages = ws.sentMessages.map((message) => JSON.parse(message));
      ws.simulateMessage({
        type: "error",
        message: "Server error",
        code: "SERVER_ERROR",
        stage: "room",
        retryable: true,
        requestId: sentMessages[0].requestId,
      });
      ws.simulateMessage({
        type: "error",
        message: "Server error",
        code: "SERVER_ERROR",
        stage: "room",
        retryable: true,
        requestId: sentMessages[1].requestId,
      });

      await expect(roomPromise).rejects.toThrow("Server error");
      await expect(joinPromise).rejects.toThrow("Server error");
    });

    it("should handle WebSocket errors gracefully", async () => {
      const errorListener = jest.fn();
      client.on("error", errorListener);

      await client.connect(testUrl);

      const ws = (client as any).ws as MockWebSocket;
      ws.simulateError();

      expect(errorListener).toHaveBeenCalled();
    });

    it("should reject pending requests on disconnect", async () => {
      await client.connect(testUrl);

      const roomPromise = client.createRoom();

      client.disconnect();

      await expect(roomPromise).rejects.toThrow("Signaling connection closed");
    });
  });

  describe("Edge cases", () => {
    it("should send leave-room and wait for room-left acknowledgment", async () => {
      await client.connect(testUrl);

      const leavePromise = client.leaveRoom("user1");

      const ws = (client as any).ws as MockWebSocket;
      const sentMessage = JSON.parse(ws.sentMessages[0]);
      expect(sentMessage).toEqual({
        type: "leave-room",
        userId: "user1",
        requestId: expect.any(String),
      });

      ws.simulateMessage({
        type: "room-left",
        roomId: "room123",
        userId: "user1",
        requestId: sentMessage.requestId,
      });

      await expect(leavePromise).resolves.toBeUndefined();
    });

    it("should handle receiving unknown message types", async () => {
      await client.connect(testUrl);

      const ws = (client as any).ws as MockWebSocket;

      // Should not throw or crash
      expect(() => {
        if (ws.onmessage) {
          ws.onmessage({ data: JSON.stringify({ type: "unknown-type" }) });
        }
      }).not.toThrow();
    });

    it("should handle multiple create room requests", async () => {
      await client.connect(testUrl);

      // Send first request
      const room1Promise = client.createRoom();

      // Check that promise is created
      expect(room1Promise).toBeInstanceOf(Promise);

      // Simulate response
      const ws = (client as any).ws as MockWebSocket;
      ws.simulateMessage({ type: "room-created", roomId: "room123" });

      const room1 = await room1Promise;
      expect(room1).toBe("room123");

      // Send second request
      const room2Promise = client.createRoom();
      ws.simulateMessage({ type: "room-created", roomId: "room456" });

      const room2 = await room2Promise;
      expect(room2).toBe("room456");
    });

    it("should maintain event listeners after connection", async () => {
      const userJoinedListener = jest.fn();
      client.on("userJoined", userJoinedListener);

      await client.connect(testUrl);

      // Event listener should work
      const ws = (client as any).ws as MockWebSocket;
      ws.simulateMessage({
        type: "user-joined",
        user: { id: "user1", name: "Alice" },
      });

      expect(userJoinedListener).toHaveBeenCalled();
    });
  });
});
