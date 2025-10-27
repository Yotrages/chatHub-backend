import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { User } from "../Models/User";
import { Conversation } from "../Models/Conversation";
import { Message } from "../Models/Message";
import { Post } from "../Models/Post";
import mongoose, { Types } from "mongoose";
import { NotificationService } from "../services/notificationServices";
import { UserSettings } from "../Models/userSettings";
import dotenv from "dotenv";
// import { containsBlockedKeywords, isSensitiveContent } from "../utils/constant";
import { CallSession } from "../types";

dotenv.config();

declare module "socket.io" {
  interface Socket {
    userId: string;
    tokenExpiry: any;
  }
}
interface UserStatus {
  userId: string;
  socketId: string;
  lastActive: Date;
  isOnline: boolean;
}
export class SocketHandler {
  private io: Server;
  private onlineUsers = new Map<string, string>();
  private userStatusStore = new Map<string, UserStatus>();
  private activeCalls = new Map<string, CallSession>();
  private HEARTBEAT_INTERVAL = 30000;
  private OFFLINE_TIMEOUT = 60000;

  constructor(io: Server) {
    this.io = io;
    this.setupSocketHandlers();
    this.startHeartbeatCleanup();
    this.monitorTokenExpiry();
  }
  private async sendCallMessage(
    conversationId: string,
    content: string,
    senderId: string,
    callStatus: string
  ) {
    try {
      const message = new Message({
        content,
        senderId,
        conversationId,
        messageType: "call",
        callStatus,
        createdAt: new Date(),
        updatedAt: new Date(),
        readBy: [],
        reactions: [],
        edited: false,
      });
      await message.save();
      await message.populate("senderId", "username avatar");
      await Conversation.findByIdAndUpdate(conversationId, {
        lastMessage: message._id,
        updatedAt: new Date(),
      });
      this.io.to(conversationId).emit("new_message", { message });
      const conversation = await Conversation.findById(conversationId);
      for (const participantId of conversation.participants) {
        if (participantId.toString() !== senderId) {
          this.io.to(participantId.toString()).emit("unread_count_update", {
            conversationId,
            increment: true,
          });
        }
      }
    } catch (error) {
      console.error("Error sending call message:", error);
    }
  }
  private setupSocketHandlers() {
    this.io.use(this.authenticateSocket);
    this.io.on("connection", async (socket) => {
      console.log("Socket connection event fired");
      console.log("Socket ID:", socket.id);
      console.log("Socket userId:", socket.userId);
      console.log("User connected:", socket.userId, "Socket ID:", socket.id);
      if (!socket.userId) {
        console.error(
          "Socket connected without userId - authentication failed"
        );
        socket.disconnect();
        return;
      }
      console.log(`User ${socket.userId} connected successfully`);

      socket.emit("new_connection", {
        status: "connected",
        userId: socket.userId,
        timestamp: new Date().toISOString(),
      });
      this.onlineUsers.set(socket.userId, socket.id);
      this.userStatusStore.set(socket.userId, {
        userId: socket.userId,
        socketId: socket.id,
        lastActive: new Date(),
        isOnline: true,
      });
      await this.updateUserOnlineStatus(socket.userId, true);
      await this.joinUserConversations(socket);
      socket.on("connection_confirmed", () => {
        socket.emit("connection_confirmed", {
          status: "ready",
          timestamp: new Date().toISOString(),
        });
      });
      socket.emit("connection_confirmed", {
        status: "connected",
        userId: socket.userId,
        timestamp: new Date().toISOString(),
      });
      socket.on("heartbeat", () => {
        const status = this.userStatusStore.get(socket.userId);
        if (status) {
          status.lastActive = new Date();
          this.userStatusStore.set(socket.userId, status);
        }
        socket.emit("pong", { timestamp: new Date().toISOString() });
      });
      socket.on("send_message", (data) => this.handleSendMessage(socket, data));
      socket.on("join_conversation", (conversationId) => {
        socket.join(conversationId);
        console.log(
          `User ${socket.userId} joined conversation ${conversationId}`
        );
      });
      socket.on("leave_conversation", (conversationId) => {
        socket.leave(conversationId);
        console.log(
          `User ${socket.userId} left conversation ${conversationId}`
        );
      });
      socket.on("typing", (data) => this.handleTyping(socket, data));
      socket.on("stop_typing", (data) => this.handleStopTyping(socket, data));
      socket.on("edit_message", (data) => this.handleEditMessage(socket, data));
      socket.on("delete_message", (data) =>
        this.handleDeleteMessage(socket, data)
      );
      socket.on("add_reaction", (data) => this.handleAddReaction(socket, data));
      socket.on("remove_reaction", (data) =>
        this.handleRemoveReaction(socket, data)
      );
      socket.on("mark_read", (data) => this.handleMarkRead(socket, data));
      socket.on("pin_message", (data) => this.handlePinMessage(socket, data));
      socket.on("unpin_message", (data) =>
        this.handleUnpinMessage(socket, data)
      );
      socket.on("user_online", (data: any) => this.userOnline(socket, data));
      socket.on("user_offline", (data: any) => this.userOffline(socket, data));
      socket.on("mark_all_notification", (data) =>
        this.markAllAsRead(socket, data)
      );
      // WebRTC Signaling
      socket.on("offer", (data) => {
        console.log(
          "📤 Received offer event from:",
          socket.userId,
          "to:",
          data.to
        );
        this.handleOffer(socket, data);
      });

      socket.on("answer", (data) => {
        console.log(
          "📤 Received answer event from:",
          socket.userId,
          "to:",
          data.to
        );
        this.handleAnswer(socket, data);
      });

      socket.on("ice-candidate", (data) => {
        console.log(
          "📤 Received ice-candidate from:",
          socket.userId,
          "to:",
          data.to
        );
        this.handleIceCandidate(socket, data);
      });

      socket.on("call_request", (data) => {
        console.log(
          "📞 Received call_request from:",
          socket.userId,
          "to:",
          data.to
        );
        this.handleCallRequest(socket, data);
      });

      socket.on("call_accept", (data) => {
        console.log(
          "✅ Received call_accept from:",
          socket.userId,
          "to:",
          data.to
        );
        this.handleCallAccept(socket, data);
      });

      socket.on("call_decline", (data) => {
        console.log(
          "❌ Received call_decline from:",
          socket.userId,
          "to:",
          data.to
        );
        this.handleCallDecline(socket, data);
      });

      socket.on("call_end", (data) => {
        console.log(
          "🔚 Received call_end from:",
          socket.userId,
          "to:",
          data.to
        );
        this.handleCallEnd(socket, data);
      });

      socket.on("call_timeout", (data) => {
        console.log("⏰ Received call_timeout from:", socket.userId);
        this.handleCallTimeout(socket, data);
      });

      socket.on("call_failed", (data) => {
        console.log("❌ Received call_failed from:", socket.userId);
        this.handleCallFailed(socket, data);
      });

      socket.on("disconnect", async (reason) => {
        console.log("🔌 User disconnected:", socket.userId, "Reason:", reason);

        await this.handleUserDisconnectCalls(socket.userId);

        const status = this.userStatusStore.get(socket.userId);
        if (status) {
          status.isOnline = false;
          status.lastActive = new Date();
          this.userStatusStore.set(socket.userId, status);
        }

        setTimeout(() => {
          const currentStatus = this.userStatusStore.get(socket.userId);
          if (currentStatus && !currentStatus.isOnline) {
            this.onlineUsers.delete(socket.userId);
            this.updateUserOnlineStatus(socket.userId, false);
            this.io.emit("user_status_change", {
              userId: socket.userId,
              online: false,
            });
          }
        }, 5000);
      });

      socket.on("error", (error) => {
        console.error("Socket error for user", socket.userId, ":", error);
      });
    });
  }
  // Handle user disconnect and cleanup active calls
  private async handleUserDisconnectCalls(userId: string) {
  for (const [callId, callSession] of this.activeCalls.entries()) {
    if (callSession.caller === userId || callSession.callee === userId) {
      const otherUserId =
        callSession.caller === userId
          ? callSession.callee
          : callSession.caller;
      const otherSocket = this.onlineUsers.get(otherUserId);

      // Calculate call duration if call was connected
      let duration = 0;
      if (callSession.startTime && callSession.endTime === undefined) {
        callSession.endTime = new Date();
        duration = Math.floor(
          (callSession.endTime.getTime() - callSession.startTime.getTime()) / 1000
        );
      }

      // Determine if this was a real conversation or failed connection
      const wasInConversation = duration >= 30; // 30+ seconds = real call
      const wasConnecting = duration < 5 && duration > 0; // Less than 5 secs = failed
      const neverConnected = !callSession.startTime; // Never got to connected state

      let callStatus: string;
      let callMessage: string;

      if (wasInConversation) {
        callStatus = "ended";
        callMessage = `${
          callSession.isVideo ? "Video" : "Voice"
        } call ended - Connection lost (${this.formatDuration(duration)})`;
      } else if (wasConnecting || neverConnected) {
        // Call failed during connection or never connected
        callStatus = "failed";
        callMessage = `${
          callSession.isVideo ? "Video" : "Voice"
        } call failed - Connection lost`;
      } else {
        // Between 5-30 seconds - brief call that got disconnected
        callStatus = "ended";
        callMessage = `${
          callSession.isVideo ? "Video" : "Voice"
        } call ended - Connection lost (${this.formatDuration(duration)})`;
      }

      // Notify the other user about disconnection
      if (otherSocket) {
        this.io.to(otherSocket).emit("call_disconnected", {
          from: userId,
          callId: callId,
          timestamp: new Date().toISOString(),
          reason: "disconnect",
          status: callStatus,
          duration: duration,
        });
      }

      // Update call session
      callSession.status = "ended";

      console.log(
        `Call ${callId} ${callStatus} due to user ${userId} disconnect (duration: ${duration}s)`
      );

      // Save call message to conversation
      const conversation = await Conversation.findOne({
        participants: {
          $all: [callSession.caller, callSession.callee],
          $size: 2,
        },
        type: "direct",
      });

      if (conversation) {
        await this.sendCallMessage(
          conversation._id.toString(),
          callMessage,
          userId,
          callStatus
        );
      }

      setTimeout(() => {
        this.activeCalls.delete(callId);
      }, 2000);
    }
  }
}

