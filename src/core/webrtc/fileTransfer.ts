import { AvesError } from "../AvesError";
import {
  FileTransferInfo,
  FileTransferOptions,
  FileTransferProgress,
  FileTransferResult,
} from "../../types/types";

export const DEFAULT_FILE_CHUNK_SIZE = 16 * 1024;
export const FILE_PROTOCOL = "aves:file-control";
export const FILE_READY_TIMEOUT_MS = 10000;
export const FILE_COMPLETE_TIMEOUT_MS = 10000;
export const FILE_END_MARKER_PREFIX = "__aves_file_end__:";

export interface OutgoingTransfer extends FileTransferInfo {
  blob: Blob;
  chunkSize: number;
}

export interface IncomingTransfer extends FileTransferInfo {
  chunks: BlobPart[];
  bytesTransferred: number;
}

export type FileControlMessage =
  | {
      __aves: typeof FILE_PROTOCOL;
      kind: "file-meta";
      transfer: Omit<FileTransferInfo, "peerId" | "direction">;
    }
  | {
      __aves: typeof FILE_PROTOCOL;
      kind: "file-ready";
      transferId: string;
    }
  | {
      __aves: typeof FILE_PROTOCOL;
      kind: "file-complete";
      transferId: string;
    }
  | {
      __aves: typeof FILE_PROTOCOL;
      kind: "file-error";
      transferId: string;
      message: string;
    };

export interface ReadyResolver {
  transferId: string;
  resolve: () => void;
  reject: (error: AvesError) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface FileTransferManagerOptions {
  fileChunkSize: number;
  getActivePeers: () => string[];
  isFileChannelReady: (peerId: string) => boolean;
  getMessageChannel: (peerId: string) => RTCDataChannel;
  getFileChannel: (peerId: string) => RTCDataChannel;
}

export class FileTransferManager {
  readonly outgoingTransfers = new Map<string, OutgoingTransfer>();
  readonly incomingTransfers = new Map<string, IncomingTransfer>();
  readonly readyResolvers = new Map<string, ReadyResolver>();
  readonly completionResolvers = new Map<string, ReadyResolver>();

  private readonly fileChunkSize: number;
  private readonly getActivePeers: () => string[];
  private readonly isFileChannelReady: (peerId: string) => boolean;
  private readonly getMessageChannel: (peerId: string) => RTCDataChannel;
  private readonly getFileChannel: (peerId: string) => RTCDataChannel;
  readonly fileTransferStartedCallbacks = new Set<
    (peerId: string, info: FileTransferInfo) => void
  >();
  readonly fileTransferProgressCallbacks = new Set<
    (peerId: string, progress: FileTransferProgress) => void
  >();
  readonly fileTransferCompletedCallbacks = new Set<
    (peerId: string, result: FileTransferResult) => void
  >();
  readonly fileTransferFailedCallbacks = new Set<
    (peerId: string, info: FileTransferInfo | null, error: AvesError) => void
  >();

  constructor(options: FileTransferManagerOptions) {
    this.fileChunkSize = validateChunkSize(options.fileChunkSize);
    this.getActivePeers = options.getActivePeers;
    this.isFileChannelReady = options.isFileChannelReady;
    this.getMessageChannel = options.getMessageChannel;
    this.getFileChannel = options.getFileChannel;
  }

  onStarted(callback: (peerId: string, info: FileTransferInfo) => void): void {
    this.fileTransferStartedCallbacks.add(callback);
  }

  onProgress(
    callback: (peerId: string, progress: FileTransferProgress) => void,
  ): void {
    this.fileTransferProgressCallbacks.add(callback);
  }

  onCompleted(
    callback: (peerId: string, result: FileTransferResult) => void,
  ): void {
    this.fileTransferCompletedCallbacks.add(callback);
  }

  onFailed(
    callback: (
      peerId: string,
      info: FileTransferInfo | null,
      error: AvesError,
    ) => void,
  ): void {
    this.fileTransferFailedCallbacks.add(callback);
  }

