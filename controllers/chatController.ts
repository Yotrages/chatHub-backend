import {  Response } from 'express';
import { Conversation } from '../Models/Conversation';
import { Message } from '../Models/Message';
import { AuthRequest } from '../types';

// Get all conversations for a user
export const getConversations = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Fix: Use userId instead of id (matching your auth middleware)
    const userId = req.user?.userId;
    
    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }
    
    const conversations = await Conversation.find({
      participants: userId
    })
    .populate('participants', 'username avatar online')
    .populate('lastMessage')
    .sort({ updatedAt: -1 });
    
    res.json(conversations);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

// Create new conversation
export const createConversation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { participantIds, type, name } = req.body;
    // Fix: Use userId instead of id
    const userId = req.user?.userId;
    
    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }
    
    // Add current user to participants
    const allParticipants = [...participantIds, userId];
    
    // For direct messages, check if conversation already exists
    if (type === 'direct' && allParticipants.length === 2) {
      const existing = await Conversation.findOne({
        type: 'direct',
        participants: { $all: allParticipants, $size: 2 }
      });
      
      if (existing) {
        res.json(existing);
        return;
      }
    }
    
    const conversation = new Conversation({
      type,
      name,
      participants: allParticipants,
    });
    
    await conversation.save();
    await conversation.populate('participants', 'username avatar online');
    
    res.status(201).json(conversation);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

// Get messages for a conversation
export const getMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    
    const messages = await Message.find({ conversationId })
      .populate('senderId', 'username avatar')
      .sort({ timestamp: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));
    
    res.json(messages.reverse());
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

// Send message
export const sendMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { conversationId, content, messageType = 'text' } = req.body;
    // Fix: Use userId instead of id
    const senderId = req.user?.userId;
    
    if (!senderId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }
    
    const message = new Message({
      content,
      senderId,
      conversationId,
      messageType,
      isRead: false
    });
    
    await message.save();
    await message.populate('senderId', 'username avatar');
    
    // Update conversation's last message
    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessage: message._id,
    });
    
    res.status(201).json(message);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

export const updateConversation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { conversationId } = req.params;
    const { name, participants, description } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    // Check if user is authorized (participant or admin for group chats)
    if (!conversation.participants.includes(userId) || 
        (conversation.type === 'group' && !conversation.admins?.includes(userId))) {
      res.status(403).json({ error: 'Not authorized to update this conversation' });
      return;
    }

    if (name) conversation.name = name;
    if (description) conversation.description = description;
    if (participants) {
      conversation.participants = [...new Set([...conversation.participants, ...participants])];
    }

    await conversation.save();
    await conversation.populate('participants', 'username avatar online');
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

// Delete or leave conversation
export const deleteConversation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { conversationId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    if (!conversation.participants.includes(userId)) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    if (conversation.type === 'group') {
      // Remove user from participants
      conversation.participants = conversation.participants.filter(p => p !== userId);
      if (conversation.admins?.includes(userId)) {
        conversation.admins = conversation.admins.filter(a => a !== userId);
      }

      if (conversation.participants.length === 0) {
        await Conversation.deleteOne({ _id: conversationId });
      } else {
        await conversation.save();
      }
    } else {
      // Delete direct chats completely
      await Conversation.deleteOne({ _id: conversationId });
    }

    res.json({ message: 'Conversation deleted or left successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

// Mark messages as read
export const markMessagesAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { conversationId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    await Message.updateMany(
      { conversationId, isRead: false, senderId: { $ne: userId } },
      { isRead: true }
    );

    res.json({ message: 'Messages marked as read' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

// Edit message
export const editMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { messageId } = req.params;
    const { content } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const message = await Message.findById(messageId);
    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    if (message.senderId.toString() !== userId) {
      res.status(403).json({ error: 'Not authorized to edit this message' });
      return;
    }

    message.content = content;
    message.edited = true;
    message.editedAt = new Date();

    await message.save();
    await message.populate('senderId', 'username avatar');
    res.json(message);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

// Delete message
export const deleteMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { messageId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const message = await Message.findById(messageId);
    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    if (message.senderId.toString() !== userId) {
      res.status(403).json({ error: 'Not authorized to delete this message' });
      return;
    }

    await Message.deleteOne({ _id: messageId });
    res.json({ message: 'Message deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

// Add reaction to message
export const addReaction = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const message = await Message.findById(messageId);
    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    // Remove existing reaction from this user
    message.reactions = message.reactions?.filter(r => r.userId.toString() !== userId) || [];
    message.reactions.push({ userId, emoji });

    await message.save();
    await message.populate('senderId', 'username avatar');
    res.json(message);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

// Remove reaction from message
export const removeReaction = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { messageId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const message = await Message.findById(messageId);
    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    message.reactions = message.reactions?.filter(r => r.userId.toString() !== userId) || [];

    await message.save();
    await message.populate('senderId', 'username avatar');
    res.json(message);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};