  private startHeartbeatCleanup() {
    setInterval(async () => {
      const now = new Date().getTime();
      for (const [userId, status] of this.userStatusStore.entries()) {
        if (now - status.lastActive.getTime() > this.OFFLINE_TIMEOUT) {
          status.isOnline = false;
          this.userStatusStore.set(userId, status);
          await this.updateUserOnlineStatus(userId, false);
          this.io.emit("user_status_change", { userId, online: false });
        }
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  private authenticateSocket = async (socket: any, next: any) => {
    try {
      console.log("🔐 Authenticating socket...");
      console.log("Handshake auth:", socket.handshake.auth);

      const token = socket.handshake.auth.token;

      if (!token) {
        console.error("❌ No token provided in handshake");
        return next(new Error("Authentication error: No token provided"));
      }

      console.log("🔍 Verifying JWT token...");

      let decoded: any;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET!);
        console.log("✅ Token verified. User ID:", decoded.userId);
      } catch (jwtError: any) {
        console.error("❌ JWT verification failed:", jwtError.message);
        return next(new Error(`Authentication error: ${jwtError.message}`));
      }

      if (!decoded.userId) {
        console.error("❌ Token does not contain userId");
        return next(new Error("Authentication error: Invalid token payload"));
      }

      socket.userId = decoded.userId;
      console.log("✅ Set socket.userId to:", socket.userId);

      console.log("🔍 Checking if user exists in database...");
      const user = await User.findById(decoded.userId);

      if (!user) {
        console.error("❌ User not found in database:", decoded.userId);
        return next(new Error("Authentication error: User not found"));
      }

      console.log("✅ User found:", user.username);
      console.log(
        "✅ Socket authentication successful for user:",
        socket.userId
      );

      next();
    } catch (error: any) {
      console.error("❌ Socket authentication error:", error);
      next(new Error(`Authentication failed: ${error.message}`));
    }
  };

  private monitorTokenExpiry() {
    setInterval(() => {
      const now = Math.floor(Date.now() / 1000);

      this.io.sockets.sockets.forEach((socket: any) => {
        if (socket.tokenExpiry && socket.tokenExpiry < now) {
          console.log(`Disconnecting user ${socket.userId} - token expired`);
          socket.emit("token_expired", {
            message: "Your session has expired. Please login again.",
          });
          socket.disconnect(true);
        }
      });
    }, 60000);
  }

  private async joinUserConversations(socket: any) {
    try {
      const conversations = await Conversation.find({
        participants: socket.userId,
      }).limit(50);
      conversations.forEach((conv) => socket.join(conv._id.toString()));
      socket.emit("conversations_joined", {
        count: conversations.length,
        conversationIds: conversations.map((c) => c._id.toString()),
      });
    } catch (error) {
      console.error("Error joining conversations:", error);
      socket.emit("error", { message: "Failed to join conversations" });
    }
  }

  private async userOnline(socket: Socket, data: any) {
    try {
      const userId = socket.userId;

      if (!userId) {
        console.error("No userId found on socket");
        socket.emit("error", { error: "User not authenticated" });
        return;
      }

      const user = await User.findById(userId);
      if (!user) {
        console.error("User not found:", userId);
        socket.emit("error", { error: "User not found" });
        return;
      }

      const userSettings = await UserSettings.findOne({ userId });
      if (!userSettings) {
        console.error("User settings not found for:", userId);
        socket.emit("error", { error: "User settings not found" });
        return;
      }

      if (userSettings.account.isDeactivated) {
        socket.emit("error", { error: "Account is deactivated" });
        return;
      }

      const status = this.userStatusStore.get(userId);
      if (status) {
        status.isOnline = true;
        status.lastActive = new Date();
        this.userStatusStore.set(userId, status);
      }

      await this.updateUserOnlineStatus(userId, true);

      socket.emit("online_success", {
        success: true,
        message: "User online status updated successfully",
      });
    } catch (err) {
      console.error("Error in userOnline:", err);
      socket.emit("error", { error: "Failed to update online status" });
    }
  }

  private async userOffline(socket: Socket, data: any) {
    try {
      const userId = socket.userId;

      if (!userId) {
        console.error("No userId found on socket");
        socket.emit("error", { error: "User not authenticated" });
        return;
      }

      const user = await User.findById(userId);
      if (!user) {
        console.error("User not found:", userId);
        socket.emit("error", { error: "User not found" });
        return;
      }

      const status = this.userStatusStore.get(userId);
      if (status) {
        status.isOnline = false;
        status.lastActive = new Date();
        this.userStatusStore.set(userId, status);
      }

      await this.updateUserOnlineStatus(userId, false);

      socket.emit("offline_success", {
        success: true,
        message: "User offline status updated successfully",
      });
    } catch (err) {
      console.error("Error in userOffline:", err);
      socket.emit("error", { error: "Failed to update offline status" });
    }
  }

  private async handleSendMessage(socket: any, data: any) {
    try {
      const {
        conversationId,
        content,
        messageType = "text",
        fileUrl,
        fileName,
        replyTo,
        postId,
      } = data;
      const conversation = await Conversation.findById(conversationId);
      if (!conversation || !conversation.participants.includes(socket.userId)) {
        socket.emit("message_error", {
          error: "Unauthorized or conversation not found",
        });
        return;
      }

      if (replyTo) {
        const repliedMessage = await Message.findById(replyTo);
        if (
          !repliedMessage ||
          repliedMessage.conversationId.toString() !== conversationId
        ) {
          socket.emit("message_error", {
            error: "Invalid replyTo message ID",
          });
          return;
        }
      }
      const message = new Message({
        content,
        senderId: socket.userId,
        conversationId,
        messageType,
        fileUrl,
        fileName,
        replyTo,
        createdAt: new Date(),
        updatedAt: new Date(),
        reactions: [],
        edited: false,
        readBy: [],
      });
      await message.save();
      await message.populate([
        { path: "senderId", select: "username avatar" },
        {
          path: "replyTo",
          select: "content senderId messageType fileUrl fileName",
          populate: { path: "senderId", select: "username avatar" },
        },
      ]);
      await Conversation.findByIdAndUpdate(conversationId, {
        lastMessage: message._id,
        updatedAt: new Date(),
      });
      if (messageType === "post" && postId) {
        const post = await Post.findById(postId);
        if (post) {
          post.shareCount = (post.shareCount || 0) + 1;
          await post.save();
        }
      }
      this.io.to(conversationId).emit("new_message", { message });
      for (const participantId of conversation.participants) {
        if (participantId.toString() !== socket.userId) {
          this.io.to(participantId.toString()).emit("unread_count_update", {
            conversationId,
            increment: true,
          });
        }
      }
      socket.emit("message_sent", { messageId: message._id });
    } catch (error) {
      console.error("Error sending message:", error);
      socket.emit("message_error", { error: "Failed to send message" });
    }
  }
  private async handleEditMessage(socket: any, data: any) {
    try {
      const { messageId, content } = data;
      const message = await Message.findById(messageId);
      if (!message || message.senderId.toString() !== socket.userId) {
        socket.emit("message_error", {
          error: "Unauthorized or message not found",
        });
        return;
      }
      if (message.messageType === "call") {
        socket.emit("message_error", {
          error: "Call messages cannot be edited",
        });
        return;
      }
      message.content = content;
      message.edited = true;
      message.editedAt = new Date();
      await message.save();
      await message.populate("senderId", "username avatar");
      this.io
        .to(message.conversationId.toString())
        .emit("message_edited", { message });
    } catch (error) {
      socket.emit("message_error", { error: "Failed to edit message" });
    }
  }
  private async handleDeleteMessage(socket: any, data: any) {
    try {
      const { messageId } = data;
      const message = await Message.findById(messageId);
      if (!message || message.senderId.toString() !== socket.userId) {
        socket.emit("message_error", {
          error: "Unauthorized or message not found",
        });
        return;
      }
      await Message.deleteOne({ _id: messageId });
      this.io
        .to(message.conversationId.toString())
        .emit("message_deleted", { messageId });
    } catch (error) {
      socket.emit("message_error", { error: "Failed to delete message" });
    }
  }
  private async handleAddReaction(socket: Socket, data: any) {
    try {
      const userId = socket.userId;
      const { messageId, emoji, name } = data;
      const message = await Message.findById(messageId);
      if (!message) {
        socket.emit("message_error", { error: "Message not found" });
        return;
      }
      message.reactions = message.reactions.filter(
        (reaction, index, self) =>
          index ===
          self.findIndex(
            (r) => r.userId.toString() === reaction.userId.toString()
          )
      );

      const existingReactionIndex = message.reactions.findIndex(
        (r) => r.userId.toString() === userId
      );

      let isLiked = false;
      let actionType = "";

      if (existingReactionIndex !== -1) {
        const existingReaction = message.reactions[existingReactionIndex];
        if (existingReaction.emoji.category === emoji) {
          message.reactions.splice(existingReactionIndex, 1);
          isLiked = false;
          actionType = "removed";
        } else {
          message.reactions[existingReactionIndex].emoji = {
            category: emoji,
            name,
          };
          isLiked = true;
          actionType = "updated";
        }
      } else {
        message.reactions.push({
          userId: userId,
          emoji: { category: emoji, name },
        });
        isLiked = true;
        actionType = "added";
      }

      await message.save();
      await message.populate([
        {
          path: "senderId",
          select: "username avatar",
        },
        {
          path: "reactions",
          populate: {
            path: "userId",
            select: "username avatar",
          },
        },
      ]);
      this.io
        .to(message.conversationId.toString())
        .emit("reaction_added", { message });
    } catch (error) {
      socket.emit("message_error", { error: "Failed to add reaction" });
    }
  }
  private async markAllAsRead(socket: any, data: any) {
    try {
      const userId = socket.userId;
      if (!userId) {
        socket.emit("error", "User not authenticated");
      }
      await NotificationService.markAllAsRead(userId);
      socket.emit("notification_all_read", {
        success: true,
        message: "All notifications marked as read",
      });
    } catch (error) {
      console.error("Error in markAllAsRead:", error);
      socket.emit("error", {
        success: false,
        error,
        message: "Failed to mark all notifications as read",
      });
    }
  }
  private async handleRemoveReaction(socket: any, data: any) {
    try {
      const { messageId } = data;
      const message = await Message.findById(messageId);
      if (!message) {
        socket.emit("message_error", { error: "Message not found" });
        return;
      }
      message.reactions =
        message.reactions?.filter(
          (r) => r.userId.toString() !== socket.userId
        ) || [];
      await message.save();
      await message.populate("senderId", "username avatar");
      this.io
        .to(message.conversationId.toString())
        .emit("reaction_removed", { message });
    } catch (error) {
      socket.emit("message_error", { error: "Failed to remove reaction" });
    }
  }
  private async handleMarkRead(socket: any, data: any) {
    try {
      const { conversationId } = data;
      const userId = socket.userId;
      await Message.updateMany(
        {
          conversationId,
          senderId: { $ne: userId },
          "readBy.userId": { $ne: userId },
        },
        { $push: { readBy: { userId, readAt: new Date() } } }
      );
      this.io
        .to(conversationId)
        .emit("messages_read", { conversationId, userId });
    } catch (error) {
      console.error("Error marking messages as read:", error);
      socket.emit("message_error", {
        error: "Failed to mark messages as read",
      });
    }
  }
  private async handlePinMessage(socket: any, data: any) {
    try {
      const { conversationId, messageId } = data;
      const userId = socket.userId;
      const conversation = await Conversation.findById(conversationId);
      if (
        !conversation ||
        !conversation.participants.includes(userId) ||
        (conversation.type === "group" &&
          !conversation.admins?.includes(userId))
      ) {
        socket.emit("message_error", { error: "Unauthorized" });
        return;
      }
      const messageObjectId = new Types.ObjectId(messageId);
      if (!conversation.pinnedMessages.includes(messageObjectId)) {
        conversation.pinnedMessages.push(messageObjectId);
        await conversation.save();
      }
      this.io
        .to(conversationId)
        .emit("message_pinned", { conversationId, messageId });
    } catch (error) {
      socket.emit("message_error", { error: "Failed to pin message" });
    }
  }
  private async handleUnpinMessage(socket: any, data: any) {
    try {
      const { conversationId, messageId } = data;
      const userId = socket.userId;
      const conversation = await Conversation.findById(conversationId);
      if (
        !conversation ||
        !conversation.participants.includes(userId) ||
        (conversation.type === "group" &&
          !conversation.admins?.includes(userId))
      ) {
        socket.emit("message_error", { error: "Unauthorized" });
        return;
      }
      conversation.pinnedMessages = conversation.pinnedMessages.filter(
        (id) => id.toString() !== messageId
      );
      await conversation.save();
      this.io
        .to(conversationId)
        .emit("message_unpinned", { conversationId, messageId });
    } catch (error) {
      socket.emit("message_error", { error: "Failed to unpin message" });
    }
  }
  private handleTyping(socket: any, data: any) {
    const { conversationId } = data;
    socket
      .to(conversationId)
      .emit("user_typing", { userId: socket.userId, conversationId });
  }
  private handleStopTyping(socket: any, data: any) {
    const { conversationId } = data;
    socket
      .to(conversationId)
      .emit("user_stop_typing", { userId: socket.userId, conversationId });
  }
  private formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }

  private async updateUserOnlineStatus(userId: string, online: boolean) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        console.log("User not found for status update:", userId);
        return;
      }