  clearCallbacks(): void {
    this.fileTransferStartedCallbacks.clear();
    this.fileTransferProgressCallbacks.clear();
    this.fileTransferCompletedCallbacks.clear();
    this.fileTransferFailedCallbacks.clear();
  }

  async sendFile(
    blob: Blob,
    options: FileTransferOptions = {},
  ): Promise<FileTransferInfo[]> {
    const peerIds = options.peerId
      ? [options.peerId]
      : this.getActivePeers().filter((peerId) => this.isFileChannelReady(peerId));

    if (peerIds.length === 0) {
      throw new AvesError({
        message: "No file channel is ready",
        code: "FILE_CHANNEL_NOT_READY",
        stage: "transport",
        retryable: true,
      });
    }

    const results: FileTransferInfo[] = [];

    for (const peerId of peerIds) {
      const info = await this.sendFileToPeer(peerId, blob, options);
      results.push(info);
    }

    return results;
  }

  handleControlMessage(peerId: string, message: FileControlMessage): void {
    switch (message.kind) {
      case "file-meta": {
        const transfer: IncomingTransfer = {
          transferId: message.transfer.transferId,
          peerId,
          direction: "receive",
          name: message.transfer.name,
          size: message.transfer.size,
          mimeType: message.transfer.mimeType,
          lastModified: message.transfer.lastModified,
          chunks: [],
          bytesTransferred: 0,
        };
        this.incomingTransfers.set(peerId, transfer);
        this.emitStarted(peerId, transfer);
        this.emitProgress(peerId, transfer, 0);
        this.sendControl(peerId, {
          __aves: FILE_PROTOCOL,
          kind: "file-ready",
          transferId: transfer.transferId,
        });
        break;
      }

      case "file-ready": {
        const resolver = this.readyResolvers.get(peerId);
        if (resolver && resolver.transferId === message.transferId) {
          clearTimeout(resolver.timeoutId);
          this.readyResolvers.delete(peerId);
          resolver.resolve();
        }
        break;
      }

      case "file-complete": {
        const resolver = this.completionResolvers.get(peerId);
        if (resolver && resolver.transferId === message.transferId) {
          clearTimeout(resolver.timeoutId);
          this.completionResolvers.delete(peerId);
          resolver.resolve();
          return;
        }
        break;
      }

      case "file-error": {
        const transfer =
          this.outgoingTransfers.get(peerId) ??
          this.incomingTransfers.get(peerId) ??
          null;
        this.emitFailed(
          peerId,
          transfer,
          new AvesError({
            message: message.message,
            code: "FILE_TRANSFER_FAILED",
            stage: "transport",
            retryable: false,
            peerId,
          }),
        );
        this.outgoingTransfers.delete(peerId);
        this.incomingTransfers.delete(peerId);
        this.clearReadyResolver(peerId);
        this.clearCompletionResolver(peerId);
        break;
      }
    }
  }

  handleChunk(peerId: string, data: string | Blob | ArrayBuffer): void {
    const transfer = this.incomingTransfers.get(peerId);
    if (!transfer) {
      return;
    }

    if (
      typeof data === "string" &&
      data === `${FILE_END_MARKER_PREFIX}${transfer.transferId}`
    ) {
      const result: FileTransferResult = {
        transferId: transfer.transferId,
        peerId,
        direction: "receive",
        name: transfer.name,
        size: transfer.size,
        mimeType: transfer.mimeType,
        lastModified: transfer.lastModified,
        blob: new Blob(transfer.chunks, { type: transfer.mimeType }),
      };

      this.fileTransferCompletedCallbacks.forEach((callback) =>
        callback(peerId, result),
      );
      this.sendControl(peerId, {
        __aves: FILE_PROTOCOL,
        kind: "file-complete",
        transferId: transfer.transferId,
      });
      this.incomingTransfers.delete(peerId);
      return;
    }

    transfer.chunks.push(data);
    transfer.bytesTransferred += getChunkSize(data);
    this.emitProgress(peerId, transfer, transfer.bytesTransferred);
  }

