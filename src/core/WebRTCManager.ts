/**
 * WebRTCManager - Manages WebRTC PeerConnections and DataChannels
 *
 * This class handles the low-level WebRTC connection management including:
 * - Creating and managing RTCPeerConnection instances
 * - Creating and managing RTCDataChannel instances
 * - Handling ICE candidate exchange
 * - Serializing and deserializing messages
 * - Managing connection lifecycle and cleanup
 */
export class WebRTCManager {
  private peerConnections: Map<string, RTCPeerConnection>;
  private dataChannels: Map<string, RTCDataChannel>;
  private iceServers: RTCIceServer[];
  private messageCallbacks: Set<(peerId: string, message: any) => void>;
  private connectionStateCallbacks: Map<
    string,
    Set<(state: RTCPeerConnectionState) => void>
  >;
  private dataChannelStateCallbacks: Map<
    string,
    Set<(state: RTCDataChannelState) => void>
  >;
  private iceCandidateCallbacks: Map<
    string,
    Set<(candidate: RTCIceCandidateInit) => void>
  >;

  constructor(iceServers: RTCIceServer[]) {
    this.peerConnections = new Map();
    this.dataChannels = new Map();
    this.iceServers = iceServers;
    this.messageCallbacks = new Set();
    this.connectionStateCallbacks = new Map();
    this.dataChannelStateCallbacks = new Map();
    this.iceCandidateCallbacks = new Map();
  }