      const userSettings = await UserSettings.findOne({ userId });
      if (!userSettings || !userSettings.privacy.showOnlineStatus) {
        console.log("User privacy settings prevent online status updates");
        return;
      }

      user.online = online;
      user.lastSeen = online ? null : new Date();
      await user.save();

      // Notify conversation participants
      const conversations = await Conversation.find({ participants: userId });

      for (const conv of conversations) {
        const participants = conv.participants.filter(
          (p) => p.toString() !== userId
        );

        for (const participantId of participants) {
          const participantSettings = await UserSettings.findOne({
            userId: participantId,
          });

          if (
            participantSettings &&
            !participantSettings.security.blockedUsers.includes(
              new mongoose.Types.ObjectId(userId)
            ) &&
            !userSettings.security.blockedUsers.includes(
              new mongoose.Types.ObjectId(participantId)
            )
          ) {
            // Emit to conversation room
            this.io
              .to(conv._id.toString())
              .emit(online ? "user_online" : "user_offline", { userId });

            // Only create notification if user went online and participant has notifications enabled
            // REMOVED the notification creation since 'online_status' is not a valid type
            // You can add this back once you add 'online_status' to your Notification enum
            /*
          if (
            online &&
            participantSettings.notifications.inApp.onlineStatus
          ) {
            const message = `${user.username || 'Someone'} is now online`;
            if (
              !containsBlockedKeywords(message, participantSettings.content.blockedKeywords) &&
              (participantSettings.content.showSensitiveContent || !isSensitiveContent(message))
            ) {
              // Only create notification if 'online_status' is added to Notification schema
              // await NotificationService.createNotification({
              //   recipientId: participantId.toString(),
              //   senderId: userId,
              //   type: "online_status",
              //   message,
              //   entityType: "user",
              //   entityId: userId,
              //   actionUrl: `/profile/${userId}`,
              // });
            }
          }
          */
          }
        }
      }

