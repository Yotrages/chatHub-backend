import mongoose, { Schema } from 'mongoose';
import { IConversation } from '../types';

const conversationSchema = new Schema<IConversation>({
  type: {
    type: String,
    enum: ['direct', 'group'],
    required: true,
  },
  name: {
    type: String,
    trim: true,
    maxlength: [50, 'Conversation name cannot exceed 50 characters'],
  },
  description: {
    type: String,
    trim: true,
    maxlength: [200, 'Description cannot exceed 200 characters'],
  },
  participants: [{
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  }],
  admins: [{
    type: Schema.Types.ObjectId,
    ref: 'User',
  }],
  lastMessage: {
    type: Schema.Types.ObjectId,
    ref: 'Message',
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  isPinned: { 
    type: Boolean,
    default: false,
  },
  isMuted: { 
    type: Boolean,
    default: false,
  },
  isArchived: { 
    type: Boolean,
    default: false,
  },
  avatar: { 
    type: String,
    default: null,
  },
}, {
  timestamps: true,
});

conversationSchema.index({ participants: 1 });
conversationSchema.index({ type: 1 });
conversationSchema.index({ updatedAt: -1 });

export const Conversation = mongoose.model<IConversation>('Conversation', conversationSchema);