  failActiveTransfers(peerId: string, error: AvesError): void {
    const outgoingTransfer = this.outgoingTransfers.get(peerId) ?? null;
    const incomingTransfer = this.incomingTransfers.get(peerId) ?? null;

    if (outgoingTransfer) {
      this.emitFailed(peerId, outgoingTransfer, error);
    }

    if (incomingTransfer) {
      this.emitFailed(peerId, incomingTransfer, error);
    }

    const readyResolver = this.readyResolvers.get(peerId);
    if (readyResolver) {
      readyResolver.reject(error);
      this.clearReadyResolver(peerId);
    }

    const completionResolver = this.completionResolvers.get(peerId);
    if (completionResolver) {
      completionResolver.reject(error);
      this.clearCompletionResolver(peerId);
    }

    this.outgoingTransfers.delete(peerId);
    this.incomingTransfers.delete(peerId);
  }

  reportFailure(
    peerId: string,
    info: FileTransferInfo | null,
    error: AvesError,
  ): void {
    this.emitFailed(peerId, info, error);
  }

  clearReadyResolver(peerId: string): void {
    const resolver = this.readyResolvers.get(peerId);
    if (!resolver) {
      return;
    }

    clearTimeout(resolver.timeoutId);
    this.readyResolvers.delete(peerId);
  }

  clearCompletionResolver(peerId: string): void {
    const resolver = this.completionResolvers.get(peerId);
    if (!resolver) {
      return;
    }

    clearTimeout(resolver.timeoutId);
    this.completionResolvers.delete(peerId);
  }

  private async sendFileToPeer(
    peerId: string,
    blob: Blob,
    options: FileTransferOptions,
  ): Promise<FileTransferInfo> {
    const messageChannel = this.getMessageChannel(peerId);
    const fileChannel = this.getFileChannel(peerId);

    if (messageChannel.readyState !== "open") {
      throw new AvesError({
        message: `DataChannel not ready for ${peerId}`,
        code: "MESSAGE_CHANNEL_NOT_READY",
        stage: "transport",
        retryable: true,
        peerId,
      });
    }

    if (fileChannel.readyState !== "open") {
      throw new AvesError({
        message: `File channel not ready for ${peerId}`,
        code: "FILE_CHANNEL_NOT_READY",
        stage: "transport",
        retryable: true,
        peerId,
      });
    }

    if (this.outgoingTransfers.has(peerId)) {
      throw new AvesError({
        message: `A file transfer is already active for ${peerId}`,
        code: "FILE_TRANSFER_FAILED",
        stage: "transport",
        retryable: false,
        peerId,
      });
    }

    const transfer: OutgoingTransfer = {
      transferId: generateTransferId(),
      peerId,
      direction: "send",
      name: options.fileName || getBlobName(blob),
      size: blob.size,
      mimeType: options.mimeType || blob.type || "application/octet-stream",
      lastModified: options.lastModified ?? getBlobLastModified(blob) ?? Date.now(),
      blob,
      chunkSize: validateChunkSize(options.chunkSize ?? this.fileChunkSize),
    };

    this.outgoingTransfers.set(peerId, transfer);
    this.emitStarted(peerId, transfer);
    this.emitProgress(peerId, transfer, 0);

    try {
      const readyPromise = this.awaitReady(peerId, transfer.transferId);
      this.sendControl(peerId, {
        __aves: FILE_PROTOCOL,
        kind: "file-meta",
        transfer: {
          transferId: transfer.transferId,
          name: transfer.name,
          size: transfer.size,
          mimeType: transfer.mimeType,
          lastModified: transfer.lastModified,
        },
      });

      await readyPromise;

      let offset = 0;
      while (offset < transfer.size) {
        const nextChunk = transfer.blob.slice(offset, offset + transfer.chunkSize);
        const buffer = await nextChunk.arrayBuffer();
        fileChannel.send(buffer);
        offset += buffer.byteLength;
        this.emitProgress(peerId, transfer, offset);
      }

      const completionPromise = this.awaitCompletion(peerId, transfer.transferId);
      fileChannel.send(`${FILE_END_MARKER_PREFIX}${transfer.transferId}`);
      await completionPromise;

      const result: FileTransferResult = {
        ...transfer,
      };
      this.fileTransferCompletedCallbacks.forEach((callback) =>
        callback(peerId, result),
      );

      return transfer;
    } catch (error) {
      const transferError =
        error instanceof AvesError
          ? error
          : new AvesError({
              message: "File transfer failed",
              code: "FILE_TRANSFER_FAILED",
              stage: "transport",
              retryable: false,
              peerId,
            });
      this.sendControl(peerId, {
        __aves: FILE_PROTOCOL,
        kind: "file-error",
        transferId: transfer.transferId,
        message: transferError.message,
      });
      this.emitFailed(peerId, transfer, transferError);
      throw transferError;
    } finally {
      this.clearReadyResolver(peerId);
      this.clearCompletionResolver(peerId);
      this.outgoingTransfers.delete(peerId);
    }
  }

