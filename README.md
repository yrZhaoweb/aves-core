# Aves Core

轻量级 WebRTC 客户端库，零运行时依赖。支持消息、文件传输、语音、视频、屏幕共享，基于全网状 P2P 拓扑直连。

版本：`0.3.0`

## 安装

```bash
npm install @yrzhao/aves-core
```

## 快速开始

```typescript
import { AvesClient } from "@yrzhao/aves-core";

const client = new AvesClient({ signalingUrl: "ws://localhost:8080" });

client.on("message", (peerId, message) => console.log(`${peerId}:`, message));
client.on("userJoined", (p) => console.log(`${p.name} 加入了`));

const roomId = await client.createRoom();
await client.joinRoom(roomId, "Alice");

client.sendMessage({ text: "大家好！" });
await client.leaveRoom();
```

## 核心 API

### 房间管理

| 方法 | 返回 | 说明 |
|------|------|------|
| `createRoom()` | `Promise<string>` | 创建房间 |
| `joinRoom(roomId, name)` | `Promise<Participant[]>` | 加入房间 |
| `leaveRoom()` | `Promise<void>` | 离开 |
| `destroy()` | `void` | 销毁客户端 |

### 消息

```typescript
client.sendMessage({ text: "hi" });              // 广播
client.sendMessageToPeer(peerId, { text: "hi" }); // 单播
```

### 文件传输

```typescript
// 发送（广播）
await client.sendFile(fileBlob, { fileName: "photo.jpg" });

// 发送（单播）
await client.sendFile(fileBlob, { fileName: "doc.pdf", peerId: targetId });

// 监听
client.on("fileTransferProgress", (p, pgr) => {
  console.log(`${p}: ${Math.round(pgr.progress * 100)}%`);
});
client.on("fileTransferCompleted", (_, result) => {
  const url = URL.createObjectURL(result.blob);
});
```

### 语音

```typescript
await client.startVoice();
client.setMuted(true);
client.stopVoice();
```

### 视频

```typescript
await client.startVideo({ width: 1280, height: 720, frameRate: 30 });
client.setVideoMuted(true);
client.stopVideo();
```

### 屏幕共享

```typescript
await client.startScreenShare();  // 自动恢复摄像头
client.stopScreenShare();
```

## 配置

```typescript
new AvesClient({
  signalingUrl: "ws://localhost:8080",  // 必需
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  fileChunkSize: 65536,
  reconnect: { maxAttempts: 5, delay: 3000, requestTimeoutMs: 30000 },
  debug: false,
});
```

## 事件

| 事件 | 参数 | 说明 |
|------|------|------|
| `message` | `(peerId, message)` | 收到消息 |
| `userJoined` / `userLeft` | `(user)` / `(userId)` | 用户进出 |
| `connectionStateChange` | `(peerId, state)` | 连接状态 |
| `localAudioStateChange` | `(state)` | 本地音频状态 |
| `localVideoStateChange` | `(state)` | 本地视频状态 |
| `screenShareStateChange` | `(state)` | 屏幕共享状态 |
| `fileTransferStarted/Progress/Completed/Failed` | — | 文件传输各阶段 |
| `remoteAudioTrack` / `remoteVideoTrack` | `(peerId, stream, track)` | 收到远端媒体 |
| `error` | `(error)` | 错误 |

## 浏览器兼容性

Chrome/Edge 56+、Firefox 44+、Safari 11+、Opera 43+

## 发布信息

- 包大小：~30 KiB gzip
- 全网状拓扑：O(n) 连接数
- 零运行时依赖

MIT
