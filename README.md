# Aves Core

一个轻量级的 WebRTC 客户端库，用于实时点对点通信。提供文件传输、语音通话和消息通信能力，基于全网状拓扑的 DataChannel 直连。

## 特性

- 基于房间的通信模型，全网状 P2P 拓扑
- 文本消息广播与单播（DataChannel 直传，不经服务器）
- 文件传输：分块二进制传输，握手协议，进度追踪
- 实时语音：getUserMedia + RTP transceiver，静音控制
- 自动断线重连与会话恢复
- 内置 WebSocket 信令客户端，request/response 关联
- 事件驱动架构，完整 TypeScript 类型定义
- 零运行时依赖

## 安装

```bash
npm install @yrzhao/aves-core
```

## 快速开始

```typescript
import { AvesClient } from "@yrzhao/aves-core";

const client = new AvesClient({
  signalingUrl: "ws://localhost:8080",
});

// 监听事件
client.on("message", (peerId, message) => {
  console.log(`来自 ${peerId}:`, message);
});

client.on("userJoined", (participant) => {
  console.log(`${participant.name} 加入了房间`);
});

// 创建并加入房间
const roomId = await client.createRoom();
const participants = await client.joinRoom(roomId, "Alice");

// 发送消息
client.sendMessage({ text: "大家好！" });

// 离开房间
await client.leaveRoom();
```

## 文件传输

```typescript
import type { FileTransferProgress, FileTransferResult } from "@yrzhao/aves-core";

// 发送文件（广播给所有对等端）
await client.sendFile(fileBlob, { name: "photo.jpg", size: fileBlob.size });

// 发送文件给特定对等端
await client.sendFile(fileBlob, { name: "doc.pdf" }, "peer-123");

// 监听传输进度
client.on("fileTransferProgress", (progress: FileTransferProgress) => {
  console.log(`${progress.fileName}: ${progress.percent}%`);
});

// 接收文件
client.on("fileTransferCompleted", (result: FileTransferResult) => {
  // result.file: Blob, result.fileName: string
  const url = URL.createObjectURL(result.file);
  // 用于下载或显示
});
```

## 语音通话

```typescript
// 开启语音（获取麦克风，发送给所有对等端）
await client.startVoice();

// 静音/取消静音
client.setMuted(true);

// 获取本地音频状态
const state = client.getLocalAudioState();
// { active: boolean, muted: boolean }

// 获取远端音频流
const remoteStream = client.getRemoteAudioStream("peer-123");
if (remoteStream) {
  const audio = new Audio();
  audio.srcObject = remoteStream;
  audio.play();
}

// 关闭语音
client.stopVoice();
```

## 配置

```typescript
interface AvesClientConfig {
  signalingUrl: string;           // 信令服务器 WebSocket URL（必需）
  iceServers?: RTCIceServer[];    // STUN/TURN 服务器
  reconnect?: {
    maxAttempts?: number;         // 最大重连次数（默认：5）
    delay?: number;               // 重连延迟 ms（默认：3000）
  };
  debug?: boolean;                // 调试日志（默认：false）
}
```

默认值：

```typescript
{
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  reconnect: { maxAttempts: 5, delay: 3000 },
  debug: false
}
```

## API 参考

### 房间管理

| 方法 | 返回值 | 说明 |
|------|--------|------|
| `createRoom()` | `Promise<string>` | 创建房间，返回 roomId |
| `joinRoom(roomId, userName)` | `Promise<Participant[]>` | 加入房间 |
| `joinRoom(roomId, userId, userName)` | `Promise<Participant[]>` | 以指定 userId 加入 |
| `leaveRoom()` | `Promise<void>` | 离开房间，关闭所有连接 |
| `destroy()` | `void` | 销毁客户端，清理全部资源 |

### 消息

| 方法 | 说明 |
|------|------|
| `sendMessage(message)` | 广播消息给所有对等端 |
| `sendMessageToPeer(peerId, message)` | 发送消息给特定对等端 |

### 文件与语音

| 方法 | 说明 |
|------|------|
| `sendFile(blob, options, peerId?)` | 发送文件（广播或单播） |
| `startVoice()` | 开启语音 |
| `stopVoice()` | 关闭语音 |
| `setMuted(muted)` | 静音控制 |
| `getLocalAudioState()` | 获取本地音频状态 |
| `getRemoteAudioStream(peerId)` | 获取远端音频 MediaStream |

### 状态查询

| 方法 | 说明 |
|------|------|
| `getConnectionState(peerId)` | 对等连接状态 |
| `getParticipants()` | 当前房间参与者列表 |
| `isConnected()` | 信令连接是否活跃 |

## 事件

| 事件 | 回调参数 | 说明 |
|------|----------|------|
| `message` | `(peerId, message)` | 收到对等端消息 |
| `userJoined` | `(participant)` | 用户加入 |
| `userLeft` | `(userId)` | 用户离开 |
| `connectionStateChange` | `(peerId, state)` | 对等连接状态变化 |
| `dataChannelStateChange` | `(peerId, state)` | 数据通道状态变化 |
| `signalingStateChange` | `(state)` | 信令连接状态变化 |
| `remoteAudioTrack` | `(peerId, stream)` | 收到远端音频流 |
| `localAudioStateChange` | `(state)` | 本地音频状态变化 |
| `fileTransferStarted` | `(info)` | 文件传输开始 |
| `fileTransferProgress` | `(progress)` | 文件传输进度 |
| `fileTransferCompleted` | `(result)` | 文件传输完成 |
| `fileTransferFailed` | `(error)` | 文件传输失败 |
| `error` | `(error)` | 错误 |

## 浏览器兼容性

- Chrome/Edge 56+
- Firefox 44+
- Safari 11+
- Opera 43+

## 许可证

MIT

## 相关包

- [@yrzhao/aves-node](https://www.npmjs.com/package/@yrzhao/aves-node) - 信令服务器
