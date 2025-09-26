import mongoose, { Schema } from "mongoose";
import { INotification } from "../types";

const notificationSchema = new Schema<INotification>({
  recipientId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  senderId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  type: {
    type: String,
    enum: [
      'follow',
      'like_post',
      'like_reel',
      'like_comment',
      'comment',
      'reply',
      'message',
      'mention',
      'tag'
    ],
    required: true,
  },
  message: {
    type: String,
    required: true,
    maxlength: [200, 'Notification message cannot exceed 200 characters'],
  },
  entityType: {
    type: String,
    enum: ['post', 'reel', 'comment', 'message', 'user'],
    required: true,
  },
  entityId: {
    type: Schema.Types.ObjectId,
    required: true,
  },
  isRead: {
    type: Boolean,
    default: false,
  },
  actionUrl: {
    type: String, 
  },
}, {
  timestamps: true,
});

notificationSchema.index({ recipientId: 1, isRead: 1 });
notificationSchema.index({ recipientId: 1, createdAt: -1 });
notificationSchema.index({ senderId: 1 });

export const Notification = mongoose.model<INotification>('Notification', notificationSchema);