  private sendControl(peerId: string, message: FileControlMessage): void {
    const dataChannel = this.getMessageChannel(peerId);
    dataChannel.send(JSON.stringify(message));
  }

  private awaitReady(peerId: string, transferId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.readyResolvers.delete(peerId);
        reject(
          new AvesError({
            message: "Timed out waiting for file receiver readiness",
            code: "FILE_TRANSFER_TIMEOUT",
            stage: "transport",
            retryable: true,
            peerId,
          }),
        );
      }, FILE_READY_TIMEOUT_MS);

      this.readyResolvers.set(peerId, {
        transferId,
        resolve,
        reject,
        timeoutId,
      });
    });
  }

  private awaitCompletion(peerId: string, transferId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.completionResolvers.delete(peerId);
        reject(
          new AvesError({
            message: "Timed out waiting for file receiver confirmation",
            code: "FILE_TRANSFER_TIMEOUT",
            stage: "transport",
            retryable: true,
            peerId,
          }),
        );
      }, FILE_COMPLETE_TIMEOUT_MS);

      this.completionResolvers.set(peerId, {
        transferId,
        resolve,
        reject,
        timeoutId,
      });
    });
  }

  private emitStarted(peerId: string, info: FileTransferInfo): void {
    this.fileTransferStartedCallbacks.forEach((callback) => callback(peerId, info));
  }

  private emitProgress(
    peerId: string,
    info: FileTransferInfo,
    bytesTransferred: number,
  ): void {
    const progress: FileTransferProgress = {
      ...info,
      bytesTransferred: Math.min(bytesTransferred, info.size),
      progress:
        info.size === 0
          ? 100
          : Math.min(100, (bytesTransferred / info.size) * 100),
    };
    this.fileTransferProgressCallbacks.forEach((callback) =>
      callback(peerId, progress),
    );
  }

  private emitFailed(
    peerId: string,
    info: FileTransferInfo | null,
    error: AvesError,
  ): void {
    this.fileTransferFailedCallbacks.forEach((callback) =>
      callback(peerId, info, error),
    );
  }
}

export function isFileControlMessage(
  message: unknown,
): message is FileControlMessage {
  if (!message || typeof message !== "object") {
    return false;
  }

  const record = message as Record<string, unknown>;
  return record.__aves === FILE_PROTOCOL && typeof record.kind === "string";
}

export function validateChunkSize(chunkSize: number): number {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new AvesError({
      message: "chunkSize must be a positive integer",
      code: "INVALID_MESSAGE_FORMAT",
      stage: "protocol",
      retryable: false,
    });
  }
  return chunkSize;
}

function getChunkSize(data: string | Blob | ArrayBuffer): number {
  if (typeof data === "string") {
    return data.length;
  }

  if (data instanceof ArrayBuffer) {
    return data.byteLength;
  }

  return data.size;
}

function getBlobName(blob: Blob): string {
  const fileBlob = blob as Blob & { name?: string };
  return fileBlob.name || "shared-file";
}

function getBlobLastModified(blob: Blob): number | undefined {
  const fileBlob = blob as Blob & { lastModified?: number };
  return typeof fileBlob.lastModified === "number"
    ? fileBlob.lastModified
    : undefined;
}

function generateTransferId(): string {
  return `file-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
