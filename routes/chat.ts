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
router.put('/conversations/:conversationId', authenticateToken, updateConversation);
router.delete('/conversations/:conversationId', authenticateToken, deleteConversation); 
router.get('/conversations/:conversationId/messages', authenticateToken, getMessages);
router.post('/messages', authenticateToken, sendMessage);
router.put('/messages/:messageId', authenticateToken, editMessage);
router.delete('/messages/:messageId', authenticateToken, deleteMessage);
router.post('/messages/:messageId/reactions', authenticateToken, addReaction); 
router.delete('/messages/:messageId/reactions', authenticateToken, removeReaction); 
router.post('/conversations/:conversationId/read', authenticateToken, markMessagesAsRead); 

export default router;