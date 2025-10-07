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
import { CallSession } from "../types";
declare module "socket.io" {
  interface Socket {
    userId: string;
    tokenExpiry: any
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
  private async sendCallMessage(conversationId: string, content: string, senderId: string, callStatus: string) {
    try {
      const message = new Message({
        content,
        senderId,
        conversationId,
        messageType: 'call',
        callStatus, 
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
      this.io.to(conversationId).emit("new_message", { message });
    } catch (error) {
      console.error("Error sending call message:", error);
    }
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
      socket.on("ice-candidate", (data) => this.handleIceCandidate(socket, data));
      socket.on("call_request", (data) => this.handleCallRequest(socket, data));
      socket.on("call_accept", (data) => this.handleCallAccept(socket, data));
      socket.on("call_decline", (data) => this.handleCallDecline(socket, data));
      socket.on("call_end", (data) => this.handleCallEnd(socket, data));
      socket.on("call_timeout", (data) => this.handleCallTimeout(socket, data));
      socket.on("call_failed", (data) => this.handleCallFailed(socket, data));
      socket.on("disconnect", async (reason) => {
        console.log("User disconnected:", socket.userId, "Reason:", reason);
       
        // Handle any active calls for a user
        await this.handleUserDisconnectCalls(socket.userId);
       
        const status = this.userStatusStore.get(socket.userId);
        if (status) {
          status.isOnline = false;
          this.userStatusStore.set(socket.userId, status);
          await this.updateUserOnlineStatus(socket.userId, false);
        }
        this.onlineUsers.delete(socket.userId);
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
  // Handle user disconnect and cleanup active calls
  private async handleUserDisconnectCalls(userId: string) {
    for (const [callId, callSession] of this.activeCalls.entries()) {
      if (callSession.caller === userId || callSession.callee === userId) {
        const otherUserId = callSession.caller === userId ? callSession.callee : callSession.caller;
        const otherSocket = this.onlineUsers.get(otherUserId);
       
        if (otherSocket) {
          this.io.to(otherSocket).emit("call_end", {
            from: userId,
            timestamp: new Date().toISOString(),
            reason: "disconnect"
          });
        }
       
        callSession.status = 'ended';
        callSession.endTime = new Date();
       
        console.log(`Call ${callId} ended due to user ${userId} disconnect`);
       
        const conversation = await Conversation.findOne({
          participants: { $all: [callSession.caller, callSession.callee], $size: 2 },
          type: 'direct'
        });
        if (conversation) {
          const duration = callSession.startTime
            ? Math.floor((callSession.endTime.getTime() - callSession.startTime.getTime()) / 1000)
            : 0;
          const content = duration > 0
            ? `${callSession.isVideo ? 'Video' : 'Voice'} call ended (${this.formatDuration(duration)})`
            : `${callSession.isVideo ? 'Video' : 'Voice'} call ended`;
          await this.sendCallMessage(conversation._id.toString(), content, userId, 'ended');
        }
       
        setTimeout(() => {
          this.activeCalls.delete(callId);
        }, 5000);
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
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error("No authentication token provided"));
      }
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
      const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);
    if (expiresIn < 300) { 
      console.warn(`Token expiring soon for user ${decoded.userId}`);
    }
      socket.userId = decoded.userId;
      const user = await User.findById(decoded.userId);
      if (!user) {
        return next(new Error("User not found"));
      }
      socket.tokenExpiry = decoded.exp;
      next();
    } catch (error) {
      console.error("Socket authentication error:", error);    
    if (error.name === "TokenExpiredError") {
      return next(new Error("TOKEN_EXPIRED"));
    }
    if (error.name === "JsonWebTokenError") {
      return next(new Error("INVALID_TOKEN"));
    }
      next(new Error("Authentication failed"));
    }
  };

  private monitorTokenExpiry() {
  setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    
    this.io.sockets.sockets.forEach((socket: any) => {
      if (socket.tokenExpiry && socket.tokenExpiry < now) {
        console.log(`Disconnecting user ${socket.userId} - token expired`);
        socket.emit("token_expired", { 
          message: "Your session has expired. Please login again." 
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
      if (message.messageType === 'call') {
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
      const userId = socket.userId
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
            {
              conversationId,
              senderId: { $ne: userId },
              "readBy.userId": { $ne: userId },
            },
            { $push: { readBy: { userId, readAt: new Date() } } }
          );
      this.io.to(conversationId).emit("messages_read", { conversationId, userId });
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
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  private async updateUserOnlineStatus(userId: string, online: boolean) {
    try {
      const user = await User.findById(userId);
      if (!user) return;
      const userSettings = await UserSettings.findOne({ userId });
      if (!userSettings || !userSettings.privacy.showOnlineStatus) {
        return; 
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
            if (
              online &&
              participantSettings.notifications.inApp.onlineStatus
            ) {
              const message = `${user.username || 'Someone'} is now online`;
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
      this.io.emit("user_status_change", { userId, online });
    } catch (error) {
      console.error("Error updating user status:", error);
    }
  }
  private handleOffer(socket: any, data: any) {
    const { sdp, to, isVideo } = data;
    console.log(`Offer from ${socket.userId} to ${to}`);
   
    if (this.onlineUsers.has(to)) {
      const callSession = Array.from(this.activeCalls.values())
        .find(call =>
          (call.caller === socket.userId && call.callee === to) ||
          (call.caller === to && call.callee === socket.userId)
        );
       
      if (callSession) {
        this.io.to(this.onlineUsers.get(to)!).emit("offer", {
          sdp,
          from: socket.userId,
          isVideo: callSession.isVideo,
          callId: callSession.callId
        });
      }
    } else {
      socket.emit("call_error", { error: "User not available" });
    }
  }
  private handleAnswer(socket: any, data: any) {
    const { sdp, to } = data;
    console.log(`Answer from ${socket.userId} to ${to}`);
   
    if (this.onlineUsers.has(to)) {
      const callSession = Array.from(this.activeCalls.values())
        .find(call =>
          (call.caller === to && call.callee === socket.userId) ||
          (call.caller === socket.userId && call.callee === to)
        );
       
      if (callSession) {
        callSession.status = 'connected';
        if (!callSession.startTime) {
          callSession.startTime = new Date();
        }
      }
     
      this.io.to(this.onlineUsers.get(to)!).emit("answer", {
        sdp,
        from: socket.userId
      });
    }
  }
  private handleIceCandidate(socket: any, data: any) {
    const { candidate, to } = data;
    console.log(`ICE candidate from ${socket.userId} to ${to}`);
   
    if (this.onlineUsers.has(to)) {
      this.io.to(this.onlineUsers.get(to)!).emit("ice-candidate", {
        candidate,
        from: socket.userId
      });
    }
  }
  private handleCallRequest(socket: any, data: any) {
    const { to, isVideo } = data;
    console.log(`Call request from ${socket.userId} to ${to}, isVideo: ${isVideo}`);
   
    if (!this.onlineUsers.has(to)) {
      socket.emit("call_error", { error: "User not available" });
      return;
    }
    const existingCall = Array.from(this.activeCalls.values())
      .find(call =>
        (call.caller === socket.userId && call.callee === to) ||
        (call.caller === to && call.callee === socket.userId)
      );
    if (existingCall && existingCall.status !== 'ended') {
      socket.emit("call_error", { error: "Call already in progress" });
      return;
    }
    const callId = `${socket.userId}-${to}-${Date.now()}`;
    const callSession: CallSession = {
      callId,
      caller: socket.userId,
      callee: to,
      isVideo,
      status: 'calling'
    };
   
    this.activeCalls.set(callId, callSession);
   
    this.io.to(this.onlineUsers.get(to)!).emit("call_request", {
      from: socket.userId,
      isVideo,
      timestamp: new Date().toISOString(),
      callId
    });
   
    setTimeout(async () => {
      const call = this.activeCalls.get(callId);
      if (call && call.status === 'calling') {
        call.status = 'ended';
        call.endTime = new Date();
       
        if (this.onlineUsers.has(socket.userId)) {
          this.io.to(this.onlineUsers.get(socket.userId)!).emit("call_timeout", {
            callId,
            timestamp: new Date().toISOString()
          });
        }
       
        const conversation = await Conversation.findOne({
          participants: { $all: [call.caller, call.callee], $size: 2 },
          type: 'direct'
        });
        if (conversation) {
          await this.sendCallMessage(
            conversation._id.toString(),
            `Missed ${call.isVideo ? 'video' : 'voice'} call`,
            call.caller,
            'missed'
          );
        }
       
        setTimeout(() => this.activeCalls.delete(callId), 5000);
      }
    }, 45000); 
  }
  private handleCallAccept(socket: any, data: any) {
    const { to } = data;
    console.log(`Call accept from ${socket.userId} to ${to}`);
   
    const callSession = Array.from(this.activeCalls.values())
      .find(call => call.caller === to && call.callee === socket.userId);
     
    if (!callSession) {
      socket.emit("call_error", { error: "No active call found" });
      return;
    }
   
    callSession.status = 'connected';
    callSession.startTime = new Date();
   
    if (this.onlineUsers.has(to)) {
      this.io.to(this.onlineUsers.get(to)!).emit("call_accept", {
        from: socket.userId,
        timestamp: new Date().toISOString(),
        callId: callSession.callId
      });
    }
  }
  private async handleCallDecline(socket: any, data: any) {
    const { to } = data;
    console.log(`Call decline from ${socket.userId} to ${to}`);
   
    const callSession = Array.from(this.activeCalls.values())
      .find(call =>
        (call.caller === to && call.callee === socket.userId) ||
        (call.caller === socket.userId && call.callee === to)
      );
     
    if (callSession) {
      callSession.status = 'ended';
      callSession.endTime = new Date();
     
      const conversation = await Conversation.findOne({
        participants: { $all: [callSession.caller, callSession.callee], $size: 2 },
        type: 'direct'
      });
      if (conversation) {
        await this.sendCallMessage(
          conversation._id.toString(),
          `${callSession.isVideo ? 'Video' : 'Voice'} call declined`,
          socket.userId,
          'declined'
        );
      }
     
      setTimeout(() => {
        this.activeCalls.delete(callSession.callId);
      }, 5000);
    }
   
    if (this.onlineUsers.has(to)) {
      this.io.to(this.onlineUsers.get(to)!).emit("call_decline", {
        from: socket.userId,
        timestamp: new Date().toISOString()
      });
    }
  }
  private async handleCallEnd(socket: any, data: any) {
    const { to } = data;
    console.log(`Call end from ${socket.userId} to ${to}`);
   
    const callSession = Array.from(this.activeCalls.values())
      .find(call =>
        (call.caller === socket.userId && call.callee === to) ||
        (call.caller === to && call.callee === socket.userId)
      );
     
    if (callSession) {
      callSession.status = 'ended';
      callSession.endTime = new Date();
     
      const conversation = await Conversation.findOne({
        participants: { $all: [callSession.caller, callSession.callee], $size: 2 },
        type: 'direct'
      });
      if (conversation) {
        const duration = callSession.startTime
          ? Math.floor((callSession.endTime.getTime() - callSession.startTime.getTime()) / 1000)
          : 0;
        const content = duration > 0
          ? `${callSession.isVideo ? 'Video' : 'Voice'} call ended (${this.formatDuration(duration)})`
          : `${callSession.isVideo ? 'Video' : 'Voice'} call ended`;
        await this.sendCallMessage(conversation._id.toString(), content, socket.userId, 'ended');
      }
     
      if (callSession.startTime) {
        const duration = callSession.endTime.getTime() - callSession.startTime.getTime();
        console.log(`Call ${callSession.callId} duration: ${duration}ms`);
      }
     
      setTimeout(() => {
        this.activeCalls.delete(callSession.callId);
      }, 5000);
    }
   
    if (this.onlineUsers.has(to)) {
      this.io.to(this.onlineUsers.get(to)!).emit("call_end", {
        from: socket.userId,
        timestamp: new Date().toISOString()
      });
    }
  }
  private async handleCallTimeout(socket: any, data: any) {
    const { callId } = data;
    console.log(`Call timeout for callId ${callId}`);
   
    const callSession = this.activeCalls.get(callId);
    if (callSession && callSession.status === 'calling') {
      callSession.status = 'ended';
      callSession.endTime = new Date();
     
      const conversation = await Conversation.findOne({
        participants: { $all: [callSession.caller, callSession.callee], $size: 2 },
        type: 'direct'
      });
      if (conversation) {
        await this.sendCallMessage(
          conversation._id.toString(),
          `Missed ${callSession.isVideo ? 'video' : 'voice'} call`,
          callSession.caller,
          'missed'
        );
      }
     
      setTimeout(() => {
        this.activeCalls.delete(callId);
      }, 5000);
    }
   
    if (callSession && this.onlineUsers.has(callSession.callee)) {
      this.io.to(this.onlineUsers.get(callSession.callee)!).emit("call_timeout", {
        callId,
        timestamp: new Date().toISOString()
      });
    }
  }
  private async handleCallFailed(socket: any, data: any) {
    const { callId } = data;
    console.log(`Call failed for callId ${callId}`);
   
    const callSession = this.activeCalls.get(callId);
    if (callSession) {
      callSession.status = 'ended';
      callSession.endTime = new Date();
     
      const conversation = await Conversation.findOne({
        participants: { $all: [callSession.caller, callSession.callee], $size: 2 },
        type: 'direct'
      });
      if (conversation) {
        await this.sendCallMessage(
          conversation._id.toString(),
          `${callSession.isVideo ? 'Video' : 'Voice'} call failed`,
          socket.userId,
          'failed'
        );
      }
     
      setTimeout(() => {
        this.activeCalls.delete(callId);
      }, 5000);
    }
   
    if (callSession && this.onlineUsers.has(callSession.callee)) {
      this.io.to(this.onlineUsers.get(callSession.callee)!).emit("call_failed", {
        callId,
        timestamp: new Date().toISOString()
      });
    }
  }
  public getActiveCalls() {
    return Array.from(this.activeCalls.values());
  }
 
  public getOnlineUsersCount() {
    return this.onlineUsers.size;
  }
}