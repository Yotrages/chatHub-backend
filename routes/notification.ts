import express from 'express';
import { NotificationController } from '../controllers/notificationController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = express.Router();

// GET /api/notifications - Get user's notifications
router.get('/', authenticateToken, NotificationController.getNotifications);

// PUT /api/notifications/:notificationId/read - Mark notification as read
router.put('/:notificationId/read', authenticateToken, NotificationController.markAsRead);

// PUT /api/notifications/read-all - Mark all notifications as read
router.put('/read-all', authenticateToken, NotificationController.markAllAsRead);

// DELETE /api/notifications/:notificationId - Delete notification
router.delete('/:notificationId', authenticateToken, NotificationController.deleteNotification);

export default router;