  /**
   * Create a new PeerConnection for the specified peer
   * If a connection already exists, returns the existing connection
   */
  createPeerConnection(peerId: string): RTCPeerConnection {
    if (this.peerConnections.has(peerId)) {
      return this.peerConnections.get(peerId)!;
    }

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
    });

    this.peerConnections.set(peerId, pc);

    // Monitor connection state changes
    pc.onconnectionstatechange = () => {
      const callbacks = this.connectionStateCallbacks.get(peerId);
      if (callbacks) {
        callbacks.forEach((callback) => callback(pc.connectionState));
      }

      // Auto-cleanup on failed/closed/disconnected states
      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "closed" ||
        pc.connectionState === "disconnected"
      ) {
        this.closePeerConnection(peerId);
      }
    };

    return pc;
  }

  /**
   * Create an offer for the specified peer
   * This also creates the DataChannel (offer side creates the channel)
   */
  async createOffer(peerId: string): Promise<RTCSessionDescriptionInit> {
    const pc = this.peerConnections.get(peerId);
    if (!pc) {
      throw new Error(`No peer connection found for ${peerId}`);
    }

    // Create DataChannel (offer side creates it)
    const dataChannel = pc.createDataChannel("data");
    this.setupDataChannel(peerId, dataChannel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    return offer;
  }

  /**
   * Create an answer for the specified peer
   * Sets up the remote offer and creates an answer
   */
  async createAnswer(
    peerId: string,
    offer: RTCSessionDescriptionInit
  ): Promise<RTCSessionDescriptionInit> {
    const pc = this.peerConnections.get(peerId);
    if (!pc) {
      throw new Error(`No peer connection found for ${peerId}`);
    }

    // Listen for DataChannel (answer side receives it)
    pc.ondatachannel = (event) => {
      this.setupDataChannel(peerId, event.channel);
    };

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    return answer;
  }

  /**
   * Set the remote answer for the specified peer
   */
  async setRemoteAnswer(
    peerId: string,
    answer: RTCSessionDescriptionInit
  ): Promise<void> {
    const pc = this.peerConnections.get(peerId);
    if (!pc) {
      throw new Error(`No peer connection found for ${peerId}`);
    }

    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  /**
   * Add an ICE candidate for the specified peer
   */
  async addIceCandidate(
    peerId: string,
    candidate: RTCIceCandidateInit
  ): Promise<void> {
    const pc = this.peerConnections.get(peerId);
    if (!pc) {
      throw new Error(`No peer connection found for ${peerId}`);
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error(`Error adding ICE candidate for ${peerId}:`, error);
      throw error;
    }
  }

  /**
   * Register a callback for ICE candidates from the specified peer
   */
  onIceCandidate(
    peerId: string,
    callback: (candidate: RTCIceCandidateInit) => void
  ): void {
    const pc = this.peerConnections.get(peerId);
    if (!pc) {
      throw new Error(`No peer connection found for ${peerId}`);
    }

    if (!this.iceCandidateCallbacks.has(peerId)) {
      this.iceCandidateCallbacks.set(peerId, new Set());
    }
    this.iceCandidateCallbacks.get(peerId)!.add(callback);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const callbacks = this.iceCandidateCallbacks.get(peerId);
        if (callbacks) {
          callbacks.forEach((cb) => cb(event.candidate!.toJSON()));
        }
      }
    };
  }

  /**
   * Register a callback for connection state changes
   */
  onConnectionStateChange(
    peerId: string,
    callback: (state: RTCPeerConnectionState) => void
  ): void {
    if (!this.connectionStateCallbacks.has(peerId)) {
      this.connectionStateCallbacks.set(peerId, new Set());
    }
    this.connectionStateCallbacks.get(peerId)!.add(callback);
  }

  /**
   * Register a callback for DataChannel state changes
   */
  onDataChannelStateChange(
    peerId: string,
    callback: (state: RTCDataChannelState) => void
  ): void {
    if (!this.dataChannelStateCallbacks.has(peerId)) {
      this.dataChannelStateCallbacks.set(peerId, new Set());
    }
    this.dataChannelStateCallbacks.get(peerId)!.add(callback);
  }

  /**
   * Register a callback for incoming messages
   */
  onMessage(callback: (peerId: string, message: any) => void): void {
    this.messageCallbacks.add(callback);
  }

  /**
   * Setup DataChannel event handlers
   */
  private setupDataChannel(peerId: string, dataChannel: RTCDataChannel): void {
    this.dataChannels.set(peerId, dataChannel);

    dataChannel.onopen = () => {
      const callbacks = this.dataChannelStateCallbacks.get(peerId);
      if (callbacks) {
        callbacks.forEach((callback) => callback(dataChannel.readyState));
      }
    };

    dataChannel.onclose = () => {
      const callbacks = this.dataChannelStateCallbacks.get(peerId);
      if (callbacks) {
        callbacks.forEach((callback) => callback(dataChannel.readyState));
      }
      this.dataChannels.delete(peerId);
    };

    dataChannel.onerror = (error) => {
      console.error(`DataChannel error with ${peerId}:`, error);
    };

    dataChannel.onmessage = (event) => {
      try {
        // Deserialize JSON message
        const message = JSON.parse(event.data);
        this.messageCallbacks.forEach((callback) => callback(peerId, message));
      } catch (error) {
        // Log error but don't interrupt connection
        console.error(`Failed to parse message from ${peerId}:`, error);
      }
    };
  }

  /**
   * Send a message to all connected peers
   * Throws error if any DataChannel is not ready
   */
  sendMessage(message: any): void {
    const errors: string[] = [];

    this.dataChannels.forEach((dataChannel, peerId) => {
      if (dataChannel.readyState === "open") {
        try {
          // Serialize message to JSON
          const serialized = JSON.stringify(message);
          dataChannel.send(serialized);
        } catch (error) {
          console.error(`Failed to send message to ${peerId}:`, error);
          errors.push(peerId);
        }
      } else {
        errors.push(peerId);
      }
    });

    if (errors.length > 0) {
      throw new Error(`DataChannel not ready for peers: ${errors.join(", ")}`);
    }
  }

  /**
   * Send a message to a specific peer
   * Throws error if DataChannel is not ready
   */
  sendMessageToPeer(peerId: string, message: any): void {
    const dataChannel = this.dataChannels.get(peerId);

    if (!dataChannel) {
      throw new Error(`No DataChannel found for ${peerId}`);
    }

    if (dataChannel.readyState !== "open") {
      throw new Error(
        `DataChannel not ready for ${peerId}, state: ${dataChannel.readyState}`
      );
    }

    try {
      // Serialize message to JSON
      const serialized = JSON.stringify(message);
      dataChannel.send(serialized);
    } catch (error) {
      console.error(`Failed to send message to ${peerId}:`, error);
      throw error;
    }
  }

  /**
   * Close the connection with a specific peer
   */
  closePeerConnection(peerId: string): void {
    const dataChannel = this.dataChannels.get(peerId);
    if (dataChannel) {
      dataChannel.close();
      this.dataChannels.delete(peerId);
    }

    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerId);
    }

    // Clean up callbacks
    this.connectionStateCallbacks.delete(peerId);
    this.dataChannelStateCallbacks.delete(peerId);
    this.iceCandidateCallbacks.delete(peerId);
  }

  /**
   * Close all connections and clean up resources
   */
  closeAll(): void {
    this.dataChannels.forEach((dataChannel) => {
      dataChannel.close();
    });
    this.dataChannels.clear();

    this.peerConnections.forEach((pc) => {
      pc.close();
    });
    this.peerConnections.clear();

    this.messageCallbacks.clear();
    this.connectionStateCallbacks.clear();
    this.dataChannelStateCallbacks.clear();
    this.iceCandidateCallbacks.clear();
  }

  /**
   * Get all active peer IDs
   */
  getActivePeers(): string[] {
    return Array.from(this.peerConnections.keys());
  }

  /**
   * Check if connected to a specific peer
   */
  isConnected(peerId: string): boolean {
    const pc = this.peerConnections.get(peerId);
    return pc?.connectionState === "connected";
  }

  /**
   * Check if DataChannel is ready for a specific peer
   */
  isDataChannelReady(peerId: string): boolean {
    const dataChannel = this.dataChannels.get(peerId);
    return dataChannel?.readyState === "open";
  }
}
