import mongoose, { Schema, Document } from 'mongoose';

export interface IMemoryThread extends Document {
  participants: mongoose.Types.ObjectId[];
  keywords: string[];
  relatedPosts: mongoose.Types.ObjectId[];
  context: string;
  lastActivity: Date;
  relevanceScore: number;
  createdAt: Date;
}

const MemoryThreadSchema = new Schema({
  participants: [{
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  keywords: [{
    type: String,
    required: true
  }],
  relatedPosts: [{
    type: Schema.Types.ObjectId,
    ref: 'Post'
  }],
  context: {
    type: String,
    required: true
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  relevanceScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 1
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

MemoryThreadSchema.index({ participants: 1, keywords: 1 });
MemoryThreadSchema.index({ lastActivity: -1 });

export default mongoose.model<IMemoryThread>('MemoryThread', MemoryThreadSchema);
