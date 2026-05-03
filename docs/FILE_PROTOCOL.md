# aves:file-control Protocol

The file transfer protocol in aves-core uses **two separate RTCDataChannels** per peer pair:

- `"data"` -- carries JSON messages (user messages + file control messages)
- `"file"` -- carries binary chunks (ArrayBuffer) and end markers (UTF-8 strings)

File control messages are JSON objects sent over the **message channel** to coordinate the transfer. Binary content goes exclusively over the **file channel**.

The protocol is designed for one transfer at a time per peer pair. Concurrent transfers to different peers are supported.

---

## FileControlMessage Types

All control messages share a common discriminator:

```typescript
const FILE_PROTOCOL = "aves:file-control";
```

```typescript
type FileControlMessage =
  | { __aves: "aves:file-control"; kind: "file-meta";      transfer: FileMeta }
  | { __aves: "aves:file-control"; kind: "file-ready";      transferId: string }
  | { __aves: "aves:file-control"; kind: "file-complete";   transferId: string }
  | { __aves: "aves:file-control"; kind: "file-error";      transferId: string; message: string };
```

### file-meta (Sender -> Receiver)

Sent first over the message channel to announce a new file transfer.

```typescript
{
  __aves: "aves:file-control",
  kind: "file-meta",
  transfer: {
    transferId: string,    // unique ID, format: "file-{timestamp}-{random}"
    name: string,           // file name
    size: number,           // total file size in bytes
    mimeType: string,       // MIME type
    lastModified: number    // Unix timestamp (ms)
  }
}
```

### file-ready (Receiver -> Sender)

Sent in response to `file-meta` after the receiver has initialised its incoming transfer state.

```typescript
{
  __aves: "aves:file-control",
  kind: "file-ready",
  transferId: string
}
```

### file-complete (Receiver -> Sender)

Sent after the receiver has assembled all chunks and created the final `Blob`.

```typescript
{
  __aves: "aves:file-control",
  kind: "file-complete",
  transferId: string
}
```

### file-error (Either -> Other)

Sent when either side encounters an error during the transfer. The receiving side cleans up its transfer state immediately.

```typescript
{
  __aves: "aves:file-control",
  kind: "file-error",
  transferId: string,
  message: string
}
```

---

## Transfer Flow

```
  Sender                            Receiver
    |                                  |
    |  --- file-meta (msg chan) ---->  |
    |                                  |  Stores transfer info,
    |                                  |  initialises chunk buffer
    |  <--- file-ready (msg chan) ---  |
    |                                  |
    |  --- chunk[0] (file chan) ---->  |  Appends to chunks[]
    |  --- chunk[1] (file chan) ---->  |
    |  ---  ...              ---->     |
    |  --- chunk[N] (file chan) ---->  |
    |                                  |
    |  --- "__aves_file_end__:ID" ---> |  Reassembles Blob from chunks
    |    (file chan, as string)        |
    |                                  |
    |  <-- file-complete (msg chan) -- |  Fires fileTransferCompleted
    |                                  |
```

### Step-by-step

1. **Sender sends `file-meta`** on the message channel. Contains file name, size, MIME type, and last-modified timestamp.

2. **Receiver responds with `file-ready`** on the message channel. This confirms the receiver is prepared to accept binary chunks. The sender waits up to 10 seconds (`FILE_READY_TIMEOUT_MS`) for this response.

3. **Sender sends binary chunks** on the file channel. Each chunk is an `ArrayBuffer` of up to `chunkSize` bytes (default 16 KB). Chunks are sent sequentially in a loop.

4. **Sender sends the end marker** on the file channel as a UTF-8 string: `__aves_file_end__:{transferId}`.

5. **Receiver assembles the Blob** from all accumulated chunks and fires `fileTransferCompleted` with the resulting `Blob`.

6. **Receiver sends `file-complete`** on the message channel. The sender waits up to 10 seconds (`FILE_COMPLETE_TIMEOUT_MS`) for this confirmation before considering the transfer complete.

---

## End Marker Format

```
__aves_file_end__:file-1712345678901-a1b2c3d4
```

The marker is a plain string sent on the file channel. The receiver checks incoming file channel data: if the data is a string (not an ArrayBuffer) and matches `__aves_file_end__:{transferId}`, the transfer is complete.

---

## Timeouts

| Timeout | Duration | Constant | Fires On |
|---|---|---|---|
| Ready timeout | 10,000 ms | `FILE_READY_TIMEOUT_MS` | Sender waiting for `file-ready` response |
| Complete timeout | 10,000 ms | `FILE_COMPLETE_TIMEOUT_MS` | Sender waiting for `file-complete` confirmation |

When a timeout fires, the sender:
1. Rejects the pending transfer promise.
2. Sends a `file-error` control message to the receiver.
3. Fires `fileTransferFailed` with code `FILE_TRANSFER_TIMEOUT`.

---

## Chunking

- Default chunk size: 16,384 bytes (16 KB).
- Configurable via `AvesClientConfig.fileChunkSize` or per-transfer via `FileTransferOptions.chunkSize`.
- Must be a positive integer; otherwise an `AvesError` is thrown with code `INVALID_MESSAGE_FORMAT`.
- The last chunk is typically smaller (whatever remains of the file).
- Chunks are sent using `Blob.slice(offset, offset + chunkSize)` then converted to `ArrayBuffer` via `.arrayBuffer()`.

---

## File Channel Configuration

The file channel is configured with `binaryType = "arraybuffer"`. This ensures all binary data arrives as `ArrayBuffer` rather than `Blob`. End markers arrive as plain strings on the same channel.

```typescript
dataChannel.binaryType = "arraybuffer";
```

---

## Constraints

- **One transfer at a time per peer.** If a transfer is already active for peer A, attempting another `sendFile()` to peer A throws `FILE_TRANSFER_FAILED`.
- **Parallel transfers to different peers** are supported.
- **Channel closure during transfer** automatically fails any active transfer. If the file channel closes, all outgoing and incoming transfers for that peer are marked as failed with `WEBRTC_DATACHANNEL_FAILED`.

---

## Detection on the Receiver

When the message channel receives a JSON message, the receiver checks for the `__aves` property:

```typescript
function isFileControlMessage(message: unknown): message is FileControlMessage {
  if (!message || typeof message !== "object") return false;
  const record = message as Record<string, unknown>;
  return record.__aves === "aves:file-control" && typeof record.kind === "string";
}
```

If the message is a file control message, it is handled internally and **never exposed** to the application's `message` event. User code only sees regular messages.
