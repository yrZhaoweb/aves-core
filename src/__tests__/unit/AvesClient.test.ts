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
  transceiverSenders: MockRTCRtpSender[] = [];

  onicecandidate: ((event: any) => void) | null = null;
  onconnectionstatechange: ((event: any) => void) | null = null;
  ondatachannel: ((event: any) => void) | null = null;
  ontrack: ((event: any) => void) | null = null;

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

  addTransceiver(kind: string): RTCRtpTransceiver {
    const sender = new MockRTCRtpSender(kind);
    this.transceiverSenders.push(sender);
    return { sender } as unknown as RTCRtpTransceiver;
  }

  addTrack(track: MediaStreamTrack): RTCRtpSender {
    const sender = new MockRTCRtpSender(track.kind, track);
    this.transceiverSenders.push(sender);
    return sender as unknown as RTCRtpSender;
  }

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

class MockRTCRtpSender {
  track: MediaStreamTrack | null;

  constructor(
    public kind: string,
    track: MediaStreamTrack | null = null,
  ) {
    this.track = track;
  }

  async replaceTrack(track: MediaStreamTrack | null): Promise<void> {
    this.track = track;
  }
}

class MockMediaStreamTrack {
  enabled = true;
  readyState: MediaStreamTrackState = "live";
  onended: (() => void) | null = null;

  constructor(public kind: "audio" | "video") {}

  stop(): void {
    this.readyState = "ended";
  }
}

class MockMediaStream {
  constructor(private readonly tracks: MediaStreamTrack[] = []) {}

  getTracks(): MediaStreamTrack[] {
    return this.tracks;
  }

  getAudioTracks(): MediaStreamTrack[] {
    return this.tracks.filter((track) => track.kind === "audio");
  }

  getVideoTracks(): MediaStreamTrack[] {
    return this.tracks.filter((track) => track.kind === "video");
  }

  addTrack(track: MediaStreamTrack): void {
    this.tracks.push(track);
  }
}

function installNavigator(mediaDevices: Record<string, unknown>): void {
  Object.defineProperty(global, "navigator", {
    value: { mediaDevices },
    configurable: true,
  });
}