      // Emit global status change
      this.io.emit("user_status_change", { userId, online });

      console.log(
        `User ${userId} status updated: ${online ? "online" : "offline"}`
      );
    } catch (error) {
      console.error("Error updating user status:", error);
    }
  }

private handleOffer(socket: any, data: any) {
  const { sdp, to, isVideo, callId } = data;
  console.log(`📤 Received offer event from:`, socket.userId, `to:`, to);
  console.log(`📤 Processing offer:`, {
    from: socket.userId,
    to,
    isVideo,
    callId,
    hasRecipient: this.onlineUsers.has(to),
  });

  if (!this.onlineUsers.has(to)) {
    console.log(`❌ Recipient ${to} not found`);
    socket.emit("call_error", { 
      error: "User not available",
      callId: callId 
    });
    
    // Clean up the call session
    const callSession = this.activeCalls.get(callId);
    if (callSession) {
      this.activeCalls.delete(callId);
    }
    return;
  }

  let callSession = this.activeCalls.get(callId);

  if (!callSession) {
    console.log(
      `⚠️ Call session not found, creating one for callId: ${callId}`
    );
    callSession = {
      callId: callId,
      caller: socket.userId,
      callee: to,
      isVideo: isVideo,
      status: "calling",
    };
    this.activeCalls.set(callId, callSession);
  }

  const recipientSocketId = this.onlineUsers.get(to);
  if (recipientSocketId) {
    console.log(
      `✅ Forwarding offer to ${to} at socket ${recipientSocketId}`
    );
    this.io.to(recipientSocketId).emit("offer", {
      sdp,
      from: socket.userId,
      isVideo: callSession.isVideo,
      callId: callSession.callId,
    });
  }
}


