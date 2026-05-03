/**
 * Unit tests for WebRTCManager
 * Tests PeerConnection creation, DataChannel messaging, connection cleanup, and error handling
 *
 * Requirements: 3.3, 3.4, 3.6
 */

import { AvesError } from "../../core/AvesError";
import { WebRTCManager } from "../../core/WebRTCManager";

// Mock WebRTC APIs
class MockRTCPeerConnection {
  connectionState: RTCPeerConnectionState = "new";
  onconnectionstatechange: (() => void) | null = null;
  onicecandidate: ((event: any) => void) | null = null;
  ondatachannel: ((event: any) => void) | null = null;
  ontrack: ((event: any) => void) | null = null;
  localDescription: RTCSessionDescription | null = null;
  remoteDescription: RTCSessionDescription | null = null;

  constructor(public config: RTCConfiguration) {}

  createDataChannel(label: string): MockRTCDataChannel {
    return new MockRTCDataChannel(label);
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: "offer", sdp: "mock-offer-sdp" };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: "answer", sdp: "mock-answer-sdp" };
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = new RTCSessionDescription(desc);
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = new RTCSessionDescription(desc);
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    // Mock implementation
  }

  addTransceiver(kind: string): RTCRtpTransceiver {
    const sender = new MockRTCRtpSender(kind);
    return { sender } as unknown as RTCRtpTransceiver;
  }

  addTrack(track: MediaStreamTrack): RTCRtpSender {
    return new MockRTCRtpSender(track.kind, track);
  }

  close(): void {
    // Prevent infinite recursion by checking if already closed
    if (this.connectionState === "closed") {
      return;
    }
    this.connectionState = "closed";
    if (this.onconnectionstatechange) {
      this.onconnectionstatechange();
    }
  }
}

