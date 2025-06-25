import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { User } from '../Models/User';
import { Conversation } from '../Models/Conversation';
import { Message } from '../Models/Message';

declare module 'socket.io' {
  interface Socket {
    userId: string; // Make it non-optional if always present after auth
  }
}

export class SocketHandler {
  private io: Server;
  private onlineUsers = new Map<string, string>(); // userId -> socketId
  
  constructor(io: Server) {
    this.io = io;
    this.setupSocketHandlers();
  }
  
  private setupSocketHandlers() {
    this.io.use(this.authenticateSocket);
    
    this.io.on('connection', (socket) => {
      console.log('User connected:', socket.userId);
      
      // Track online users
      this.onlineUsers.set(socket.userId, socket.id);
      this.updateUserOnlineStatus(socket.userId, true);
      
      // Join user's conversations
      this.joinUserConversations(socket);
      
      // Handle real-time messaging
      socket.on('send_message', (data) => this.handleSendMessage(socket, data));
      socket.on('join_conversation', (conversationId) => {
        socket.join(conversationId);
      });
      socket.on('leave_conversation', (conversationId) => {
        socket.leave(conversationId);
      });
      socket.on('typing', (data) => this.handleTyping(socket, data));
      socket.on('stop_typing', (data) => this.handleStopTyping(socket, data));
      
      // Handle disconnection
      socket.on('disconnect', () => {
        console.log('User disconnected:', socket.userId);
        this.onlineUsers.delete(socket.userId);
        this.updateUserOnlineStatus(socket.userId, false);
      });
    });
  }
  
  private authenticateSocket = async (socket: any, next: any) => {
    try {
      const token = socket.handshake.auth.token;
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
      socket.userId = decoded.userId;
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  }
  
  private async joinUserConversations(socket: any) {
    try {
      const conversations = await Conversation.find({
        participants: socket.userId
      });
      
      conversations.forEach(conv => {
        socket.join(conv._id.toString());
      });
    } catch (error) {
      console.error('Error joining conversations:', error);
    }
  }
  
  private async handleSendMessage(socket: any, data: any) {
    try {
      const { conversationId, content, messageType = 'text' } = data;
      
      // Save message to database
      const message = new Message({
        content,
        senderId: socket.userId,
        conversationId,
        messageType,
        timestamp: new Date(),
        isRead: false
      });
      
      await message.save();
      await message.populate('senderId', 'username avatar');
      
      // Update conversation
      await Conversation.findByIdAndUpdate(conversationId, {
        lastMessage: message._id,
        updatedAt: new Date()
      });
      
      // Broadcast to conversation participants
      this.io.to(conversationId).emit('new_message', message);
      
      // Send delivery confirmation to sender
      socket.emit('message_sent', { messageId: message._id });
      
    } catch (error) {
      socket.emit('message_error', { error: 'Failed to send message' });
    }
  }
  
  private handleTyping(socket: any, data: any) {
    const { conversationId } = data;
    socket.to(conversationId).emit('user_typing', {
      userId: socket.userId,
      conversationId
    });
  }
  
  private handleStopTyping(socket: any, data: any) {
    const { conversationId } = data;
    socket.to(conversationId).emit('user_stop_typing', {
      userId: socket.userId,
      conversationId
    });
  }
  
  private async updateUserOnlineStatus(userId: string, isOnline: boolean) {
    try {
      await User.findByIdAndUpdate(userId, {
        isOnline,
        lastSeen: new Date()
      });
      
      // Broadcast online status to relevant users
      this.io.emit('user_status_change', { userId, isOnline });
    } catch (error) {
      console.error('Error updating user status:', error);
    }
  }
}