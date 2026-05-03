import { AvesError } from "../../core/AvesError";
import {
  normalizePeerChannels,
  getChannelKind,
} from "../../core/webrtc/channels";
import {
  FileTransferManager,
  isFileControlMessage,
} from "../../core/webrtc/fileTransfer";
import { MediaTrackManager } from "../../core/webrtc/mediaTracks";

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

describe("WebRTC internal helpers", () => {
  beforeEach(() => {
    (global as any).MediaStream = MockMediaStream;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("normalizes legacy single DataChannel storage", () => {
    const channel = { readyState: "open" } as RTCDataChannel;

    expect(getChannelKind("file")).toBe("file");
    expect(getChannelKind("data")).toBe("message");
    expect(normalizePeerChannels(channel)).toEqual({ message: channel });
  });

  it("identifies non-file control payloads", () => {
    expect(isFileControlMessage(null)).toBe(false);
    expect(isFileControlMessage({ __aves: "other", kind: "file-meta" })).toBe(
      false,
    );
  });

  it("rejects and reports every active transfer when a peer fails", () => {
    const manager = new FileTransferManager({
      fileChunkSize: 4,
      getActivePeers: () => [],
      isFileChannelReady: () => false,
      getMessageChannel: () => ({ send: jest.fn() }) as unknown as RTCDataChannel,
      getFileChannel: () => ({ send: jest.fn() }) as unknown as RTCDataChannel,
    });
    const failed = jest.fn();
    const readyReject = jest.fn();
    const completionReject = jest.fn();
    const readyTimeoutId = setTimeout(() => undefined, 10000);
    const completionTimeoutId = setTimeout(() => undefined, 10000);

    manager.onFailed(failed);
    manager.outgoingTransfers.set("peer1", {
      transferId: "out",
      peerId: "peer1",
      direction: "send",
      name: "out.txt",
      size: 1,
      mimeType: "text/plain",
      blob: new Blob(["x"]),
      chunkSize: 1,
    });
    manager.incomingTransfers.set("peer1", {
      transferId: "in",
      peerId: "peer1",
      direction: "receive",
      name: "in.txt",
      size: 1,
      mimeType: "text/plain",
      chunks: [],
      bytesTransferred: 0,
    });
    manager.readyResolvers.set("peer1", {
      transferId: "out",
      resolve: jest.fn(),
      reject: readyReject,
      timeoutId: readyTimeoutId,
    });
    manager.completionResolvers.set("peer1", {
      transferId: "out",
      resolve: jest.fn(),
      reject: completionReject,
      timeoutId: completionTimeoutId,
    });

    const error = new AvesError({
      message: "peer failed",
      code: "WEBRTC_CONNECTION_FAILED",
      stage: "transport",
      retryable: false,
      peerId: "peer1",
    });
    manager.failActiveTransfers("peer1", error);

    expect(failed).toHaveBeenCalledTimes(2);
    expect(readyReject).toHaveBeenCalledWith(error);
    expect(completionReject).toHaveBeenCalledWith(error);
    expect(manager.outgoingTransfers.has("peer1")).toBe(false);
    expect(manager.incomingTransfers.has("peer1")).toBe(false);
  });

  it("syncs audio and video through addTrack when transceivers are unavailable", async () => {
    const addTrack = jest.fn((track: MediaStreamTrack) => ({ track }));
    const pc = { addTrack } as unknown as RTCPeerConnection;
    const peerConnections = new Map([["peer1", pc]]);
    const manager = new MediaTrackManager(peerConnections, () => ["peer1"]);
    const audioTrack = new MockMediaStreamTrack("audio") as unknown as MediaStreamTrack;
    const videoTrack = new MockMediaStreamTrack("video") as unknown as MediaStreamTrack;

    manager.bindPeerConnection("peer1", pc);
    installNavigator({
      getUserMedia: jest
        .fn()
        .mockResolvedValueOnce(new MockMediaStream([audioTrack]))
        .mockResolvedValueOnce(new MockMediaStream([videoTrack])),
    });

    await manager.startVoice();
    await manager.startVideo();

    expect(addTrack).toHaveBeenCalledWith(audioTrack, expect.any(MockMediaStream));
    expect(addTrack).toHaveBeenCalledWith(videoTrack, expect.any(MockMediaStream));
  });

  it("skips missing peers during media sync", async () => {
    const manager = new MediaTrackManager(new Map(), () => ["missing-peer"]);
    installNavigator({
      getUserMedia: jest
        .fn()
        .mockResolvedValue(
          new MockMediaStream([
            new MockMediaStreamTrack("audio") as unknown as MediaStreamTrack,
          ]),
        ),
    });

    await expect(manager.startVoice()).resolves.toBeInstanceOf(MockMediaStream);
  });
});
