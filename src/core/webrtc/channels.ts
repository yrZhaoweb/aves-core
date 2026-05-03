export const FILE_CHANNEL_LABEL = "file";
export const MESSAGE_CHANNEL_LABEL = "data";

export type ChannelKind = "message" | "file";

export interface PeerChannels {
  message?: RTCDataChannel;
  file?: RTCDataChannel;
}

export function getChannelKind(label: string): ChannelKind {
  return label === FILE_CHANNEL_LABEL ? "file" : "message";
}

export function normalizePeerChannels(
  channels: PeerChannels | RTCDataChannel | undefined,
): PeerChannels {
  if (!channels) {
    return {};
  }

  if (isPeerChannels(channels)) {
    return channels;
  }

  return {
    message: channels,
  };
}

export function isPeerChannels(
  value: PeerChannels | RTCDataChannel,
): value is PeerChannels {
  return !("readyState" in value);
}
