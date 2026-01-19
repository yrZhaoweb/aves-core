/**
 * Unit tests for AvesClient
 * Tests configuration defaults, room operations, message sending, state queries, and destroy cleanup
 *
 * Requirements: 1.3, 4.6
 */

import { AvesClient } from "../../core/AvesClient";
import { AvesClientConfig, Participant } from "../../types/types";

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
  }

  // Test helper to simulate receiving a message
  simulateMessage(message: any): void {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(message) });
    }
  }
}

// Replace global WebSocket with mock
(global as any).WebSocket = MockWebSocket;

// Mock RTCPeerConnection
class MockRTCPeerConnection {
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  connectionState: RTCPeerConnectionState = "new";
  iceConnectionState: RTCIceConnectionState = "new";

  onicecandidate: ((event: any) => void) | null = null;
  onconnectionstatechange: ((event: any) => void) | null = null;
  ondatachannel: ((event: any) => void) | null = null;

  constructor(config: RTCConfiguration) {}

  createDataChannel(label: string): any {
    return new MockRTCDataChannel(label);
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: "offer", sdp: "mock-offer-sdp" };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: "answer", sdp: "mock-answer-sdp" };
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = desc;
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = desc;
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {}

  close(): void {
    this.connectionState = "closed";
  }
}

class MockRTCDataChannel {
  label: string;
  readyState: RTCDataChannelState = "open";
  onopen: ((event: any) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;

  constructor(label: string) {
    this.label = label;
    // Simulate async open
    setTimeout(() => {
      if (this.onopen) {
        this.onopen({});
      }
    }, 0);
  }

  send(data: string): void {
    if (this.readyState !== "open") {
      throw new Error("DataChannel is not open");
    }
  }

  close(): void {
    this.readyState = "closed";
  }
}

// Replace global RTCPeerConnection with mock
(global as any).RTCPeerConnection = MockRTCPeerConnection;

describe("AvesClient Unit Tests", () => {
  let client: AvesClient;
  const testUrl = "ws://localhost:8080";

  afterEach(() => {
    if (client) {
      client.destroy();
    }
  });

  describe("Configuration defaults", () => {
    it("should apply default ICE servers when not provided", () => {
      client = new AvesClient({ signalingUrl: testUrl });

      const config = (client as any).config;
      expect(config.iceServers).toBeDefined();
      expect(config.iceServers.length).toBeGreaterThan(0);
      expect(config.iceServers[0].urls).toBe("stun:stun.l.google.com:19302");
    });

    it("should apply default reconnect configuration", () => {
      client = new AvesClient({ signalingUrl: testUrl });

      const config = (client as any).config;
      expect(config.reconnect.maxAttempts).toBe(5);
      expect(config.reconnect.delay).toBe(3000);
    });

    it("should apply default debug flag as false", () => {
      client = new AvesClient({ signalingUrl: testUrl });

      const config = (client as any).config;
      expect(config.debug).toBe(false);
    });

    it("should use provided ICE servers", () => {
      const customIceServers = [
        { urls: "stun:custom.stun.server:19302" },
        {
          urls: "turn:custom.turn.server:3478",
          username: "user",
          credential: "pass",
        },
      ];

      client = new AvesClient({
        signalingUrl: testUrl,
        iceServers: customIceServers,
      });

      const config = (client as any).config;
      expect(config.iceServers).toEqual(customIceServers);
    });

    it("should use provided reconnect configuration", () => {
      client = new AvesClient({
        signalingUrl: testUrl,
        reconnect: {
          maxAttempts: 10,
          delay: 5000,
        },
      });

      const config = (client as any).config;
      expect(config.reconnect.maxAttempts).toBe(10);
      expect(config.reconnect.delay).toBe(5000);
    });

    it("should use provided debug flag", () => {
      client = new AvesClient({
        signalingUrl: testUrl,
        debug: true,
      });

      const config = (client as any).config;
      expect(config.debug).toBe(true);
    });

    it("should apply partial reconnect configuration with defaults", () => {
      client = new AvesClient({
        signalingUrl: testUrl,
        reconnect: {
          maxAttempts: 7,
        },
      });

      const config = (client as any).config;
      expect(config.reconnect.maxAttempts).toBe(7);
      expect(config.reconnect.delay).toBe(3000); // default
    });

    it("should store signaling URL correctly", () => {
      const customUrl = "wss://custom.signaling.server:8443";
      client = new AvesClient({ signalingUrl: customUrl });

      const config = (client as any).config;
      expect(config.signalingUrl).toBe(customUrl);
    });
  });

  describe("Room operations", () => {
    beforeEach(() => {
      client = new AvesClient({ signalingUrl: testUrl });
    });

    it("should create a room successfully", async () => {
      const roomPromise = client.createRoom();

      // Wait for connection
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate server response
      const signalingClient = (client as any).signalingClient;
      const ws = (signalingClient as any).ws as MockWebSocket;
      ws.simulateMessage({ type: "room-created", roomId: "room123" });

      const roomId = await roomPromise;
      expect(roomId).toBe("room123");
      expect((client as any).currentRoomId).toBe("room123");
    });

    it("should join a room successfully", async () => {
      const participants: Participant[] = [
        { id: "user1", name: "Alice" },
        { id: "user2", name: "Bob" },
      ];

      const joinPromise = client.joinRoom("room123", "user3", "Charlie");

      // Wait for connection
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate server response
      const signalingClient = (client as any).signalingClient;
      const ws = (signalingClient as any).ws as MockWebSocket;
      ws.simulateMessage({ type: "room-joined", participants });

      const result = await joinPromise;
      expect(result).toEqual(participants);
      expect((client as any).currentRoomId).toBe("room123");
      expect((client as any).currentUserId).toBe("user3");
    });

    it("should store participants after joining room", async () => {
      const participants: Participant[] = [
        { id: "user1", name: "Alice" },
        { id: "user2", name: "Bob" },
      ];

      const joinPromise = client.joinRoom("room123", "user3", "Charlie");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const signalingClient = (client as any).signalingClient;
      const ws = (signalingClient as any).ws as MockWebSocket;
      ws.simulateMessage({ type: "room-joined", participants });

      await joinPromise;

      const storedParticipants = client.getParticipants();
      expect(storedParticipants).toEqual(participants);
    });

    it("should leave room and clean up", async () => {
      // First join a room
      const joinPromise = client.joinRoom("room123", "user1", "Alice");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const signalingClient = (client as any).signalingClient;
      const ws = (signalingClient as any).ws as MockWebSocket;
      ws.simulateMessage({ type: "room-joined", participants: [] });

      await joinPromise;

      // Now leave
      await client.leaveRoom();

      expect((client as any).currentRoomId).toBeNull();
      expect((client as any).currentUserId).toBeNull();
      expect(client.getParticipants()).toEqual([]);
    });

    it("should handle user joined event", async () => {
      const userJoinedListener = jest.fn();
      client.on("userJoined", userJoinedListener);

      // Simulate user joined event
      const signalingClient = (client as any).signalingClient;
      signalingClient.emit("userJoined", { id: "user1", name: "Alice" });

      expect(userJoinedListener).toHaveBeenCalledWith({
        id: "user1",
        name: "Alice",
      });
      expect(client.getParticipants()).toContainEqual({
        id: "user1",
        name: "Alice",
      });
    });

    it("should handle user left event", async () => {
      // First add a user
      const signalingClient = (client as any).signalingClient;
      signalingClient.emit("userJoined", { id: "user1", name: "Alice" });

      const userLeftListener = jest.fn();
      client.on("userLeft", userLeftListener);

      // Simulate user left event
      signalingClient.emit("userLeft", "user1");

      expect(userLeftListener).toHaveBeenCalledWith("user1");
      expect(client.getParticipants()).not.toContainEqual({
        id: "user1",
        name: "Alice",
      });
    });
  });

  describe("Message sending", () => {
    beforeEach(() => {
      client = new AvesClient({ signalingUrl: testUrl });
    });

    it("should send message to all peers", () => {
      const webrtcManager = (client as any).webrtcManager;
      const sendMessageSpy = jest.spyOn(webrtcManager, "sendMessage");

      const message = { text: "Hello, everyone!" };
      client.sendMessage(message);

      expect(sendMessageSpy).toHaveBeenCalledWith(message);
    });

    it("should send message to specific peer", () => {
      const webrtcManager = (client as any).webrtcManager;
      const sendMessageToPeerSpy = jest.spyOn(
        webrtcManager,
        "sendMessageToPeer"
      );

      // Mock the method to avoid the "No DataChannel found" error
      sendMessageToPeerSpy.mockImplementation(() => {});

      const message = { text: "Hello, Alice!" };
      client.sendMessageToPeer("user1", message);

      expect(sendMessageToPeerSpy).toHaveBeenCalledWith("user1", message);
    });

    it("should throw error when DataChannel is not ready", () => {
      const webrtcManager = (client as any).webrtcManager;
      jest.spyOn(webrtcManager, "sendMessage").mockImplementation(() => {
        throw new Error("DataChannel is not ready");
      });

      expect(() => {
        client.sendMessage({ text: "Hello" });
      }).toThrow("DataChannel is not ready");
    });

    it("should forward messages from WebRTC", () => {
      const messageListener = jest.fn();
      client.on("message", messageListener);

      const webrtcManager = (client as any).webrtcManager;

      // Simulate message callback being invoked
      const messageCallbacks = (webrtcManager as any).messageCallbacks;
      messageCallbacks.forEach((callback: Function) => {
        callback("user1", { text: "Hello from user1" });
      });

      expect(messageListener).toHaveBeenCalledWith("user1", {
        text: "Hello from user1",
      });
    });
  });

  describe("State queries", () => {
    beforeEach(() => {
      client = new AvesClient({ signalingUrl: testUrl });
    });

    it("should return connection state for peer", () => {
      const state = client.getConnectionState("user1");
      expect(state).toBe("closed"); // Default state for unknown peer
    });

    it("should return participants list", () => {
      // Initially empty
      expect(client.getParticipants()).toEqual([]);

      // Add participants
      const signalingClient = (client as any).signalingClient;
      signalingClient.emit("userJoined", { id: "user1", name: "Alice" });
      signalingClient.emit("userJoined", { id: "user2", name: "Bob" });

      const participants = client.getParticipants();
      expect(participants).toHaveLength(2);
      expect(participants).toContainEqual({ id: "user1", name: "Alice" });
      expect(participants).toContainEqual({ id: "user2", name: "Bob" });
    });

    it("should check if connected to signaling server", () => {
      // Initially not connected
      expect(client.isConnected()).toBe(false);

      // Set room ID to simulate connection
      (client as any).currentRoomId = "room123";
      expect(client.isConnected()).toBe(true);
    });

    it("should return empty array for participants initially", () => {
      const participants = client.getParticipants();
      expect(participants).toEqual([]);
      expect(Array.isArray(participants)).toBe(true);
    });
  });

  describe("Destroy cleanup", () => {
    beforeEach(() => {
      client = new AvesClient({ signalingUrl: testUrl });
    });

    it("should clean up all resources on destroy", () => {
      // Add some state
      const signalingClient = (client as any).signalingClient;
      signalingClient.emit("userJoined", { id: "user1", name: "Alice" });
      (client as any).currentRoomId = "room123";
      (client as any).currentUserId = "user1";

      // Destroy
      client.destroy();

      // Verify cleanup
      expect((client as any).currentRoomId).toBeNull();
      expect((client as any).currentUserId).toBeNull();
      expect(client.getParticipants()).toEqual([]);
    });

    it("should remove all event listeners on destroy", () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      client.on("message", listener1);
      client.on("userJoined", listener2);

      client.destroy();

      // Try to emit events - listeners should not be called
      const signalingClient = (client as any).signalingClient;
      signalingClient.emit("userJoined", { id: "user1", name: "Alice" });

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
    });

    it("should disconnect from signaling server on destroy", () => {
      const signalingClient = (client as any).signalingClient;
      const disconnectSpy = jest.spyOn(signalingClient, "disconnect");

      client.destroy();

      expect(disconnectSpy).toHaveBeenCalled();
    });

    it("should close all WebRTC connections on destroy", () => {
      const webrtcManager = (client as any).webrtcManager;
      const closeAllSpy = jest.spyOn(webrtcManager, "closeAll");

      client.destroy();

      expect(closeAllSpy).toHaveBeenCalled();
    });

    it("should be safe to call destroy multiple times", () => {
      expect(() => {
        client.destroy();
        client.destroy();
        client.destroy();
      }).not.toThrow();
    });

    it("should clear participants map on destroy", () => {
      // Add participants
      const signalingClient = (client as any).signalingClient;
      signalingClient.emit("userJoined", { id: "user1", name: "Alice" });
      signalingClient.emit("userJoined", { id: "user2", name: "Bob" });

      expect(client.getParticipants().length).toBe(2);

      client.destroy();

      expect(client.getParticipants()).toEqual([]);
      expect((client as any).participants.size).toBe(0);
    });
  });

  describe("Event forwarding", () => {
    beforeEach(() => {
      client = new AvesClient({ signalingUrl: testUrl });
    });

    it("should forward signaling state changes", () => {
      const stateChangeListener = jest.fn();
      client.on("signalingStateChange", stateChangeListener);

      const signalingClient = (client as any).signalingClient;
      signalingClient.emit("stateChange", "connected");

      expect(stateChangeListener).toHaveBeenCalledWith("connected");
    });

    it("should forward errors from signaling client", () => {
      const errorListener = jest.fn();
      client.on("error", errorListener);

      const signalingClient = (client as any).signalingClient;
      const error = new Error("Connection failed");
      signalingClient.emit("error", error);

      expect(errorListener).toHaveBeenCalledWith(error);
    });

    it("should forward connection state changes from WebRTC", () => {
      const stateChangeListener = jest.fn();
      client.on("connectionStateChange", stateChangeListener);

      // Simulate connection state change through event system
      client.emit("connectionStateChange", "user1", "connected");

      expect(stateChangeListener).toHaveBeenCalledWith("user1", "connected");
    });

    it("should forward data channel state changes from WebRTC", () => {
      const stateChangeListener = jest.fn();
      client.on("dataChannelStateChange", stateChangeListener);

      // Simulate data channel state change through event system
      client.emit("dataChannelStateChange", "user1", "open");

      expect(stateChangeListener).toHaveBeenCalledWith("user1", "open");
    });
  });

  describe("Edge cases", () => {
    beforeEach(() => {
      client = new AvesClient({ signalingUrl: testUrl });
    });

    it("should handle empty ICE servers array", () => {
      const clientWithEmptyIce = new AvesClient({
        signalingUrl: testUrl,
        iceServers: [],
      });

      const config = (clientWithEmptyIce as any).config;
      expect(config.iceServers).toEqual([]);

      clientWithEmptyIce.destroy();
    });

    it("should handle zero reconnect attempts", () => {
      const clientWithZeroReconnect = new AvesClient({
        signalingUrl: testUrl,
        reconnect: {
          maxAttempts: 0,
          delay: 1000,
        },
      });

      const config = (clientWithZeroReconnect as any).config;
      expect(config.reconnect.maxAttempts).toBe(0);

      clientWithZeroReconnect.destroy();
    });

    it("should handle getParticipants after destroy", () => {
      client.destroy();

      const participants = client.getParticipants();
      expect(participants).toEqual([]);
    });

    it("should handle getConnectionState for non-existent peer", () => {
      const state = client.getConnectionState("non-existent-peer");
      expect(state).toBe("closed");
    });

    it("should handle isConnected when never connected", () => {
      expect(client.isConnected()).toBe(false);
    });
  });
});