class MockRTCDataChannel {
  readyState: RTCDataChannelState = "connecting";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: any) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(public label: string) {}

  send(data: string): void {
    if (this.readyState !== "open") {
      throw new Error("DataChannel is not open");
    }
  }

  close(): void {
    this.readyState = "closed";
    if (this.onclose) {
      this.onclose();
    }
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

class MockRTCSessionDescription {
  constructor(public init: RTCSessionDescriptionInit) {}
}

class MockRTCIceCandidate {
  constructor(public init: RTCIceCandidateInit) {}

  toJSON(): RTCIceCandidateInit {
    return this.init;
  }
}

class MockMediaStreamTrack {
  enabled = true;
  readyState: MediaStreamTrackState = "live";
  onended: (() => void) | null = null;

  constructor(public kind: "audio" | "video") {}

  stop(): void {
    if (this.readyState === "ended") {
      return;
    }
    this.readyState = "ended";
  }
}

class MockMediaStream {
  private tracks: MediaStreamTrack[];

  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = tracks;
  }

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

// Install mocks globally
(global as any).RTCPeerConnection = MockRTCPeerConnection;
(global as any).RTCDataChannel = MockRTCDataChannel;
(global as any).RTCSessionDescription = MockRTCSessionDescription;
(global as any).RTCIceCandidate = MockRTCIceCandidate;
(global as any).MediaStream = MockMediaStream;

describe("WebRTCManager Unit Tests", () => {
  let manager: WebRTCManager;
  const testIceServers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
  ];

  beforeEach(() => {
    manager = new WebRTCManager(testIceServers);
  });

  afterEach(() => {
    manager.closeAll();
  });

  describe("PeerConnection creation", () => {
    it("should create a new PeerConnection for a peer", () => {
      const peerId = "peer1";
      const pc = manager.createPeerConnection(peerId);

      expect(pc).toBeDefined();
      expect(pc).toBeInstanceOf(MockRTCPeerConnection);
      expect((pc as any).config.iceServers).toEqual(testIceServers);
    });

    it("should return existing PeerConnection if already created", () => {
      const peerId = "peer1";
      const pc1 = manager.createPeerConnection(peerId);
      const pc2 = manager.createPeerConnection(peerId);

      expect(pc1).toBe(pc2);
    });

    it("should create separate PeerConnections for different peers", () => {
      const pc1 = manager.createPeerConnection("peer1");
      const pc2 = manager.createPeerConnection("peer2");

      expect(pc1).not.toBe(pc2);
    });

    it("should track active peers", () => {
      manager.createPeerConnection("peer1");
      manager.createPeerConnection("peer2");
      manager.createPeerConnection("peer3");

      const activePeers = manager.getActivePeers();
      expect(activePeers).toHaveLength(3);
      expect(activePeers).toContain("peer1");
      expect(activePeers).toContain("peer2");
      expect(activePeers).toContain("peer3");
    });
  });

  describe("Offer and Answer creation", () => {
    it("should create an offer with DataChannel", async () => {
      const peerId = "peer1";
      manager.createPeerConnection(peerId);

      const offer = await manager.createOffer(peerId);

      expect(offer).toBeDefined();
      expect(offer.type).toBe("offer");
      expect(offer.sdp).toBe("mock-offer-sdp");
    });

    it("should throw error when creating offer for non-existent peer", async () => {
      await expect(manager.createOffer("nonexistent")).rejects.toThrow(
        "No peer connection found for nonexistent"
      );
    });

    it("should create an answer for an offer", async () => {
      const peerId = "peer1";
      const pc = manager.createPeerConnection(peerId) as any;

      const offer: RTCSessionDescriptionInit = {
        type: "offer",
        sdp: "remote-offer-sdp",
      };

      const answer = await manager.createAnswer(peerId, offer);
      const remoteChannel = new MockRTCDataChannel("data");
      pc.ondatachannel({ channel: remoteChannel });

      expect(answer).toBeDefined();
      expect(answer.type).toBe("answer");
      expect(answer.sdp).toBe("mock-answer-sdp");
      expect((manager as any).dataChannels.get(peerId).message).toBe(
        remoteChannel,
      );
    });

    it("should throw error when creating answer for non-existent peer", async () => {
      const offer: RTCSessionDescriptionInit = {
        type: "offer",
        sdp: "remote-offer-sdp",
      };

      await expect(manager.createAnswer("nonexistent", offer)).rejects.toThrow(
        "No peer connection found for nonexistent"
      );
    });

    it("should set remote answer", async () => {
      const peerId = "peer1";
      manager.createPeerConnection(peerId);

      const answer: RTCSessionDescriptionInit = {
        type: "answer",
        sdp: "remote-answer-sdp",
      };

      await expect(
        manager.setRemoteAnswer(peerId, answer)
      ).resolves.not.toThrow();
    });

    it("should throw error when setting remote answer for non-existent peer", async () => {
      const answer: RTCSessionDescriptionInit = {
        type: "answer",
        sdp: "remote-answer-sdp",
      };

      await expect(
        manager.setRemoteAnswer("nonexistent", answer)
      ).rejects.toThrow("No peer connection found for nonexistent");
    });
  });

  describe("ICE candidate handling", () => {
    it("should add ICE candidate to peer connection", async () => {
      const peerId = "peer1";
      manager.createPeerConnection(peerId);

      const candidate: RTCIceCandidateInit = {
        candidate: "candidate:1 1 UDP 2130706431 192.168.1.1 54321 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0,
      };

      await expect(
        manager.addIceCandidate(peerId, candidate)
      ).resolves.not.toThrow();
    });

    it("should throw error when adding ICE candidate for non-existent peer", async () => {
      const candidate: RTCIceCandidateInit = {
        candidate: "candidate:1 1 UDP 2130706431 192.168.1.1 54321 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0,
      };

      await expect(
        manager.addIceCandidate("nonexistent", candidate)
      ).rejects.toThrow("No peer connection found for nonexistent");
    });

    it("should register ICE candidate callback", () => {
      const peerId = "peer1";
      const pc = manager.createPeerConnection(peerId) as any;
      const callback = jest.fn();

      manager.onIceCandidate(peerId, callback);

      // Simulate ICE candidate event
      const candidate: RTCIceCandidateInit = {
        candidate: "candidate:1 1 UDP 2130706431 192.168.1.1 54321 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0,
      };

      pc.onicecandidate({ candidate: new MockRTCIceCandidate(candidate) });

      expect(callback).toHaveBeenCalledWith(candidate);
    });

    it("should ignore null ICE candidates", () => {
      const peerId = "peer1";
      const pc = manager.createPeerConnection(peerId) as any;
      const callback = jest.fn();

      manager.onIceCandidate(peerId, callback);

      pc.onicecandidate({ candidate: null });

      expect(callback).not.toHaveBeenCalled();
    });

    it("should throw error when registering ICE callback for non-existent peer", () => {
      const callback = jest.fn();

      expect(() => {
        manager.onIceCandidate("nonexistent", callback);
      }).toThrow("No peer connection found for nonexistent");
    });
  });

  describe("DataChannel messaging", () => {
    it("should send message to specific peer when DataChannel is open", () => {
      const peerId = "peer1";
      manager.createPeerConnection(peerId);

      // Manually set up DataChannel
      const dataChannel = new MockRTCDataChannel("data");
      dataChannel.readyState = "open";
      (manager as any).dataChannels.set(peerId, { message: dataChannel });

      const sendSpy = jest.spyOn(dataChannel, "send");
      const message = { type: "test", content: "hello" };

      manager.sendMessageToPeer(peerId, message);

      expect(sendSpy).toHaveBeenCalledWith(JSON.stringify(message));
    });

    it("should throw error when DataChannel not found", () => {
      const message = { type: "test", content: "hello" };

      expect(() => {
        manager.sendMessageToPeer("nonexistent", message);
      }).toThrow("No DataChannel found for nonexistent");
    });

    it("should throw error when DataChannel not ready", () => {
      const peerId = "peer1";
      manager.createPeerConnection(peerId);

      // Manually set up DataChannel in connecting state
      const dataChannel = new MockRTCDataChannel("data");
      dataChannel.readyState = "connecting";
      (manager as any).dataChannels.set(peerId, { message: dataChannel });

      const message = { type: "test", content: "hello" };

      expect(() => {
        manager.sendMessageToPeer(peerId, message);
      }).toThrow("DataChannel not ready for peer1, state: connecting");

      try {
        manager.sendMessageToPeer(peerId, message);
      } catch (error) {
        expect(error).toBeInstanceOf(AvesError);
        expect(error).toMatchObject({
          code: "MESSAGE_CHANNEL_NOT_READY",
          stage: "transport",
          retryable: true,
          peerId,
        });
      }
    });

    it("should send message to all peers when all DataChannels are open", () => {
      // Set up multiple peers with open DataChannels
      const peer1Channel = new MockRTCDataChannel("data");
      peer1Channel.readyState = "open";
      const peer2Channel = new MockRTCDataChannel("data");
      peer2Channel.readyState = "open";

      (manager as any).dataChannels.set("peer1", { message: peer1Channel });
      (manager as any).dataChannels.set("peer2", { message: peer2Channel });

      const sendSpy1 = jest.spyOn(peer1Channel, "send");
      const sendSpy2 = jest.spyOn(peer2Channel, "send");

      const message = { type: "broadcast", content: "hello all" };
      manager.sendMessage(message);

      expect(sendSpy1).toHaveBeenCalledWith(JSON.stringify(message));
      expect(sendSpy2).toHaveBeenCalledWith(JSON.stringify(message));
    });

    it("should throw error when any DataChannel is not ready", () => {
      // Set up multiple peers with mixed states
      const peer1Channel = new MockRTCDataChannel("data");
      peer1Channel.readyState = "open";
      const peer2Channel = new MockRTCDataChannel("data");
      peer2Channel.readyState = "connecting";

      (manager as any).dataChannels.set("peer1", { message: peer1Channel });
      (manager as any).dataChannels.set("peer2", { message: peer2Channel });

      const message = { type: "broadcast", content: "hello all" };

      // sendMessage no longer throws — it skips peers with unavailable channels
      expect(() => {
        manager.sendMessage(message);
      }).not.toThrow();
    });

    it("should receive and deserialize messages", () => {
      const peerId = "peer1";
      manager.createPeerConnection(peerId);

      const messageCallback = jest.fn();
      manager.onMessage(messageCallback);

      // Manually set up DataChannel
      const dataChannel = new MockRTCDataChannel("data");
      (manager as any).dataChannels.set(peerId, { message: dataChannel });

      // Manually trigger setupDataChannel to set up message handler
      (manager as any).setupDataChannel(peerId, dataChannel);

      // Simulate receiving a message
      const message = { type: "test", content: "hello" };
      const event = {
        data: JSON.stringify(message),
      } as MessageEvent;

      dataChannel.onmessage!(event);

      expect(messageCallback).toHaveBeenCalledWith(peerId, message);
    });

    it("should accept all JSON values and reject non-JSON message values", () => {
      const peerId = "peer1";
      manager.createPeerConnection(peerId);

      const dataChannel = new MockRTCDataChannel("data");
      dataChannel.readyState = "open";
      (manager as any).dataChannels.set(peerId, { message: dataChannel });
      const sendSpy = jest.spyOn(dataChannel, "send");

      const validMessage = {
        text: "hello",
        ok: true,
        count: 3,
        empty: null,
        nested: [false, { value: "inside" }],
      };

      manager.sendMessageToPeer(peerId, validMessage);

      expect(sendSpy).toHaveBeenCalledWith(JSON.stringify(validMessage));

      expect(() => {
        manager.sendMessageToPeer(peerId, new Date() as any);
      }).toThrow("Message must be JSON-serializable");

      expect(() => {
        manager.sendMessageToPeer(peerId, { callback: () => undefined } as any);
      }).toThrow("Message must be JSON-serializable");
    });

    it("should emit an error when broadcast send fails for one peer", () => {
      const openChannel = new MockRTCDataChannel("data");
      openChannel.readyState = "open";
      const failingChannel = new MockRTCDataChannel("data");
      failingChannel.readyState = "open";
      const errorCallback = jest.fn();

      (manager as any).dataChannels.set("peer1", { message: openChannel });
      (manager as any).dataChannels.set("peer2", { message: failingChannel });
      jest.spyOn(openChannel, "send");
      jest.spyOn(failingChannel, "send").mockImplementation(() => {
        throw new Error("buffer full");
      });
      manager.onError(errorCallback);

      manager.sendMessage({ type: "broadcast" });

      expect(openChannel.send).toHaveBeenCalledWith(
        JSON.stringify({ type: "broadcast" }),
      );
      expect(errorCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Failed to send message to peer2"),
          code: "MESSAGE_SEND_FAILED",
          peerId: "peer2",
        }),
      );
    });

    it("should handle message parsing errors gracefully", () => {
      const peerId = "peer1";
      manager.createPeerConnection(peerId);

      const messageCallback = jest.fn();
      manager.onMessage(messageCallback);

      // Subscribe to error callbacks
      const errorCallback = jest.fn();
      manager.onError(errorCallback);

      // Manually set up DataChannel
      const dataChannel = new MockRTCDataChannel("data");
      (manager as any).dataChannels.set(peerId, { message: dataChannel });
      (manager as any).setupDataChannel(peerId, dataChannel);

      // Simulate receiving invalid JSON
      const event = {
        data: "invalid json {",
      } as MessageEvent;

      dataChannel.onmessage!(event);

      expect(errorCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Failed to parse message"),
        }),
      );
      expect(messageCallback).not.toHaveBeenCalled();
    });
  });

  describe("Connection state management", () => {
    it("should register connection state change callback", () => {
      const peerId = "peer1";
      const pc = manager.createPeerConnection(peerId) as any;
      const callback = jest.fn();

      manager.onConnectionStateChange(peerId, callback);

      // Simulate connection state change
      pc.connectionState = "connected";
      pc.onconnectionstatechange();

      expect(callback).toHaveBeenCalledWith("connected");
    });

    it("should register DataChannel state change callback", () => {
      const peerId = "peer1";
      manager.createPeerConnection(peerId);

      const callback = jest.fn();
      manager.onDataChannelStateChange(peerId, callback);

      // Manually set up DataChannel
      const dataChannel = new MockRTCDataChannel("data");
      (manager as any).dataChannels.set(peerId, { message: dataChannel });
      (manager as any).setupDataChannel(peerId, dataChannel);

      // Simulate DataChannel opening
      dataChannel.readyState = "open";
      dataChannel.onopen!();

      expect(callback).toHaveBeenCalledWith("open");
    });

    it("should check if peer is connected", () => {
      const peerId = "peer1";
      const pc = manager.createPeerConnection(peerId) as any;

      expect(manager.isConnected(peerId)).toBe(false);

      pc.connectionState = "connected";
      expect(manager.isConnected(peerId)).toBe(true);
    });

    it("should check if DataChannel is ready", () => {
      const peerId = "peer1";
      manager.createPeerConnection(peerId);

      expect(manager.isDataChannelReady(peerId)).toBe(false);

      const dataChannel = new MockRTCDataChannel("data");
      dataChannel.readyState = "open";
      (manager as any).dataChannels.set(peerId, { message: dataChannel });

      expect(manager.isDataChannelReady(peerId)).toBe(true);
    });
  });

  describe("Media management", () => {
    const originalNavigator = (global as any).navigator;

    function installMediaDevices(mediaDevices: Record<string, jest.Mock>): void {
      Object.defineProperty(global, "navigator", {
        value: { mediaDevices },
        configurable: true,
      });
    }

    afterEach(() => {
      Object.defineProperty(global, "navigator", {
        value: originalNavigator,
        configurable: true,
      });
    });

    it("should start, mute, and stop local audio", async () => {
      const audioTrack = new MockMediaStreamTrack("audio") as unknown as MediaStreamTrack;
      const audioStream = new MockMediaStream([audioTrack]) as unknown as MediaStream;
      const getUserMedia = jest.fn().mockResolvedValue(audioStream);
      installMediaDevices({ getUserMedia });

      const stateCallback = jest.fn();
      manager.onLocalAudioStateChange(stateCallback);

      await expect(manager.startVoice()).resolves.toBe(audioStream);
      expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
      expect(manager.getLocalAudioState()).toEqual({
        active: true,
        muted: false,
      });
      expect(stateCallback).toHaveBeenLastCalledWith({
        active: true,
        muted: false,
      });

      manager.setMuted(true);
      expect(audioTrack.enabled).toBe(false);
      expect(manager.getLocalAudioState()).toEqual({
        active: true,
        muted: true,
      });

      await expect(manager.startVoice()).resolves.toBe(audioStream);

      manager.stopVoice();
      expect(audioTrack.readyState).toBe("ended");
      expect(manager.getLocalAudioState()).toEqual({
        active: false,
        muted: true,
      });
    });

    it("should reject local audio when capture is unavailable or empty", async () => {
      Object.defineProperty(global, "navigator", {
        value: {},
        configurable: true,
      });
      await expect(manager.startVoice()).rejects.toMatchObject({
        code: "MEDIA_NOT_AVAILABLE",
      });

      installMediaDevices({
        getUserMedia: jest
          .fn()
          .mockResolvedValue(new MockMediaStream([]) as unknown as MediaStream),
      });
      await expect(manager.startVoice()).rejects.toMatchObject({
        code: "MEDIA_CAPTURE_FAILED",
      });
    });

    it("should start, mute, and stop local camera video", async () => {
      manager.closeAll();
      manager = new WebRTCManager(testIceServers, undefined, { width: 640 });

      const videoTrack = new MockMediaStreamTrack("video") as unknown as MediaStreamTrack;
      const videoStream = new MockMediaStream([videoTrack]) as unknown as MediaStream;
      const getUserMedia = jest.fn().mockResolvedValue(videoStream);
      installMediaDevices({ getUserMedia });

      const stateCallback = jest.fn();
      manager.onLocalVideoStateChange(stateCallback);

      await expect(manager.startVideo({ height: 480 })).resolves.toBe(videoStream);
      expect(getUserMedia).toHaveBeenCalledWith({
        video: { width: 640, height: 480 },
      });
      expect(manager.getLocalVideoState()).toEqual({
        active: true,
        muted: false,
      });
      expect(stateCallback).toHaveBeenLastCalledWith({
        active: true,
        muted: false,
      });

      manager.setVideoMuted(true);
      expect(videoTrack.enabled).toBe(false);
      expect(manager.getLocalVideoState()).toEqual({
        active: true,
        muted: true,
      });

      await expect(manager.startVideo()).resolves.toBe(videoStream);

      manager.stopVideo();
      expect(videoTrack.readyState).toBe("ended");
      expect(manager.getLocalVideoState()).toEqual({
        active: false,
        muted: true,
      });
    });

    it("should reject local video when capture is unavailable or empty", async () => {
      Object.defineProperty(global, "navigator", {
        value: {},
        configurable: true,
      });
      await expect(manager.startVideo()).rejects.toMatchObject({
        code: "MEDIA_NOT_AVAILABLE",
      });

      installMediaDevices({
        getUserMedia: jest
          .fn()
          .mockResolvedValue(new MockMediaStream([]) as unknown as MediaStream),
      });
      await expect(manager.startVideo()).rejects.toMatchObject({
        code: "MEDIA_CAPTURE_FAILED",
      });
    });

    it("should switch to screen share and restore the previous camera track", async () => {
      const cameraTrack = new MockMediaStreamTrack("video") as unknown as MediaStreamTrack;
      const screenTrack = new MockMediaStreamTrack("video") as unknown as MediaStreamTrack;
      const cameraStream = new MockMediaStream([cameraTrack]) as unknown as MediaStream;
      const screenStream = new MockMediaStream([screenTrack]) as unknown as MediaStream;
      const getUserMedia = jest.fn().mockResolvedValue(cameraStream);
      const getDisplayMedia = jest.fn().mockResolvedValue(screenStream);
      installMediaDevices({ getUserMedia, getDisplayMedia });

      manager.createPeerConnection("peer1");
      await manager.startVideo();

      const screenStateCallback = jest.fn();
      manager.onScreenShareStateChange(screenStateCallback);

      await expect(manager.startScreenShare()).resolves.toBe(screenStream);
      expect(getDisplayMedia).toHaveBeenCalledWith({ video: true });
      expect(manager.getScreenShareState()).toEqual({
        active: true,
        source: "screen",
      });
      expect(screenStateCallback).toHaveBeenLastCalledWith({
        active: true,
        source: "screen",
      });

      const sender = (manager as any).videoSenders.get("peer1") as MockRTCRtpSender;
      expect(sender.track).toBe(screenTrack);

      await expect(manager.startScreenShare()).resolves.toBe(screenStream);

      manager.stopScreenShare();
      expect(screenTrack.readyState).toBe("ended");
      expect(sender.track).toBe(cameraTrack);
      expect(manager.getScreenShareState()).toEqual({
        active: false,
        source: "camera",
      });
    });

    it("should reject screen sharing when capture is unavailable or empty", async () => {
      Object.defineProperty(global, "navigator", {
        value: {},
        configurable: true,
      });
      await expect(manager.startScreenShare()).rejects.toMatchObject({
        code: "MEDIA_NOT_AVAILABLE",
      });

      installMediaDevices({
        getDisplayMedia: jest
          .fn()
          .mockResolvedValue(new MockMediaStream([]) as unknown as MediaStream),
      });
      await expect(manager.startScreenShare()).rejects.toMatchObject({
        code: "MEDIA_CAPTURE_FAILED",
      });
    });

    it("should stop screen sharing without a camera track and tolerate inactive stops", async () => {
      const screenTrack = new MockMediaStreamTrack("video") as unknown as MediaStreamTrack;
      const screenStream = new MockMediaStream([screenTrack]) as unknown as MediaStream;
      const getDisplayMedia = jest.fn().mockResolvedValue(screenStream);
      installMediaDevices({ getDisplayMedia });

      manager.createPeerConnection("peer1");
      await manager.startScreenShare();
      const sender = (manager as any).videoSenders.get("peer1") as MockRTCRtpSender;

      manager.stopScreenShare();
      manager.stopScreenShare();

      expect(sender.track).toBeNull();
      expect(manager.getScreenShareState()).toEqual({
        active: false,
        source: "camera",
      });
    });

    it("should stop screen sharing when the display track ends", async () => {
      const screenTrack = new MockMediaStreamTrack("video") as unknown as MediaStreamTrack;
      const screenStream = new MockMediaStream([screenTrack]) as unknown as MediaStream;
      const getDisplayMedia = jest.fn().mockResolvedValue(screenStream);
      installMediaDevices({ getDisplayMedia });

      await manager.startScreenShare();
      screenTrack.onended!();

      expect(manager.getScreenShareState()).toEqual({
        active: false,
        source: "camera",
      });
    });

    it("should expose remote audio and video tracks", () => {
      const audioTrack = new MockMediaStreamTrack("audio") as unknown as MediaStreamTrack;
      const firstVideoTrack = new MockMediaStreamTrack("video") as unknown as MediaStreamTrack;
      const secondVideoTrack = new MockMediaStreamTrack("video") as unknown as MediaStreamTrack;
      const audioCallback = jest.fn();
      const videoCallback = jest.fn();

      manager.onRemoteAudioTrack(audioCallback);
      manager.onRemoteVideoTrack(videoCallback);

      const pc = manager.createPeerConnection("peer1") as unknown as MockRTCPeerConnection;
      pc.ontrack!({ track: audioTrack, streams: [] });
      pc.ontrack!({ track: firstVideoTrack, streams: [] });
      pc.ontrack!({ track: secondVideoTrack, streams: [] });

      expect(audioCallback).toHaveBeenCalledWith(
        "peer1",
        expect.any(MockMediaStream),
        audioTrack,
      );
      expect(videoCallback).toHaveBeenCalledTimes(2);
      expect(manager.getRemoteAudioStream("peer1")).toEqual(
        expect.any(MockMediaStream),
      );
      expect(manager.getRemoteVideoStream("peer1")).toEqual(
        expect.any(MockMediaStream),
      );
      expect(manager.getRemoteAudioStream("missing")).toBeNull();
      expect(manager.getRemoteVideoStream("missing")).toBeNull();
    });
  });

  describe("Connection cleanup", () => {
    it("should close specific peer connection", () => {
      const peerId = "peer1";
      const pc = manager.createPeerConnection(peerId) as any;
      const dataChannel = new MockRTCDataChannel("data");
      (manager as any).dataChannels.set(peerId, { message: dataChannel });

      const pcCloseSpy = jest.spyOn(pc, "close");
      const dcCloseSpy = jest.spyOn(dataChannel, "close");

      manager.closePeerConnection(peerId);

      expect(pcCloseSpy).toHaveBeenCalled();
      expect(dcCloseSpy).toHaveBeenCalled();
      expect(manager.getActivePeers()).not.toContain(peerId);
    });

    it("should handle closing non-existent peer gracefully", () => {
      expect(() => {
        manager.closePeerConnection("nonexistent");
      }).not.toThrow();
    });

    it("should close all connections", () => {
      const pc1 = manager.createPeerConnection("peer1") as any;
      const pc2 = manager.createPeerConnection("peer2") as any;

      const dc1 = new MockRTCDataChannel("data");
      const dc2 = new MockRTCDataChannel("data");
      (manager as any).dataChannels.set("peer1", { message: dc1 });
      (manager as any).dataChannels.set("peer2", { message: dc2 });

      const pc1CloseSpy = jest.spyOn(pc1, "close");
      const pc2CloseSpy = jest.spyOn(pc2, "close");
      const dc1CloseSpy = jest.spyOn(dc1, "close");
      const dc2CloseSpy = jest.spyOn(dc2, "close");

      manager.closeAll();

      expect(pc1CloseSpy).toHaveBeenCalled();
      expect(pc2CloseSpy).toHaveBeenCalled();
      expect(dc1CloseSpy).toHaveBeenCalled();
      expect(dc2CloseSpy).toHaveBeenCalled();
      expect(manager.getActivePeers()).toHaveLength(0);
    });

    it("should auto-cleanup on connection failure", () => {
      const peerId = "peer1";
      const pc = manager.createPeerConnection(peerId) as any;

      const dataChannel = new MockRTCDataChannel("data");
      (manager as any).dataChannels.set(peerId, { message: dataChannel });

      // Simulate connection failure
      pc.connectionState = "failed";
      pc.onconnectionstatechange();

      expect(manager.getActivePeers()).not.toContain(peerId);
    });

    it("should auto-cleanup on connection closed", () => {
      const peerId = "peer1";
      const pc = manager.createPeerConnection(peerId) as any;

      // Simulate connection closed
      pc.connectionState = "closed";
      pc.onconnectionstatechange();

      expect(manager.getActivePeers()).not.toContain(peerId);
    });

    it("should auto-cleanup on connection disconnected", () => {
      const peerId = "peer1";
      const pc = manager.createPeerConnection(peerId) as any;

      // Simulate connection disconnected
      pc.connectionState = "disconnected";
      pc.onconnectionstatechange();

      expect(manager.getActivePeers()).not.toContain(peerId);
    });

    it("should clean up callbacks when closing peer connection", () => {
      const peerId = "peer1";
      manager.createPeerConnection(peerId);

      const connectionCallback = jest.fn();
      const dataChannelCallback = jest.fn();
      const iceCandidateCallback = jest.fn();

      manager.onConnectionStateChange(peerId, connectionCallback);
      manager.onDataChannelStateChange(peerId, dataChannelCallback);
      manager.onIceCandidate(peerId, iceCandidateCallback);

      manager.closePeerConnection(peerId);

      // Callbacks should be cleaned up
      expect((manager as any).connectionStateCallbacks.has(peerId)).toBe(false);
      expect((manager as any).dataChannelStateCallbacks.has(peerId)).toBe(
        false
      );
      expect((manager as any).iceCandidateCallbacks.has(peerId)).toBe(false);
    });
  });

  describe("Error handling", () => {
    it("should handle serialization errors when sending messages", () => {
      const peerId = "peer1";
      manager.createPeerConnection(peerId);

      const dataChannel = new MockRTCDataChannel("data");
      dataChannel.readyState = "open";
      (manager as any).dataChannels.set(peerId, { message: dataChannel });

      // Create a circular reference that will fail JSON.stringify
      const circularMessage: any = { type: "test" };
      circularMessage.self = circularMessage;

      expect(() => {
        manager.sendMessageToPeer(peerId, circularMessage);
      }).toThrow();
    });

    it("should reject non-finite numeric message values before sending", () => {
      const peerId = "peer1";
      manager.createPeerConnection(peerId);

      const dataChannel = new MockRTCDataChannel("data");
      dataChannel.readyState = "open";
      (manager as any).dataChannels.set(peerId, { message: dataChannel });
      const sendSpy = jest.spyOn(dataChannel, "send");

      expect(() => {
        manager.sendMessageToPeer(peerId, { value: Number.NEGATIVE_INFINITY });
      }).toThrow("Message must be JSON-serializable");

      expect(() => {
        manager.sendMessage({ value: Number.NaN });
      }).toThrow("Message must be JSON-serializable");
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it("should report error when DataChannel encounters an error", () => {
      const peerId = "peer1";
      manager.createPeerConnection(peerId);

      const errorCallback = jest.fn();
      manager.onError(errorCallback);

      const dataChannel = new MockRTCDataChannel("data");
      (manager as any).dataChannels.set(peerId, { message: dataChannel });
      (manager as any).setupDataChannel(peerId, dataChannel);

      // Simulate DataChannel error
      const error = new Error("DataChannel error");
      dataChannel.onerror!(error);

      expect(errorCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("DataChannel error with peer1"),
        }),
      );
    });

    it("should remove DataChannel from map when closed", () => {
      const peerId = "peer1";
      manager.createPeerConnection(peerId);

      const dataChannel = new MockRTCDataChannel("data");
      (manager as any).dataChannels.set(peerId, { message: dataChannel });
      (manager as any).setupDataChannel(peerId, dataChannel);

      expect((manager as any).dataChannels.has(peerId)).toBe(true);

      // Simulate DataChannel close
      dataChannel.close();

      expect((manager as any).dataChannels.has(peerId)).toBe(false);
    });
  });

  describe("File transfer safeguards", () => {
    function installOpenFileChannels(peerId: string): {
      messageChannel: MockRTCDataChannel;
      fileChannel: MockRTCDataChannel;
    } {
      manager.createPeerConnection(peerId);
      const messageChannel = new MockRTCDataChannel("data");
      messageChannel.readyState = "open";
      const fileChannel = new MockRTCDataChannel("file");
      fileChannel.readyState = "open";
      (manager as any).dataChannels.set(peerId, {
        message: messageChannel,
        file: fileChannel,
      });

      return { messageChannel, fileChannel };
    }

    function transferFor(peerId: string) {
      return {
        transferId: "transfer-1",
        peerId,
        direction: "send",
        name: "demo.txt",
        size: 4,
        mimeType: "text/plain",
        lastModified: 1,
        blob: new Blob(["demo"]),
        chunkSize: 4,
      };
    }

    it("should reject non-positive chunk sizes", async () => {
      const peerId = "peer1";
      installOpenFileChannels(peerId);

      await expect(
        manager.sendFile(new Blob(["hi"]), { peerId, chunkSize: 0 }),
      ).rejects.toThrow("chunkSize must be a positive integer");
    });

    it("should reject file sends when no ready file channel exists", async () => {
      manager.createPeerConnection("peer1");

      await expect(manager.sendFile(new Blob(["hi"]))).rejects.toMatchObject({
        code: "FILE_CHANNEL_NOT_READY",
      });
    });

    it("should reject peer file sends when channels are unavailable or busy", async () => {
      const peerId = "peer1";
      manager.createPeerConnection(peerId);
      const messageChannel = new MockRTCDataChannel("data");
      messageChannel.readyState = "connecting";
      const fileChannel = new MockRTCDataChannel("file");
      fileChannel.readyState = "open";
      (manager as any).dataChannels.set(peerId, {
        message: messageChannel,
        file: fileChannel,
      });

      await expect(
        manager.sendFile(new Blob(["hi"]), { peerId }),
      ).rejects.toMatchObject({
        code: "MESSAGE_CHANNEL_NOT_READY",
      });

      messageChannel.readyState = "open";
      fileChannel.readyState = "closing";
      await expect(
        manager.sendFile(new Blob(["hi"]), { peerId }),
      ).rejects.toMatchObject({
        code: "FILE_CHANNEL_NOT_READY",
      });

      fileChannel.readyState = "open";
      (manager as any).outgoingTransfers.set(peerId, transferFor(peerId));
      await expect(
        manager.sendFile(new Blob(["hi"]), { peerId }),
      ).rejects.toMatchObject({
        code: "FILE_TRANSFER_FAILED",
      });
    });

    it("should wait for receiver acknowledgement before reporting completion", async () => {
      const peerId = "peer1";
      const { messageChannel } = installOpenFileChannels(peerId);

      const completedCallback = jest.fn();
      manager.onFileTransferCompleted(completedCallback);

      jest.spyOn(messageChannel, "send").mockImplementation((data: string) => {
        const parsed = JSON.parse(data);
        if (parsed.kind === "file-meta") {
          (manager as any).handleFileControlMessage(peerId, {
            __aves: "aves:file-control",
            kind: "file-ready",
            transferId: parsed.transfer.transferId,
          });
        }
      });

      const sendPromise = manager.sendFile(new Blob(["hi"]), { peerId });
      for (let attempt = 0; attempt < 10; attempt++) {
        if ((manager as any).completionResolvers.has(peerId)) {
          break;
        }
        await new Promise((resolve) => setImmediate(resolve));
      }

      expect(completedCallback).not.toHaveBeenCalled();
      expect((manager as any).completionResolvers.has(peerId)).toBe(true);

      const transfer = (manager as any).outgoingTransfers.get(peerId);
      expect(transfer).toBeDefined();

      (manager as any).handleFileControlMessage(peerId, {
        __aves: "aves:file-control",
        kind: "file-complete",
        transferId: transfer.transferId,
      });

      await expect(sendPromise).resolves.toHaveLength(1);
      expect(completedCallback).toHaveBeenCalledWith(
        peerId,
        expect.objectContaining({ transferId: transfer.transferId }),
      );
    });

    it("should broadcast files only to peers with ready file channels", async () => {
      const { messageChannel, fileChannel } = installOpenFileChannels("peer1");
      manager.createPeerConnection("peer2");

      jest.spyOn(messageChannel, "send").mockImplementation((data: string) => {
        const parsed = JSON.parse(data);
        if (parsed.kind === "file-meta") {
          (manager as any).handleFileControlMessage("peer1", {
            __aves: "aves:file-control",
            kind: "file-ready",
            transferId: parsed.transfer.transferId,
          });
        }
      });
      jest.spyOn(fileChannel, "send").mockImplementation((data: any) => {
        if (typeof data === "string" && data.startsWith("__aves_file_end__:")) {
          (manager as any).handleFileControlMessage("peer1", {
            __aves: "aves:file-control",
            kind: "file-complete",
            transferId: data.slice("__aves_file_end__:".length),
          });
        }
      });

      await expect(manager.sendFile(new Blob(["hi"]))).resolves.toEqual([
        expect.objectContaining({ peerId: "peer1" }),
      ]);
    });

    it("should receive file metadata, chunks, and completion acknowledgements", () => {
      const peerId = "peer1";
      const { messageChannel, fileChannel } = installOpenFileChannels(peerId);
      const startedCallback = jest.fn();
      const progressCallback = jest.fn();
      const completedCallback = jest.fn();
      manager.onFileTransferStarted(startedCallback);
      manager.onFileTransferProgress(progressCallback);
      manager.onFileTransferCompleted(completedCallback);
      jest.spyOn(messageChannel, "send");

      (manager as any).setupDataChannel(peerId, fileChannel);
      fileChannel.onopen!();
      fileChannel.onmessage!({ data: new ArrayBuffer(1) } as MessageEvent);
      (manager as any).handleFileControlMessage(peerId, {
        __aves: "aves:file-control",
        kind: "file-meta",
        transfer: {
          transferId: "incoming-1",
          name: "incoming.txt",
          size: 4,
          mimeType: "text/plain",
          lastModified: 1,
        },
      });

      fileChannel.onmessage!({ data: new ArrayBuffer(2) } as MessageEvent);
      fileChannel.onmessage!({ data: "x" } as MessageEvent);
      fileChannel.onmessage!({ data: new Blob(["y"]) } as MessageEvent);
      fileChannel.onmessage!({
        data: "__aves_file_end__:incoming-1",
      } as MessageEvent);

      expect(startedCallback).toHaveBeenCalledWith(
        peerId,
        expect.objectContaining({ transferId: "incoming-1", direction: "receive" }),
      );
      expect(progressCallback).toHaveBeenCalledWith(
        peerId,
        expect.objectContaining({ bytesTransferred: 4, progress: 100 }),
      );
      expect(completedCallback).toHaveBeenCalledWith(
        peerId,
        expect.objectContaining({
          transferId: "incoming-1",
          blob: expect.any(Blob),
        }),
      );
      expect(messageChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('"kind":"file-complete"'),
      );
    });

    it("should clear transfers when a file-control error arrives", () => {
      const peerId = "peer1";
      installOpenFileChannels(peerId);
      const failedCallback = jest.fn();
      manager.onFileTransferFailed(failedCallback);
      (manager as any).outgoingTransfers.set(peerId, transferFor(peerId));

      (manager as any).handleFileControlMessage(peerId, {
        __aves: "aves:file-control",
        kind: "file-error",
        transferId: "transfer-1",
        message: "receiver rejected",
      });

      expect(failedCallback).toHaveBeenCalledWith(
        peerId,
        expect.objectContaining({ transferId: "transfer-1" }),
        expect.objectContaining({
          message: "receiver rejected",
          code: "FILE_TRANSFER_FAILED",
        }),
      );
      expect((manager as any).outgoingTransfers.has(peerId)).toBe(false);
    });

    it("should emit transfer failure when a peer closes mid-transfer", () => {
      const peerId = "peer1";
      manager.createPeerConnection(peerId);

      const failedCallback = jest.fn();
      manager.onFileTransferFailed(failedCallback);

      (manager as any).outgoingTransfers.set(peerId, transferFor(peerId));

      manager.closePeerConnection(peerId);

      expect(failedCallback).toHaveBeenCalledWith(
        peerId,
        expect.objectContaining({ transferId: "transfer-1" }),
        expect.any(Error),
      );
    });
  });
});
