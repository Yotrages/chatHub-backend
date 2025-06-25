// File: src/backend/routes/chatRoutes.ts
import express from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import {
  getConversations,
  createConversation,
  getMessages,
  sendMessage,
  updateConversation,
  deleteConversation,
  markMessagesAsRead,
  editMessage,
  deleteMessage,
  addReaction,
  removeReaction,
} from '../controllers/chatController';

const router = express.Router();

router.get('/conversations', authenticateToken, getConversations);
router.post('/conversations', authenticateToken, createConversation);
router.put('/conversations/:conversationId', authenticateToken, updateConversation); // New: Update conversation details
router.delete('/conversations/:conversationId', authenticateToken, deleteConversation); // New: Delete/leave conversation
router.get('/conversations/:conversationId/messages', authenticateToken, getMessages);
router.post('/messages', authenticateToken, sendMessage);
router.put('/messages/:messageId', authenticateToken, editMessage); // New: Edit message
router.delete('/messages/:messageId', authenticateToken, deleteMessage); // New: Delete message
router.post('/messages/:messageId/reactions', authenticateToken, addReaction); // New: Add reaction
router.delete('/messages/:messageId/reactions', authenticateToken, removeReaction); // New: Remove reaction
router.post('/conversations/:conversationId/read', authenticateToken, markMessagesAsRead); // New: Mark messages as read

export default router;