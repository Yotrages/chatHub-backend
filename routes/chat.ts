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
  fileUploader,
  forwardMessage,
  unpinMessage,
  pinMessage,
  starMessage,
  unstarMessage,
  getMessageInfo,
  sharePostToChat
} from '../controllers/chatController';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../config/cloudinary';
import multer from 'multer';

const router = express.Router();

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: (req, file) => {
    return {
      folder: "chat_uploads", 
      allowedFormats: ["jpeg", "png", "jpg", "gif", "webp", "svg", "mp4", "mp3", "pdf", "doc", "docx"], 
      resource_type: "auto",
    };
  },
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 5
  }
});

router.get('/conversations', authenticateToken, getConversations);
router.post('/conversations', authenticateToken, createConversation);
router.put('/conversations/:conversationId', authenticateToken, updateConversation);
router.delete('/conversations/:conversationId', authenticateToken, deleteConversation); 
router.get('/conversations/:conversationId/messages', authenticateToken, getMessages);
router.post('/conversations/:conversationId/messages', authenticateToken, sendMessage);
router.put('/messages/:messageId', authenticateToken, editMessage);
router.delete('/messages/:messageId', authenticateToken, deleteMessage);
router.post('/messages/:messageId/reactions', authenticateToken, addReaction); 
router.delete('/messages/:messageId/reactions/remove', authenticateToken, removeReaction); 
router.post('/conversations/:conversationId/read', authenticateToken, markMessagesAsRead); 
router.post('/upload', authenticateToken, upload.single('file'), fileUploader)
router.post('/conversations/:conversationId/messages/:messageId/pin', authenticateToken, pinMessage)
router.post('/conversations/:conversationId/messages/:messageId/unpin', authenticateToken, unpinMessage)
router.post('/messages/:messageId/forward', authenticateToken, forwardMessage)
router.post('/messages/:messageId/star', authenticateToken, starMessage)
router.post('/messages/:messageId/unstar', authenticateToken, unstarMessage)
router.get('/messages/:messageId/info', authenticateToken, getMessageInfo)


export default router;