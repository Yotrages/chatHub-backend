import express from 'express';
import { register, login, getUsers } from '../controllers/authController';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';
import cloudinary from '../config/cloudinary.js';
import passport from 'passport';
import handleOAuthCallback from '../controllers/o-Auth.js';
import { authenticateToken } from '../middleware/authMiddleware';
const router = express.Router();

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    return {
      folder: 'avatar',
      allowedFormats: ['jpeg', 'png', 'jpg', 'gif', 'webp', 'svg', 'mp4'],
    };
  },
});

const upload = multer({ storage })


// Correct way to attach route handlers
router.post('/register', upload.single("avatar"),(req, res, next) => {
  register(req, res).catch(next);
});

router.post('/login', (req, res, next) => {
  login(req, res).catch(next);
});

router.get("/users", authenticateToken, getUsers)
// Google OAuth
router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/auth/google/callback', passport.authenticate('google', { session: false }), handleOAuthCallback);

// GitHub OAuth
router.get('/auth/github', passport.authenticate('github', { scope: ['user:email'] }));
router.get('/auth/github/callback', passport.authenticate('github', { session: false }), handleOAuthCallback);

export default router;