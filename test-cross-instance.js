/**
 * Cross-Instance Messaging Test Script (Improved)
 *
 * Connects to backend on port 5002 as User B, explicitly joins conversations,
 * and listens for messages to verify cross-instance messaging works via Redis.
 */

import { io } from "socket.io-client";

const USER_TOKEN = process.argv[2];

if (!USER_TOKEN) {
  console.error(`
❌ Missing JWT token!

Usage: node test-cross-instance.js <USER_B_JWT_TOKEN>

Get token from browser: DevTools > Application > Cookies > auth-token
  `);
  process.exit(1);
}

const SOCKET_URL = "http://localhost:5002";

console.log("🔌 Connecting to backend on port 5002...");
console.log(`📡 Socket URL: ${SOCKET_URL}`);
console.log(`🔐 Token: ${USER_TOKEN.substring(0, 20)}...\n`);

const socket = io(SOCKET_URL, {
  auth: { token: USER_TOKEN },
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  timeout: 20000,
});

let userId = null;

socket.on("connect", () => {
  console.log("✅ Connected to backend 5002!");
  console.log(`🆔 Socket ID: ${socket.id}\n`);

  socket.emit("user_online", { userId: socket.id });
  socket.emit("connection_confirmed");

  // Explicitly request conversations
  setTimeout(() => {
    console.log("📥 Requesting conversations...");
    socket.emit("get_conversations", {});
  }, 500);

  console.log("👂 Listening for messages... (send from frontend User A to User B)");
  console.log("────────────────────────────────────────────────────────────\n");
});

socket.on("conversations_joined", (data) => {
  console.log(`📂 Joined ${data.count} conversations:`);
  data.conversationIds.forEach(id => console.log(`   - ${id}`));
  console.log("────────────────────────────────────────────────────────────\n");
});

socket.on("connect_error", (error) => {
  console.error("❌ Connection error:", error.message);
});

socket.on("disconnect", (reason) => {
  console.log(`🔌 Disconnected: ${reason}`);
});

socket.on("new_message", (data) => {
  console.log("📨 NEW MESSAGE RECEIVED!");
  console.log("────────────────────────────────────────────────────────────");
  console.log(`From: ${data.message?.senderId?.username || data.message?.senderId}`);
  console.log(`Content: ${data.message?.content}`);
  console.log(`Conversation: ${data.message?.conversationId}`);
  console.log(`Timestamp: ${data.message?.createdAt}`);
  console.log("────────────────────────────────────────────────────────────\n");
});

socket.on("user_status_change", (data) => {
  console.log(`👤 User status: ${data.userId} -> ${data.online ? "online" : "offline"}`);
});

socket.on("error", (err) => {
  console.error("⚠️ Socket error:", err);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n👋 Shutting down...");
  socket.disconnect();
  process.exit(0);
});

console.log("⏳ Waiting for connection...\n");