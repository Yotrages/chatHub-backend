// Updated Message model in backend
import mongoose, { Schema } from 'mongoose';
import { IMessage } from '../types';

const reactionSchema = new Schema({
  userId: {
          type: Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        emoji: {
          category: {
            type: String,
            required: true,
          },
          name: {
            type: String,
            required: true,
          },
        },
}, { timestamps: true });

const messageSchema = new Schema<IMessage>({
  conversationId: {
    type: Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
  },
  senderId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  content: {
    type: String,
    required: [true, 'Message content is required'],
    trim: true,
    maxlength: [1000, 'Message cannot exceed 1000 characters'],
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'file', 'audio', 'video', 'post'],
    default: 'text',
  },
  fileUrl: {
    type: String,
  },
  fileName: {
    type: String,
  },
  edited: {
    type: Boolean,
    default: false,
  },
  editedAt: {
    type: Date,
  },
  replyTo: {
    type: Schema.Types.ObjectId,
    ref: 'Message',
  },
  reactions: [reactionSchema],
  readBy: [{
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    readAt: {
      type: Date,
      default: Date.now,
    },
  }],
}, {
  timestamps: true,
});

messageSchema.index({ conversationId: 1, timestamp: -1 });
messageSchema.index({ senderId: 1 });

export const Message = mongoose.model<IMessage>('Message', messageSchema);