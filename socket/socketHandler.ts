import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { User } from '../Models/User';
import { Conversation } from '../Models/Conversation';
import { Message } from '../Models/Message';

declare module 'socket.io' {
  interface Socket {
    userId: string; 
  }
}

export class SocketHandler {
  private io: Server;
  private onlineUsers = new Map<string, string>(); 
  
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
      socket.on('join_conversation', (conversationId) => socket.join(conversationId));
      socket.on('leave_conversation', (conversationId) => socket.leave(conversationId));
      socket.on('typing', (data) => this.handleTyping(socket, data));
      socket.on('stop_typing', (data) => this.handleStopTyping(socket, data));
      socket.on('edit_message', (data) => this.handleEditMessage(socket, data)); // New
      socket.on('delete_message', (data) => this.handleDeleteMessage(socket, data)); // New
      socket.on('add_reaction', (data) => this.handleAddReaction(socket, data)); // New
      socket.on('remove_reaction', (data) => this.handleRemoveReaction(socket, data)); // New
      socket.on('mark_read', (data) => this.handleMarkRead(socket, data)); // New
      
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
  };
  
  private async joinUserConversations(socket: any) {
    try {
      const conversations = await Conversation.find({
        participants: socket.userId,
      });
      conversations.forEach((conv) => {
        socket.join(conv._id.toString());
      });
    } catch (error) {
      console.error('Error joining conversations:', error);
    }
  }
  
  private async handleSendMessage(socket: any, data: any) {
    try {
      const { conversationId, content, messageType = 'text', fileUrl, fileName } = data;
      
      const message = new Message({
        content,
        senderId: socket.userId,
        conversationId,
        messageType,
        fileUrl,
        fileName,
        timestamp: new Date(),
        isRead: false,
      });
      
      await message.save();
      await message.populate('senderId', 'username avatar');
      
      await Conversation.findByIdAndUpdate(conversationId, {
        lastMessage: message._id,
        updatedAt: new Date(),
      });
      
      // Broadcast to conversation participants
      this.io.to(conversationId).emit('new_message', message);
      
      socket.emit('message_sent', { messageId: message._id });
      
    } catch (error) {
      socket.emit('message_error', { error: 'Failed to send message' });
    }
  }

  private async handleEditMessage(socket: any, data: any) {
    try {
      const { messageId, content } = data;

      const message = await Message.findById(messageId);
      if (!message) {
        socket.emit('message_error', { error: 'Message not found' });
        return;
      }

      if (message.senderId.toString() !== socket.userId) {
        socket.emit('message_error', { error: 'Not authorized to edit this message' });
        return;
      }

      message.content = content;
      message.edited = true;
      message.editedAt = new Date();

      await message.save();
      await message.populate('senderId', 'username avatar');

      this.io.to(message.conversationId.toString()).emit('message_edited', message);
    } catch (error) {
      socket.emit('message_error', { error: 'Failed to edit message' });
    }
  }

  private async handleDeleteMessage(socket: any, data: any) {
    try {
      const { messageId } = data;

      const message = await Message.findById(messageId);
      if (!message) {
        socket.emit('message_error', { error: 'Message not found' });
        return;
      }

      if (message.senderId.toString() !== socket.userId) {
        socket.emit('message_error', { error: 'Not authorized to delete this message' });
        return;
      }

      await Message.deleteOne({ _id: messageId });
      this.io.to(message.conversationId.toString()).emit('message_deleted', { messageId });
    } catch (error) {
      socket.emit('message_error', { error: 'Failed to delete message' });
    }
  }

  private async handleAddReaction(socket: any, data: any) {
    try {
      const { messageId, emoji } = data;

      const message = await Message.findById(messageId);
      if (!message) {
        socket.emit('message_error', { error: 'Message not found' });
        return;
      }

      message.reactions = message.reactions?.filter(r => r.userId.toString() !== socket.userId) || [];
      message.reactions.push({ userId: socket.userId, emoji });

      await message.save();
      await message.populate('senderId', 'username avatar');

      this.io.to(message.conversationId.toString()).emit('reaction_added', message);
    } catch (error) {
      socket.emit('message_error', { error: 'Failed to add reaction' });
    }
  }

  private async handleRemoveReaction(socket: any, data: any) {
    try {
      const { messageId } = data;

      const message = await Message.findById(messageId);
      if (!message) {
        socket.emit('message_error', { error: 'Message not found' });
        return;
      }

      message.reactions = message.reactions?.filter(r => r.userId.toString() !== socket.userId) || [];

      await message.save();
      await message.populate('senderId', 'username avatar');

      this.io.to(message.conversationId.toString()).emit('reaction_removed', message);
    } catch (error) {
      socket.emit('message_error', { error: 'Failed to remove reaction' });
    }
  }

  private async handleMarkRead(socket: any, data: any) {
    try {
      const { conversationId } = data;

      await Message.updateMany(
        { conversationId, isRead: false, senderId: { $ne: socket.userId } },
        { isRead: true }
      );

      this.io.to(conversationId).emit('messages_read', { conversationId, userId: socket.userId });
    } catch (error) {
      socket.emit('message_error', { error: 'Failed to mark messages as read' });
    }
  }
  
  private handleTyping(socket: any, data: any) {
    const { conversationId } = data;
    socket.to(conversationId).emit('user_typing', {
      userId: socket.userId,
      conversationId,
    });
  }
  
  private handleStopTyping(socket: any, data: any) {
    const { conversationId } = data;
    socket.to(conversationId).emit('user_stop_typing', {
      userId: socket.userId,
      conversationId,
    });
  }
  
  private async updateUserOnlineStatus(userId: string, isOnline: boolean) {
    try {
      await User.findByIdAndUpdate(userId, {
        isOnline,
        lastSeen: new Date(),
      });
      
      this.io.emit('user_status_change', { userId, isOnline });
    } catch (error) {
      console.error('Error updating user status:', error);
    }
  }
}