import express from 'express';
import { NotificationController } from '../controllers/notificationController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = express.Router();

router.get('/', authenticateToken, NotificationController.getNotifications);

router.put('/:notificationId/read', authenticateToken, NotificationController.markAsRead);

router.put('/read-all', authenticateToken, NotificationController.markAllAsRead);

router.delete('/:notificationId', authenticateToken, NotificationController.deleteNotification);

export default router;