// Replace global RTCPeerConnection with mock
(global as any).RTCPeerConnection = MockRTCPeerConnection;
(global as any).MediaStream = MockMediaStream;

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
      expect(config.reconnect.requestTimeoutMs).toBe(30000);
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
          requestTimeoutMs: 12000,
        },
      });

      const config = (client as any).config;
      expect(config.reconnect.maxAttempts).toBe(10);
      expect(config.reconnect.delay).toBe(5000);
      expect(config.reconnect.requestTimeoutMs).toBe(12000);
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
      expect(config.reconnect.requestTimeoutMs).toBe(30000); // default
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

      // Simulate server response with matching requestId
      const signalingClient = (client as any).signalingClient;
      const ws = (signalingClient as any).ws as MockWebSocket;
      const sentMessage = JSON.parse(ws.sentMessages[0]);
      ws.simulateMessage({
        type: "room-created",
        roomId: "room123",
        requestId: sentMessage.requestId,
      });

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
      const sentMessage = JSON.parse(ws.sentMessages[0]);
      ws.simulateMessage({
        type: "room-joined",
        participants,
        userId: "canonical-user3",
        requestId: sentMessage.requestId,
      });

      const result = await joinPromise;
      expect(result).toEqual(participants);
      expect((client as any).currentRoomId).toBe("room123");
      expect((client as any).currentUserId).toBe("canonical-user3");
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
      const sentMessage = JSON.parse(ws.sentMessages[0]);
      ws.simulateMessage({
        type: "room-joined",
        participants,
        userId: "canonical-user3",
        requestId: sentMessage.requestId,
      });

      await joinPromise;

      const storedParticipants = client.getParticipants();
      expect(storedParticipants).toEqual(participants);
    });

    it("should leave room and clean up", async () => {
      // First join a room
      const joinPromise = client.joinRoom("room123", "Alice");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const signalingClient = (client as any).signalingClient;
      const ws = (signalingClient as any).ws as MockWebSocket;
      const joinMessage = JSON.parse(ws.sentMessages[0]);
      ws.simulateMessage({
        type: "room-joined",
        participants: [],
        userId: "generated-user1",
        requestId: joinMessage.requestId,
      });

      await joinPromise;

      // Now leave
      const leavePromise = client.leaveRoom();
      const leaveMessage = JSON.parse(ws.sentMessages[1]);
      ws.simulateMessage({
        type: "room-left",
        roomId: "room123",
        userId: "generated-user1",
        requestId: leaveMessage.requestId,
      });
      await leavePromise;

      expect((client as any).currentRoomId).toBeNull();
      expect((client as any).currentUserId).toBeNull();
      expect(client.getParticipants()).toEqual([]);
      expect(client.isConnected()).toBe(true);
      expect(leaveMessage).toEqual({
        type: "leave-room",
        userId: "generated-user1",
        requestId: expect.any(String),
      });
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

  describe("Facade methods", () => {
    beforeEach(() => {
      client = new AvesClient({ signalingUrl: testUrl });
    });

    it("should delegate file and media controls to WebRTCManager", async () => {
      const webrtcManager = (client as any).webrtcManager;
      const audioStream = {} as MediaStream;
      const videoStream = {} as MediaStream;
      const screenStream = {} as MediaStream;
      const remoteAudioStream = {} as MediaStream;
      const remoteVideoStream = {} as MediaStream;
      const blob = new Blob(["hello"], { type: "text/plain" });
      const transferInfo = {
        transferId: "transfer-1",
        peerId: "user1",
        direction: "send",
        name: "hello.txt",
        size: 5,
        mimeType: "text/plain",
        lastModified: 1,
      };

      jest.spyOn(webrtcManager, "sendFile").mockResolvedValue([transferInfo]);
      jest.spyOn(webrtcManager, "startVoice").mockResolvedValue(audioStream);
      jest.spyOn(webrtcManager, "stopVoice").mockImplementation(() => {});
      jest.spyOn(webrtcManager, "setMuted").mockImplementation(() => {});
      jest.spyOn(webrtcManager, "getLocalAudioState").mockReturnValue({
        active: true,
        muted: false,
      });
      jest
        .spyOn(webrtcManager, "getRemoteAudioStream")
        .mockReturnValue(remoteAudioStream);
      jest.spyOn(webrtcManager, "startVideo").mockResolvedValue(videoStream);
      jest.spyOn(webrtcManager, "stopVideo").mockImplementation(() => {});
      jest.spyOn(webrtcManager, "setVideoMuted").mockImplementation(() => {});
      jest.spyOn(webrtcManager, "getLocalVideoState").mockReturnValue({
        active: true,
        muted: true,
      });
      jest
        .spyOn(webrtcManager, "getRemoteVideoStream")
        .mockReturnValue(remoteVideoStream);
      jest
        .spyOn(webrtcManager, "startScreenShare")
        .mockResolvedValue(screenStream);
      jest.spyOn(webrtcManager, "stopScreenShare").mockImplementation(() => {});
      jest.spyOn(webrtcManager, "getScreenShareState").mockReturnValue({
        active: true,
        source: "screen",
      });

      await expect(
        client.sendFile(blob, { peerId: "user1", fileName: "hello.txt" }),
      ).resolves.toEqual([transferInfo]);
      await expect(client.startVoice()).resolves.toBe(audioStream);
      client.stopVoice();
      client.setMuted(true);
      expect(client.getLocalAudioState()).toEqual({
        active: true,
        muted: false,
      });
      expect(client.getRemoteAudioStream("user1")).toBe(remoteAudioStream);

      await expect(client.startVideo({ width: 640 })).resolves.toBe(videoStream);
      client.stopVideo();
      client.setVideoMuted(false);
      expect(client.getLocalVideoState()).toEqual({
        active: true,
        muted: true,
      });
      expect(client.getRemoteVideoStream("user1")).toBe(remoteVideoStream);

      await expect(client.startScreenShare()).resolves.toBe(screenStream);
      client.stopScreenShare();
      expect(client.getScreenShareState()).toEqual({
        active: true,
        source: "screen",
      });

      expect(webrtcManager.sendFile).toHaveBeenCalledWith(blob, {
        peerId: "user1",
        fileName: "hello.txt",
      });
      expect(webrtcManager.startVideo).toHaveBeenCalledWith({ width: 640 });
      expect(webrtcManager.setMuted).toHaveBeenCalledWith(true);
      expect(webrtcManager.setVideoMuted).toHaveBeenCalledWith(false);
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
      expect(client.isConnected()).toBe(false);

      const signalingClient = (client as any).signalingClient;
      (signalingClient as any).ws = {
        readyState: MockWebSocket.OPEN,
        close: jest.fn(),
      };
      expect(client.isConnected()).toBe(true);
    });

    it("should return empty array for participants initially", () => {
      const participants = client.getParticipants();
      expect(participants).toEqual([]);
      expect(Array.isArray(participants)).toBe(true);
    });

    it("should return a connection snapshot for diagnostics", () => {
      const signalingClient = (client as any).signalingClient;
      const webrtcManager = (client as any).webrtcManager;
      (client as any).currentRoomId = "room123";
      (client as any).currentUserId = "user-current";
      signalingClient.emit("userJoined", { id: "user1", name: "Alice" });
      jest.spyOn(webrtcManager, "getActivePeers").mockReturnValue(["user1"]);
      jest.spyOn(webrtcManager, "getConnectionState").mockReturnValue("connected");
      jest.spyOn(webrtcManager, "getDataChannelState").mockReturnValue("open");
      jest.spyOn(webrtcManager, "isDataChannelReady").mockReturnValue(true);
      jest.spyOn(webrtcManager, "isFileChannelReady").mockReturnValue(false);

      const snapshot = client.getConnectionSnapshot();

      expect(snapshot).toEqual({
        roomId: "room123",
        currentUserId: "user-current",
        signalingConnected: false,
        participantCount: 1,
        participants: [{ id: "user1", name: "Alice" }],
        peers: [
          {
            peerId: "user1",
            participant: { id: "user1", name: "Alice" },
            connectionState: "connected",
            dataChannelState: "open",
            messageChannelReady: true,
            fileChannelReady: false,
          },
        ],
      });
    });

    it("should resolve waitForPeer immediately when the data channel is already open", async () => {
      const webrtcManager = (client as any).webrtcManager;
      jest.spyOn(webrtcManager, "isDataChannelReady").mockReturnValue(true);

      await expect(client.waitForPeer("user1", { timeoutMs: 10 })).resolves.toEqual(
        expect.objectContaining({
          peerId: "user1",
          dataChannelState: "open",
          messageChannelReady: true,
        }),
      );
    });

    it("should reject waitForPeer when the peer is not ready before timeout", async () => {
      const webrtcManager = (client as any).webrtcManager;
      jest.spyOn(webrtcManager, "isDataChannelReady").mockReturnValue(false);
      jest.spyOn(webrtcManager, "getDataChannelState").mockReturnValue("closed");

      await expect(client.waitForPeer("user1", { timeoutMs: 1 })).rejects.toMatchObject({
        code: "WEBRTC_CONNECTION_FAILED",
        peerId: "user1",
      });
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

    it("should forward WebRTC file, media, and manager errors", () => {
      const webrtcManager = (client as any).webrtcManager;
      const startedListener = jest.fn();
      const progressListener = jest.fn();
      const completedListener = jest.fn();
      const failedListener = jest.fn();
      const audioTrackListener = jest.fn();
      const audioStateListener = jest.fn();
      const videoTrackListener = jest.fn();
      const videoStateListener = jest.fn();
      const screenStateListener = jest.fn();
      const errorListener = jest.fn();
      const info = {
        transferId: "transfer-1",
        peerId: "user1",
        direction: "send",
        name: "demo.txt",
        size: 4,
        mimeType: "text/plain",
        lastModified: 1,
      };
      const progress = { ...info, bytesTransferred: 2, progress: 50 };
      const result = { ...info, blob: new Blob(["demo"]) };
      const error = new Error("transport failed");
      const audioStream = {} as MediaStream;
      const videoStream = {} as MediaStream;
      const audioTrack = { kind: "audio" } as MediaStreamTrack;
      const videoTrack = { kind: "video" } as MediaStreamTrack;

      client.on("fileTransferStarted", startedListener);
      client.on("fileTransferProgress", progressListener);
      client.on("fileTransferCompleted", completedListener);
      client.on("fileTransferFailed", failedListener);
      client.on("remoteAudioTrack", audioTrackListener);
      client.on("localAudioStateChange", audioStateListener);
      client.on("remoteVideoTrack", videoTrackListener);
      client.on("localVideoStateChange", videoStateListener);
      client.on("screenShareStateChange", screenStateListener);
      client.on("error", errorListener);

      (webrtcManager as any).fileTransferStartedCallbacks.forEach((callback: Function) =>
        callback("user1", info),
      );
      (webrtcManager as any).fileTransferProgressCallbacks.forEach((callback: Function) =>
        callback("user1", progress),
      );
      (webrtcManager as any).fileTransferCompletedCallbacks.forEach((callback: Function) =>
        callback("user1", result),
      );
      (webrtcManager as any).fileTransferFailedCallbacks.forEach((callback: Function) =>
        callback("user1", info, error),
      );
      (webrtcManager as any).remoteAudioTrackCallbacks.forEach((callback: Function) =>
        callback("user1", audioStream, audioTrack),
      );
      (webrtcManager as any).localAudioStateCallbacks.forEach((callback: Function) =>
        callback({ active: true, muted: false }),
      );
      (webrtcManager as any).remoteVideoTrackCallbacks.forEach((callback: Function) =>
        callback("user1", videoStream, videoTrack),
      );
      (webrtcManager as any).localVideoStateCallbacks.forEach((callback: Function) =>
        callback({ active: true, muted: true }),
      );
      (webrtcManager as any).screenShareStateCallbacks.forEach((callback: Function) =>
        callback({ active: true, source: "screen" }),
      );
      (webrtcManager as any).errorCallbacks.forEach((callback: Function) =>
        callback(error),
      );

      expect(startedListener).toHaveBeenCalledWith("user1", info);
      expect(progressListener).toHaveBeenCalledWith("user1", progress);
      expect(completedListener).toHaveBeenCalledWith("user1", result);
      expect(failedListener).toHaveBeenCalledWith("user1", info, error);
      expect(audioTrackListener).toHaveBeenCalledWith("user1", audioStream, audioTrack);
      expect(audioStateListener).toHaveBeenCalledWith({
        active: true,
        muted: false,
      });
      expect(videoTrackListener).toHaveBeenCalledWith("user1", videoStream, videoTrack);
      expect(videoStateListener).toHaveBeenCalledWith({
        active: true,
        muted: true,
      });
      expect(screenStateListener).toHaveBeenCalledWith({
        active: true,
        source: "screen",
      });
      expect(errorListener).toHaveBeenCalledWith(error);
    });

    it("should answer signaling offers and report signaling failures", async () => {
      const signalingClient = (client as any).signalingClient;
      const webrtcManager = (client as any).webrtcManager;
      const answer = { type: "answer", sdp: "local-answer" };
      const errorListener = jest.fn();
      const sendAnswerSpy = jest
        .spyOn(signalingClient, "sendAnswer")
        .mockImplementation(() => {});
      jest.spyOn(webrtcManager, "createAnswer").mockResolvedValue(answer);
      (client as any).currentUserId = "user1";
      client.on("error", errorListener);

      signalingClient.emit("offer", "user2", { type: "offer", sdp: "remote-offer" });
      await new Promise((resolve) => setImmediate(resolve));

      expect(sendAnswerSpy).toHaveBeenCalledWith("user2", "user1", answer);

      jest
        .spyOn(webrtcManager, "createAnswer")
        .mockRejectedValueOnce(new Error("bad offer"));
      signalingClient.emit("offer", "user3", { type: "offer", sdp: "broken" });
      await new Promise((resolve) => setImmediate(resolve));

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Failed to handle offer from user3"),
          peerId: "user3",
        }),
      );
    });

    it("should apply signaling answers and ICE candidates or emit structured errors", async () => {
      const signalingClient = (client as any).signalingClient;
      const webrtcManager = (client as any).webrtcManager;
      const errorListener = jest.fn();
      const setRemoteAnswerSpy = jest
        .spyOn(webrtcManager, "setRemoteAnswer")
        .mockResolvedValue(undefined);
      const addIceCandidateSpy = jest
        .spyOn(webrtcManager, "addIceCandidate")
        .mockResolvedValue(undefined);
      client.on("error", errorListener);

      signalingClient.emit("answer", "user2", {
        type: "answer",
        sdp: "remote-answer",
      });
      signalingClient.emit("iceCandidate", "user2", {
        candidate: "candidate",
        sdpMid: "0",
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(setRemoteAnswerSpy).toHaveBeenCalledWith("user2", {
        type: "answer",
        sdp: "remote-answer",
      });
      expect(addIceCandidateSpy).toHaveBeenCalledWith("user2", {
        candidate: "candidate",
        sdpMid: "0",
      });

      setRemoteAnswerSpy.mockRejectedValueOnce(new Error("bad answer"));
      addIceCandidateSpy.mockRejectedValueOnce(new Error("bad candidate"));
      signalingClient.emit("answer", "user3", {
        type: "answer",
        sdp: "broken",
      });
      signalingClient.emit("iceCandidate", "user3", {
        candidate: "broken",
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Failed to handle answer from user3"),
          peerId: "user3",
        }),
      );
      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Failed to add ICE candidate from user3"),
          peerId: "user3",
        }),
      );
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

    it("should clear prepared peer state when a peer connection disconnects", () => {
      const webrtcManager = (client as any).webrtcManager;

      (client as any).preparePeerConnection("user1");
      expect((client as any).preparedPeers.has("user1")).toBe(true);

      const callbacks = (webrtcManager as any).connectionStateCallbacks.get("user1");
      callbacks.forEach((callback: Function) => callback("disconnected"));

      expect((client as any).preparedPeers.has("user1")).toBe(false);
    });

    it("should rejoin the room after signaling reconnects", async () => {
      const signalingClient = (client as any).signalingClient;
      jest.spyOn(signalingClient, "joinRoom").mockResolvedValue({
        participants: [],
        userId: "user1",
      });

      (client as any).currentRoomId = "room123";
      (client as any).currentUserId = "user1";
      (client as any).currentUserName = "Alice";

      signalingClient.emit("stateChange", "disconnected");
      signalingClient.emit("stateChange", "connected");
      await new Promise((resolve) => setImmediate(resolve));

      expect(signalingClient.joinRoom).toHaveBeenCalledWith(
        "room123",
        "user1",
        "Alice",
      );
    });

    it("should preserve active local video and resync it after restoring a room session", async () => {
      const videoTrack = new MockMediaStreamTrack("video") as unknown as MediaStreamTrack;
      installNavigator({
        getUserMedia: jest
          .fn()
          .mockResolvedValue(new MockMediaStream([videoTrack])),
      });

      await client.startVideo();
      expect(client.getLocalVideoState()).toEqual({
        active: true,
        muted: false,
      });

      const signalingClient = (client as any).signalingClient;
      jest.spyOn(signalingClient, "joinRoom").mockResolvedValue({
        participants: [{ id: "user2", name: "Bob" }],
        userId: "user1",
      });
      jest.spyOn(signalingClient, "sendOffer").mockImplementation(() => {});

      (client as any).currentRoomId = "room123";
      (client as any).currentUserId = "user1";
      (client as any).currentUserName = "Alice";

      signalingClient.emit("stateChange", "disconnected");
      signalingClient.emit("stateChange", "connected");
      await new Promise((resolve) => setImmediate(resolve));
      await Promise.resolve();

      const webrtcManager = (client as any).webrtcManager;
      const sender = (webrtcManager as any).videoSenders.get(
        "user2",
      ) as MockRTCRtpSender;
      expect(client.getLocalVideoState()).toEqual({
        active: true,
        muted: false,
      });
      expect(sender.track).toBe(videoTrack);
    });

    it("should clear local room state when session restore fails", async () => {
      const signalingClient = (client as any).signalingClient;
      const errorListener = jest.fn();
      jest.spyOn(signalingClient, "joinRoom").mockRejectedValue(new Error("room gone"));

      (client as any).currentRoomId = "room123";
      (client as any).currentUserId = "user1";
      (client as any).currentUserName = "Alice";
      client.on("error", errorListener);

      signalingClient.emit("stateChange", "disconnected");
      signalingClient.emit("stateChange", "connected");
      await new Promise((resolve) => setImmediate(resolve));

      expect((client as any).currentRoomId).toBeNull();
      expect((client as any).currentUserId).toBeNull();
      expect((client as any).currentUserName).toBeNull();
      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Failed to restore room session"),
        }),
      );
    });
  });

  describe("Client reuse", () => {
    beforeEach(() => {
      client = new AvesClient({ signalingUrl: testUrl });
    });

    it("should keep forwarding WebRTC events after leaveRoom and rejoin", async () => {
      const messageListener = jest.fn();
      client.on("message", messageListener);

      let joinPromise = client.joinRoom("room123", "user1", "Alice");
      await new Promise((resolve) => setTimeout(resolve, 10));

      let signalingClient = (client as any).signalingClient;
      let ws = (signalingClient as any).ws as MockWebSocket;
      let joinMessage = JSON.parse(ws.sentMessages[0]);
      ws.simulateMessage({
        type: "room-joined",
        participants: [],
        userId: "user1",
        requestId: joinMessage.requestId,
      });
      await joinPromise;

      const leavePromise = client.leaveRoom();
      const leaveMessage = JSON.parse(ws.sentMessages[1]);
      ws.simulateMessage({
        type: "room-left",
        roomId: "room123",
        userId: "user1",
        requestId: leaveMessage.requestId,
      });
      await leavePromise;

      joinPromise = client.joinRoom("room123", "user1", "Alice");
      await new Promise((resolve) => setTimeout(resolve, 10));

      signalingClient = (client as any).signalingClient;
      ws = (signalingClient as any).ws as MockWebSocket;
      joinMessage = JSON.parse(ws.sentMessages[2]);
      ws.simulateMessage({
        type: "room-joined",
        participants: [],
        userId: "user1",
        requestId: joinMessage.requestId,
      });
      await joinPromise;

      const webrtcManager = (client as any).webrtcManager;
      const messageCallbacks = (webrtcManager as any).messageCallbacks;
      expect(messageCallbacks.size).toBeGreaterThan(0);

      messageCallbacks.forEach((callback: Function) => {
        callback("user2", { text: "rejoined" });
      });

      expect(messageListener).toHaveBeenCalledWith("user2", { text: "rejoined" });
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

    it("should not report connected from stale room state alone", () => {
      (client as any).currentRoomId = "room123";
      expect(client.isConnected()).toBe(false);
    });
  });
});