private handleAnswer(socket: any, data: any) {
  const { sdp, to, callId } = data;
  console.log(`📤 Received answer event from:`, socket.userId, `to:`, to);
  console.log(`📤 Processing answer:`, {
    from: socket.userId,
    to,
    callId,
    hasRecipient: this.onlineUsers.has(to),
  });

  // Check if recipient is still connected
  if (!this.onlineUsers.has(to)) {
    console.log(`❌ Recipient ${to} not found during answer`);
    
    // Find and clean up the call
    const callSession = callId ? this.activeCalls.get(callId) : undefined;
    if (callSession) {
      callSession.status = "ended";
      callSession.endTime = new Date();
      
      socket.emit("call_failed", {
        callId: callSession.callId,
        reason: "Other user disconnected",
        timestamp: new Date().toISOString(),
      });

      this.activeCalls.delete(callId);
    }
    return;
  }

  const callSession = callId
    ? this.activeCalls.get(callId)
    : Array.from(this.activeCalls.values()).find(
        (call) =>
          (call.caller === to && call.callee === socket.userId) ||
          (call.caller === socket.userId && call.callee === to)
      );

  if (callSession) {
    // Set to connected when answer is received
    callSession.status = "connected";
    if (!callSession.startTime) {
      callSession.startTime = new Date();
      console.log(
        `✅ Call ${callSession.callId} connected at ${callSession.startTime}`
      );
    }
  }

  const recipientSocketId = this.onlineUsers.get(to);
  if (recipientSocketId) {
    console.log(
      `✅ Forwarding answer to ${to} at socket ${recipientSocketId}`
    );
    this.io.to(recipientSocketId).emit("answer", {
      sdp,
      from: socket.userId,
      callId: callSession?.callId,
    });
  }
}


  private handleIceCandidate(socket: any, data: any) {
    const { candidate, to, callId } = data;
    console.log(`🧊 Processing ICE candidate:`, {
      from: socket.userId,
      to,
      callId,
      hasRecipient: this.onlineUsers.has(to),
    });

    if (!this.onlineUsers.has(to)) {
      console.log(`❌ Recipient ${to} not found for ICE candidate`);
      return;
    }

    const recipientSocketId = this.onlineUsers.get(to);
    if (recipientSocketId) {
      console.log(`✅ Forwarding ICE candidate to ${to}`);
      this.io.to(recipientSocketId).emit("ice-candidate", {
        candidate,
        from: socket.userId,
        callId,
      });
    }
  }

  private handleCallRequest(socket: any, data: any) {
    const { to, isVideo, callId } = data;
    console.log(`📞 Received call_request from:`, socket.userId, `to:`, to);

    // Check for existing active calls
    const existingCall = Array.from(this.activeCalls.values()).find(
      (call) =>
        ((call.caller === socket.userId && call.callee === to) ||
          (call.caller === to && call.callee === socket.userId)) &&
        call.status !== "ended"
    );

    if (existingCall) {
      console.log(`❌ Call already in progress: ${existingCall.callId}`);
      socket.emit("call_error", {
        error: "Call already in progress",
        callId: existingCall.callId,
      });
      return;
    }

    // FIXED: Create call session IMMEDIATELY (before checking online status)
    const callSession: CallSession = {
      callId: callId,
      caller: socket.userId,
      callee: to,
      isVideo,
      status: "calling",
    };

    this.activeCalls.set(callSession.callId, callSession);
    console.log(`✅ Call session created and stored: ${callSession.callId}`);

    // Check if recipient is online
    const recipientSocketId = this.onlineUsers.get(to);

    if (recipientSocketId) {
      // User is online - send call request immediately
      console.log(`📤 Emitting call_request to socket ${recipientSocketId}`);
      this.io.to(recipientSocketId).emit("call_request", {
        from: socket.userId,
        isVideo,
        timestamp: new Date().toISOString(),
        callId: callSession.callId,
      });
    } else {
      // User is offline - inform caller and monitor for reconnection
      console.log(`⚠️ User ${to} is offline, monitoring for reconnection...`);
      socket.emit("call_waiting", {
        message: "Calling...",
        status: "offline",
      });
    }

    // CRITICAL: Monitor for user coming online during 45-second window
    const checkInterval = setInterval(() => {
      const call = this.activeCalls.get(callSession.callId);

      // Stop monitoring if call ended or answered
      if (!call || call.status !== "calling") {
        console.log(`⏹️ Stopping monitoring - status: ${call?.status}`);
        clearInterval(checkInterval);
        return;
      }

      // Check if user came online
      const currentRecipientSocket = this.onlineUsers.get(to);
      if (
        currentRecipientSocket &&
        currentRecipientSocket !== recipientSocketId
      ) {
        console.log(`✅ User ${to} came online! Sending call request`);

        // Send call request to newly online user
        this.io.to(currentRecipientSocket).emit("call_request", {
          from: socket.userId,
          isVideo,
          timestamp: new Date().toISOString(),
          callId: callSession.callId,
        });

        // Update caller
        socket.emit("call_waiting", {
          message: "Ringing...",
          status: "online",
        });

        clearInterval(checkInterval);
      }
    }, 1000); // Check every second

    // 45-second timeout
    setTimeout(async () => {
      clearInterval(checkInterval);

      const call = this.activeCalls.get(callSession.callId);
      if (call && (call.status === "calling" || call.status === "ringing")) {
        console.log(`⏰ Call ${callSession.callId} timed out`);
        call.status = "ended";
        call.endTime = new Date();

        // Send timeout to both parties
        socket.emit("call_timeout", {
          callId: callSession.callId,
          timestamp: new Date().toISOString(),
        });

        const currentRecipientSocket = this.onlineUsers.get(to);
        if (currentRecipientSocket) {
          this.io.to(currentRecipientSocket).emit("call_timeout", {
            callId: callSession.callId,
            timestamp: new Date().toISOString(),
          });
        }

        // Send missed call message
        const conversation = await Conversation.findOne({
          participants: {
            $all: [call.caller, call.callee],
            $size: 2,
          },
          type: "direct",
        });

        if (conversation) {
          await this.sendCallMessage(
            conversation._id.toString(),
            `Missed ${call.isVideo ? "video" : "voice"} call`,
            call.caller,
            "missed"
          );
        }

        setTimeout(() => this.activeCalls.delete(callSession.callId), 5000);
      }
    }, 45000);
  }

  private async sendMissedCallNotification(
    callerId: string,
    calleeId: string,
    isVideo: boolean
  ) {
    try {
      const conversation = await Conversation.findOne({
        participants: { $all: [callerId, calleeId], $size: 2 },
        type: "direct",
      });

      if (conversation) {
        await this.sendCallMessage(
          conversation._id.toString(),
          `Missed ${isVideo ? "video" : "voice"} call`,
          callerId,
          "missed"
        );
      }
    } catch (error) {
      console.error("Error sending missed call notification:", error);
    }
  }

