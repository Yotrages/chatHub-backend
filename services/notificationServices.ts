import { Notification } from '../Models/Notifications';
import { INotification } from '../types';
import {Request} from 'express'

export class NotificationService {
  static async createNotification(data: {
    recipientId: string;
    senderId: string;
    type: INotification['type'];
    message: string;
    entityType: INotification['entityType'];
    entityId: string;
    actionUrl?: string;
  }, req?: Request): Promise<INotification> {
    try {
      if (data.recipientId === data.senderId) {
        throw new Error('Cannot create notification for self');
      }

      const notification = new Notification(data);
      await notification.save();
      
      await notification.populate('senderId', 'username avatar');

      if (req?.io) {
        req.io.emit('new_notification', notification)
      }
      
      return notification;
    } catch (error) {
      console.error('Error creating notification:', error);
      throw error;
    }
  }

  static async getNotifications(userId: string, page: number = 1, limit: number = 20) {
    try {
      const skip = (page - 1) * limit;
      
      const notifications = await Notification.find({ recipientId: userId })
        .populate('senderId', 'username name avatar')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const totalCount = await Notification.countDocuments({ recipientId: userId });
      const unreadCount = await Notification.countDocuments({ 
        recipientId: userId, 
        isRead: false 
      });

      return {
        notifications,
        totalCount,
        unreadCount,
        hasMore: totalCount > skip + notifications.length
      };
    } catch (error) {
      console.error('Error fetching notifications:', error);
      throw error;
    }
  }

  static async markAsRead(notificationId: string, userId: string) {
    try {
      const notification = await Notification.findOneAndUpdate(
        { _id: notificationId, recipientId: userId },
        { isRead: true },
        { new: true }
      );

      if (!notification) {
        throw new Error('Notification not found');
      }

      return notification;
    } catch (error) {
      console.error('Error marking notification as read:', error);
      throw error;
    }
  }

  static async markAllAsRead(userId: string) {
    try {
      await Notification.updateMany(
        { recipientId: userId, isRead: false },
        { isRead: true }
      );

      return { success: true };
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      throw error;
    }
  }

  static async deleteNotification(notificationId: string, userId: string) {
    try {
      const notification = await Notification.findOneAndDelete({
        _id: notificationId,
        recipientId: userId
      });

      if (!notification) {
        throw new Error('Notification not found');
      }

      return notification;
    } catch (error) {
      console.error('Error deleting notification:', error);
      throw error;
    }
  }
}
