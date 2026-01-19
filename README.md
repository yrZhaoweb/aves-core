# Aves Core

一个轻量级的 WebRTC 客户端库，用于实时点对点通信。Aves Core 提供了简单的事件驱动 API，抽象了 WebRTC 的复杂性，让你专注于构建应用。

## 特性

- 🚀 简单直观的 WebRTC 连接 API
- 🔄 自动连接管理和重连机制
- 📡 内置 WebSocket 信令客户端
- 🎯 事件驱动的状态管理架构
- 📦 完整的 TypeScript 类型定义支持
- 🔌 基于房间的通信模型
- 💬 DataChannel 消息传输，自动序列化

## 安装

```bash
npm install aves-core
```

## 快速开始

```typescript
import { AvesClient } from "aves-core";

// 创建客户端实例
const client = new AvesClient({
  signalingUrl: "ws://localhost:3000",
});

// 监听消息
client.on("message", (peerId, message) => {
  console.log(`收到来自 ${peerId} 的消息:`, message);
});

// 监听用户加入
client.on("userJoined", (participant) => {
  console.log(`${participant.name} 加入了房间`);
});

// 创建房间
const roomId = await client.createRoom();
console.log("房间已创建:", roomId);

// 加入房间
const participants = await client.joinRoom(roomId, "user-123", "Alice");
console.log("已加入房间，当前参与者:", participants);

// 向所有对等端发送消息
client.sendMessage({ text: "大家好！" });

// 向特定对等端发送消息
client.sendMessageToPeer("peer-id", { text: "你好！" });

// 离开房间
await client.leaveRoom();
```

## 配置

### AvesClientConfig

```typescript
interface AvesClientConfig {
  signalingUrl: string; // 信令服务器的 WebSocket URL（必需）
  iceServers?: RTCIceServer[]; // STUN/TURN 服务器（可选）
  reconnect?: {
    // 重连设置（可选）
    maxAttempts?: number; // 最大重连次数（默认：5）
    delay?: number; // 重连延迟（毫秒，默认：1000）
  };
  debug?: boolean; // 启用调试日志（默认：false）
}
```

### 默认配置

如果未指定，Aves Core 使用以下默认值:

```typescript
{
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ],
  reconnect: {
    maxAttempts: 5,
    delay: 1000
  },
  debug: false
}
```

## API 参考

### AvesClient

管理 WebRTC 连接的主类。

#### 构造函数

```typescript
new AvesClient(config: AvesClientConfig)
```

使用指定配置创建新的 AvesClient 实例。

#### 方法

##### 房间管理

**`createRoom(): Promise<string>`**

创建新房间并返回房间 ID。

```typescript
const roomId = await client.createRoom();
```

**`joinRoom(roomId: string, userId: string, userName: string): Promise<Participant[]>`**

加入现有房间并返回当前参与者列表。

```typescript
const participants = await client.joinRoom("room-123", "user-456", "Bob");
```

**`leaveRoom(): Promise<void>`**

离开当前房间并关闭所有对等连接。

```typescript
await client.leaveRoom();
```

##### 消息传输

**`sendMessage(message: any): void`**

向房间内所有已连接的对等端发送消息。

```typescript
client.sendMessage({ type: "chat", text: "Hello!" });
```

**`sendMessageToPeer(peerId: string, message: any): void`**

向特定对等端发送消息。

```typescript
client.sendMessageToPeer("peer-123", { type: "private", text: "Hi there!" });
```

##### 状态查询

**`getConnectionState(peerId: string): RTCPeerConnectionState`**

返回特定对等端的连接状态。

```typescript
const state = client.getConnectionState("peer-123");
// Returns: 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed'
```

**`getParticipants(): Participant[]`**

返回当前房间内所有参与者的列表。

```typescript
const participants = client.getParticipants();
```

**`isConnected(): boolean`**

返回信令连接是否处于活动状态。

```typescript
if (client.isConnected()) {
  console.log("已连接到信令服务器");
}
```

##### 生命周期

**`destroy(): void`**

销毁客户端，关闭所有连接并清理资源。

```typescript
client.destroy();
```

## 事件

Aves Core 使用事件驱动架构。使用 `on`、`off` 和 `once` 方法订阅事件。

