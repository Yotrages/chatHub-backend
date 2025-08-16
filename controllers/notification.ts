import { Request, Response } from 'express';
import { NotificationService } from '../services/notificationServices';
import { HTTP_STATUS } from '../utils/constant';

export class NotificationController {
  static async getNotifications(req: Request, res: Response) {
    try {
      const userId = req.user?.userId;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

        if (!userId) {
        res.status(HTTP_STATUS.FORBIDDEN).json({error: "You are not authenticated"})
        return;
      }

      const result = await NotificationService.getNotifications(userId, page, limit);
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Error in getNotifications:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to fetch notifications'
      });
    }
  }

  static async markAsRead(req: Request, res: Response) {
    try {
      const userId = req.user?.userId;
      const { notificationId } = req.params;

        if (!userId) {
        res.status(HTTP_STATUS.FORBIDDEN).json({error: "You are not authenticated"})
        return;
      }

      const notification = await NotificationService.markAsRead(notificationId, userId);
      
      if (req.io) {
        req.io.emit('notification_read', notification._id)
      }

      res.json({
        success: true,
        data: notification
      });
    } catch (error) {
      console.error('Error in markAsRead:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to mark notification as read'
      });
    }
  }

  static async markAllAsRead(req: Request, res: Response) {
    try {
      const userId = req.user?.userId;

      if (!userId) {
        res.status(HTTP_STATUS.FORBIDDEN).json({error: "You are not authenticated"})
        return;
      }

      await NotificationService.markAllAsRead(userId);
      
      if (req.io) {
        req.io.emit('notification_all_read')
      }
      res.json({
        success: true,
        message: 'All notifications marked as read'
      });
    } catch (error) {
      console.error('Error in markAllAsRead:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to mark all notifications as read'
      });
    }
  }

  static async deleteNotification(req: Request, res: Response) {
    try {
      const userId = req.user?.userId;
      const { notificationId } = req.params;

        if (!userId) {
        res.status(HTTP_STATUS.FORBIDDEN).json({error: "You are not authenticated"})
        return;
      }

      await NotificationService.deleteNotification(notificationId, userId);
      
      res.json({
        success: true,
        message: 'Notification deleted successfully'
      });
    } catch (error) {
      console.error('Error in deleteNotification:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to delete notification'
      });
    }
  }
}