private async handleCallAccept(socket: any, data: any) {
  const { to, callId } = data;
  console.log(
    `✅ Received call_accept from:`,
    socket.userId,
    `to:`,
    to,
    `callId:`,
    callId
  );

  let callSession = callId
    ? this.activeCalls.get(callId)
    : Array.from(this.activeCalls.values()).find(
        (call) => call.caller === to && call.callee === socket.userId
      );

  if (!callSession) {
    console.error(`❌ No active call found for callId: ${callId}`);
    socket.emit("call_error", { error: "No active call found" });
    return;
  }

  // Check if caller is still connected
  if (!this.onlineUsers.has(to)) {
    console.error(`❌ Caller ${to} disconnected before accept`);
    
    // Clean up the call
    callSession.status = "ended";
    callSession.endTime = new Date();
    
    socket.emit("call_failed", {
      callId: callSession.callId,
      reason: "Caller disconnected",
      timestamp: new Date().toISOString(),
    });

    // Send failed call message
    const conversation = await Conversation.findOne({
      participants: {
        $all: [callSession.caller, callSession.callee],
        $size: 2,
      },
      type: "direct",
    });

    if (conversation) {
      await this.sendCallMessage(
        conversation._id.toString(),
        `${callSession.isVideo ? "Video" : "Voice"} call failed - Connection lost`,
        socket.userId,
        "failed"
      );
    }

    this.activeCalls.delete(callId);
    return;
  }

  // Update status to accepted and track acceptance time
  callSession.status = "accepted";
  callSession.acceptedTime = new Date(); // NEW: Track when user accepted
  console.log(`✅ Call ${callSession.callId} status updated to 'accepted'`);

  // Notify the caller
  const callerSocketId = this.onlineUsers.get(to)!;
  console.log(
    `📤 Emitting call_accept to caller ${to} at socket ${callerSocketId}`
  );
  this.io.to(callerSocketId).emit("call_accept", {
    from: socket.userId,
    timestamp: new Date().toISOString(),
    callId: callSession.callId,
  });
}


  private async handleCallDecline(socket: any, data: any) {
    const { to, callId } = data;
    console.log(`❌ Processing call_decline from ${socket.userId} to ${to}`);

    const callSession =
      this.activeCalls.get(callId) ||
      Array.from(this.activeCalls.values()).find(
        (call) =>
          (call.caller === to && call.callee === socket.userId) ||
          (call.caller === socket.userId && call.callee === to)
      );

    if (callSession) {
      callSession.status = "ended";
      callSession.endTime = new Date();

      // Send "call declined" message (user manually declined)
      const conversation = await Conversation.findOne({
        participants: {
          $all: [callSession.caller, callSession.callee],
          $size: 2,
        },
        type: "direct",
      });

      if (conversation) {
        await this.sendCallMessage(
          conversation._id.toString(),
          `${callSession.isVideo ? "Video" : "Voice"} call declined`,
          socket.userId,
          "declined"
        );
      }

      setTimeout(() => {
        this.activeCalls.delete(callSession.callId);
      }, 5000);
    }

    if (this.onlineUsers.has(to)) {
      this.io.to(this.onlineUsers.get(to)!).emit("call_decline", {
        from: socket.userId,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleCallEnd(socket: any, data: any) {
    const { to, callId } = data;
    console.log(`🔚 Processing call_end from ${socket.userId} to ${to}`);

    const callSession =
      this.activeCalls.get(callId) ||
      Array.from(this.activeCalls.values()).find(
        (call) =>
          (call.caller === socket.userId && call.callee === to) ||
          (call.caller === to && call.callee === socket.userId)
      );

    if (callSession) {
      callSession.status = "ended";
      callSession.endTime = new Date();

      const conversation = await Conversation.findOne({
        participants: {
          $all: [callSession.caller, callSession.callee],
          $size: 2,
        },
        type: "direct",
      });

      if (conversation) {
        const duration = callSession.startTime
          ? Math.floor(
              (callSession.endTime.getTime() -
                callSession.startTime.getTime()) /
                1000
            )
          : 0;
        const content =
          duration > 0
            ? `${
                callSession.isVideo ? "Video" : "Voice"
              } call ended (${this.formatDuration(duration)})`
            : `${callSession.isVideo ? "Video" : "Voice"} call ended`;
        await this.sendCallMessage(
          conversation._id.toString(),
          content,
          socket.userId,
          "ended"
        );
      }

      if (callSession.startTime) {
        const duration =
          callSession.endTime.getTime() - callSession.startTime.getTime();
        console.log(`Call ${callSession.callId} duration: ${duration}ms`);
      }

      setTimeout(() => {
        this.activeCalls.delete(callSession.callId);
      }, 5000);
    }

    if (this.onlineUsers.has(to)) {
      this.io.to(this.onlineUsers.get(to)!).emit("call_end", {
        from: socket.userId,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleCallTimeout(socket: any, data: any) {
    const { callId, to } = data;
    console.log(`⏰ Received call_timeout for callId ${callId}`);

    const callSession = this.activeCalls.get(callId);

    if (
      callSession &&
      (callSession.status === "calling" || callSession.status === "ringing")
    ) {
      callSession.status = "ended";
      callSession.endTime = new Date();

      const conversation = await Conversation.findOne({
        participants: {
          $all: [callSession.caller, callSession.callee],
          $size: 2,
        },
        type: "direct",
      });

      if (conversation) {
        await this.sendCallMessage(
          conversation._id.toString(),
          `Missed ${callSession.isVideo ? "video" : "voice"} call`,
          callSession.caller,
          "missed" 
        );
      }

      if (this.onlineUsers.has(callSession.callee)) {
        this.io
          .to(this.onlineUsers.get(callSession.callee)!)
          .emit("call_timeout", {
            callId,
            timestamp: new Date().toISOString(),
          });
      }

      setTimeout(() => {
        this.activeCalls.delete(callId);
      }, 5000);
    } else {
      console.log(`⚠️ Call ${callId} already in state: ${callSession?.status}`);
    }
  }

  private async handleCallFailed(socket: any, data: any) {
    const { callId } = data;
    console.log(`❌ Processing call_failed for callId ${callId}`);

    const callSession = this.activeCalls.get(callId);

    if (callSession) {
      callSession.status = "ended";
      callSession.endTime = new Date();

      const conversation = await Conversation.findOne({
        participants: {
          $all: [callSession.caller, callSession.callee],
          $size: 2,
        },
        type: "direct",
      });

      if (conversation) {
        await this.sendCallMessage(
          conversation._id.toString(),
          `${callSession.isVideo ? "Video" : "Voice"} call failed`,
          socket.userId,
          "failed"
        );
      }

      const otherUserId =
        callSession.caller === socket.userId
          ? callSession.callee
          : callSession.caller;

      if (this.onlineUsers.has(otherUserId)) {
        this.io.to(this.onlineUsers.get(otherUserId)!).emit("call_failed", {
          callId,
          timestamp: new Date().toISOString(),
        });
      }

      setTimeout(() => {
        this.activeCalls.delete(callId);
      }, 5000);
    }
  }

  public getActiveCalls() {
    return Array.from(this.activeCalls.values());
  }

  public getOnlineUsersCount() {
    return this.onlineUsers.size;
  }
}