### 事件方法

**`on(event: string, callback: Function): this`**

注册事件监听器。

```typescript
client.on("message", (peerId, message) => {
  console.log("收到消息:", message);
});
```

**`off(event: string, callback: Function): this`**

移除事件监听器。

```typescript
const handler = (peerId, message) => console.log(message);
client.on("message", handler);
client.off("message", handler);
```

**`once(event: string, callback: Function): this`**

注册一次性事件监听器。

```typescript
client.once("userJoined", (participant) => {
  console.log("第一个用户加入:", participant);
});
```

### 可用事件

#### `connectionStateChange`

当对等连接状态改变时触发。

```typescript
client.on(
  "connectionStateChange",
  (peerId: string, state: RTCPeerConnectionState) => {
    console.log(`与 ${peerId} 的连接状态现在是 ${state}`);
  }
);
```

#### `dataChannelStateChange`

当数据通道状态改变时触发。

```typescript
client.on(
  "dataChannelStateChange",
  (peerId: string, state: RTCDataChannelState) => {
    console.log(`与 ${peerId} 的数据通道状态现在是 ${state}`);
  }
);
```

#### `signalingStateChange`

当信令连接状态改变时触发。

```typescript
client.on(
  "signalingStateChange",
  (state: "connecting" | "connected" | "disconnected") => {
    console.log(`信令状态: ${state}`);
  }
);
```

#### `message`

当从对等端接收到消息时触发。

```typescript
client.on("message", (peerId: string, message: any) => {
  console.log(`来自 ${peerId} 的消息:`, message);
});
```

#### `userJoined`

当新用户加入房间时触发。

```typescript
client.on("userJoined", (participant: Participant) => {
  console.log(`${participant.name} 加入了`);
});
```

#### `userLeft`

当用户离开房间时触发。

```typescript
client.on("userLeft", (userId: string) => {
  console.log(`用户 ${userId} 离开了`);
});
```

#### `error`

当发生错误时触发。

```typescript
client.on("error", (error: Error) => {
  console.error("错误:", error.message);
});
```

## 类型定义

### Participant

```typescript
interface Participant {
  id: string; // 唯一用户 ID
  name: string; // 显示名称
}
```

### RTCPeerConnectionState

```typescript
type RTCPeerConnectionState =
  | "new"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";
```

### RTCDataChannelState

```typescript
type RTCDataChannelState = "connecting" | "open" | "closing" | "closed";
```

## 高级用法

### 自定义 ICE 服务器

配置自定义 STUN/TURN 服务器以获得更好的连接性:

```typescript
const client = new AvesClient({
  signalingUrl: "ws://localhost:3000",
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:turn.example.com:3478",
      username: "user",
      credential: "pass",
    },
  ],
});
```

### 自定义重连策略

调整重连行为:

```typescript
const client = new AvesClient({
  signalingUrl: "ws://localhost:3000",
  reconnect: {
    maxAttempts: 10,
    delay: 2000,
  },
});
```

### 调试模式

启用调试日志以进行故障排查:

```typescript
const client = new AvesClient({
  signalingUrl: "ws://localhost:3000",
  debug: true,
});
```

## 错误处理

Aves Core 提供全面的错误处理:

```typescript
client.on("error", (error) => {
  if (error.message.includes("DataChannel not ready")) {
    console.log("等待连接建立...");
  } else if (error.message.includes("Room not found")) {
    console.log("房间不存在");
  } else {
    console.error("意外错误:", error);
  }
});

// 处理连接失败
client.on("connectionStateChange", (peerId, state) => {
  if (state === "failed") {
    console.log(`与 ${peerId} 的连接失败`);
  }
});

// 处理信令断开
client.on("signalingStateChange", (state) => {
  if (state === "disconnected") {
    console.log("信令连接丢失，正在尝试重连...");
  }
});
```

## 浏览器兼容性

Aves Core 支持所有支持 WebRTC 的现代浏览器:

- Chrome/Edge 56+
- Firefox 44+
- Safari 11+
- Opera 43+

## 许可证

MIT

## 相关包

- [aves-node](https://www.npmjs.com/package/aves-node) - Aves Core 的信令服务器
