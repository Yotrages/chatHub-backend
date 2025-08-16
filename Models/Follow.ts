import mongoose, { Schema } from 'mongoose';
import { IFollow } from '../types';

const followSchema = new Schema<IFollow>({
  followerId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  followingId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'blocked'],
    default: 'accepted', // For public profiles, auto-accept
  },
}, {
  timestamps: true,
});

// Prevent duplicate follows and self-follows
followSchema.index({ followerId: 1, followingId: 1 }, { unique: true });
followSchema.pre('save', function(next) {
  if (this.followerId.equals(this.followingId)) {
    return next(new Error('Users cannot follow themselves'));
  }
  next();
});

export const Follow = mongoose.model<IFollow>('Follow', followSchema);