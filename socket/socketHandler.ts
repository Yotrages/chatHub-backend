import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { User } from "../Models/User";
import { Conversation } from "../Models/Conversation";
import { Message } from "../Models/Message";
import { Post } from "../Models/Post";
import mongoose, { Types } from "mongoose";
import { NotificationService } from "../services/notificationServices";
import { UserSettings } from "../Models/userSettings";
import { containsBlockedKeywords, isSensitiveContent } from "../utils/constant";

declare module "socket.io" {
  interface Socket {
    userId: string;
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
  private HEARTBEAT_INTERVAL = 30000; // 30 seconds
  private OFFLINE_TIMEOUT = 60000; // 60 seconds
  

  constructor(io: Server) {
    this.io = io;
    this.setupSocketHandlers();
    this.startHeartbeatCleanup();
  }

  private setupSocketHandlers() {
    this.io.use(this.authenticateSocket);

    this.io.on("connection", async (socket) => {
      console.log("User connected:", socket.userId);

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
      socket.on("heartbeat", () => {
        const status = this.userStatusStore.get(socket.userId);
        if (status) {
          status.lastActive = new Date();
          this.userStatusStore.set(socket.userId, status);
        }
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

      socket.on('user_online', (data: any) => this.userOnline(socket, data))
      socket.on('user_offline', (data: any) => this.userOffline(socket, data))

      socket.on("mark_all_notification", (data) => this.markAllAsRead(socket, data));
      // WebRTC Signaling
      socket.on("offer", (data) => this.handleOffer(socket, data));
      socket.on("answer", (data) => this.handleAnswer(socket, data));
      socket.on("ice-candidate", (data) =>
        this.handleIceCandidate(socket, data)
      );
      socket.on("call_request", (data) => this.handleCallRequest(socket, data));
      socket.on("call_accept", (data) => this.handleCallAccept(socket, data));
      socket.on("call_end", (data) => this.handleCallEnd(socket, data));

      socket.on("disconnect", async (reason) => {
        console.log("User disconnected:", socket.userId, "Reason:", reason);
        const status = this.userStatusStore.get(socket.userId);
        if (status) {
          status.isOnline = false;
          this.userStatusStore.set(socket.userId, status);
          await this.updateUserOnlineStatus(socket.userId, false);
        }
        this.io.emit("user_status_change", {
          userId: socket.userId,
          online: false,
        });
      });

      socket.on("error", (error) => {
        console.error("Socket error for user", socket.userId, ":", error);
      });
    });
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
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error("No authentication token provided"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
      socket.userId = decoded.userId;

      const user = await User.findById(decoded.userId);
      if (!user) {
        return next(new Error("User not found"));
      }

      next();
    } catch (error) {
      console.error("Socket authentication error:", error);
      next(new Error("Authentication failed"));
    }
  };

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
      const user = await User.findById(userId);
      if (!user) {
        socket.emit("error", { error: "User not found" });
        return;
      }

      const userSettings = await UserSettings.findOne({ userId });
      if (!userSettings) {
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
      socket.emit("online_success", { message: "User online status updated successfully" });
    } catch (err) {
      socket.emit("error", { error: err });
    }
  }

  private async userOffline(socket: Socket, data: any) {
    try {
      const userId = socket.userId;
      const user = await User.findById(userId);
      if (!user) {
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
      socket.emit("offline_success", { message: "User offline status updated successfully" });
    } catch (err) {
      socket.emit("error", { error: err });
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
        isRead: false,
        reactions: [],
        edited: false,
      });

      await message.save();
      await message.populate("senderId", "username avatar");
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

  private async handleAddReaction(socket: any, data: any) {
    try {
      const { messageId, emoji } = data;
      const message = await Message.findById(messageId);
      if (!message) {
        socket.emit("message_error", { error: "Message not found" });
        return;
      }

      message.reactions =
        message.reactions?.filter(
          (r) => r.userId.toString() !== socket.userId
        ) || [];
      message.reactions.push({ userId: socket.userId, emoji });
      await message.save();
      await message.populate("senderId", "username avatar");
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
        { conversationId, isRead: false, senderId: { $ne: userId } },
        { isRead: true }
      );
      this.io.to(conversationId).emit("mark_read", { conversationId, userId });
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

  private async updateUserOnlineStatus(userId: string, online: boolean) {
    try {
      const user = await User.findById(userId);
      if (!user) return;

      const userSettings = await UserSettings.findOne({ userId });
      if (!userSettings || !userSettings.privacy.showOnlineStatus) {
        return; // Don't broadcast if status is hidden
      }

      user.online = online;
      user.lastSeen = online ? null : new Date();
      await user.save();

      // Notify conversation participants
      const conversations = await Conversation.find({ participants: userId });
      for (const conv of conversations) {
        const participants = conv.participants.filter((p) => p.toString() !== userId);
        for (const participantId of participants) {
          const participantSettings = await UserSettings.findOne({ userId: participantId });
          if (
            participantSettings &&
            !participantSettings.security.blockedUsers.includes(new mongoose.Types.ObjectId(userId)) &&
            !userSettings.security.blockedUsers.includes(new mongoose.Types.ObjectId(participantId))
          ) {
            this.io.to(conv._id.toString()).emit(online ? "user_online" : "user_offline", { userId });

            // Send notification if enabled
            if (
              online &&
              participantSettings.notifications.inApp.onlineStatus
            ) {
              const message = `${user.username || user.name || 'Someone'} is now online`;
              if (
                !containsBlockedKeywords(message, participantSettings.content.blockedKeywords) &&
                (participantSettings.content.showSensitiveContent || !isSensitiveContent(message))
              ) {
                await NotificationService.createNotification({
                  recipientId: participantId.toString(),
                  senderId: userId,
                  type: "online_status",
                  message,
                  entityType: "user",
                  entityId: userId,
                  actionUrl: `/profile/${userId}`,
                });
              }
            }
          }
        }
      }

      // Broadcast to all (if not in a conversation)
      this.io.emit("user_status_change", { userId, online });
    } catch (error) {
      console.error("Error updating user status:", error);
    }
  }

  private handleOffer(socket: any, data: any) {
    const { sdp, to } = data;
    if (this.onlineUsers.has(to)) {
      this.io
        .to(this.onlineUsers.get(to)!)
        .emit("offer", { sdp, from: socket.userId });
    }
  }

  private handleAnswer(socket: any, data: any) {
    const { sdp, to } = data;
    if (this.onlineUsers.has(to)) {
      this.io
        .to(this.onlineUsers.get(to)!)
        .emit("answer", { sdp, from: socket.userId });
    }
  }

  private handleIceCandidate(socket: any, data: any) {
    const { candidate, to } = data;
    if (this.onlineUsers.has(to)) {
      this.io
        .to(this.onlineUsers.get(to)!)
        .emit("ice-candidate", { candidate, from: socket.userId });
    }
  }

  private handleCallRequest(socket: any, data: any) {
    const { to, isVideo } = data;
    if (this.onlineUsers.has(to)) {
      this.io.to(this.onlineUsers.get(to)!).emit("call_request", {
        from: socket.userId,
        isVideo,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private handleCallAccept(socket: any, data: any) {
    const { to } = data;
    if (this.onlineUsers.has(to)) {
      this.io.to(this.onlineUsers.get(to)!).emit("call_accept", {
        from: socket.userId,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private handleCallEnd(socket: any, data: any) {
    const { to } = data;
    if (this.onlineUsers.has(to)) {
      this.io.to(this.onlineUsers.get(to)!).emit("call_end", {
        from: socket.userId,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
