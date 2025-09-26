import express from 'express';
import { register, login, getUsers, getSingleUser, getUserPosts, getSavedPosts, getLikedPosts, updateUser, getUserReels, validateToken, getSuggestedUsers, updateOnlineStatus, getOnlineStatus } from '../controllers/authController';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';
import cloudinary from '../config/cloudinary.js';
import passport from 'passport';
import handleOAuthCallback from '../controllers/oAuthController.js';
import { authenticateToken } from '../middleware/authMiddleware';
const router = express.Router();

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    return {
      folder: file.fieldname === 'avatar' ? 'avatar' : 'cover',
      allowedFormats: ['jpeg', 'png', 'jpg', 'gif', 'webp', 'svg'],
    };
  },
});

const upload = multer({ storage })


router.post('/register', upload.single("avatar"),(req, res, next) => {
  register(req, res).catch(next);
});

router.post('/login', (req, res, next) => {
  login(req, res).catch(next);
});

router.get("/:userId/posts", getUserPosts);
router.get("/:userId/reels", getUserReels);

router.patch('/users/:id', authenticateToken, upload.fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'coverImage', maxCount: 1 }
]), updateUser);
router.post('/online-status', authenticateToken, updateOnlineStatus)
router.get('/status/:userId', authenticateToken, getOnlineStatus)
router.get('/suggested', authenticateToken, getSuggestedUsers)

router.get("/users", authenticateToken, getUsers)
router.get("/users/:id", getSingleUser)
router.get('/:userId/liked-posts', authenticateToken, getLikedPosts);
router.get('/:userId/saved-posts', authenticateToken, getSavedPosts);
// Google OAuth
router.get('/google', (req, res, next) => {
let stateString: string | undefined;
  
  if (req.query.state) {
    if (typeof req.query.state === 'string') {
      stateString = req.query.state;
    } else {
      const jsonString = JSON.stringify(req.query.state);
      stateString = Buffer.from(jsonString).toString('base64url');
    }
  }
  
  passport.authenticate('google', { 
    scope: ['profile', 'email'],
    ...(stateString && { state: stateString })
  })(req, res, next);
});
router.get('/google/callback', passport.authenticate('google', { session: false }), handleOAuthCallback);

// GitHub OAuth
router.get('/github', (req, res, next) => {
  let stateString: string | undefined;
  
  if (req.query.state) {
    if (typeof req.query.state === 'string') {
      stateString = req.query.state;
    } else {
      const jsonString = JSON.stringify(req.query.state);
      stateString = Buffer.from(jsonString).toString('base64url');
    }
  }
  
  passport.authenticate('github', {
    scope: ['user:email'],
    ...(stateString && { state: stateString })
  })(req, res, next);
});

router.get('/github/callback', passport.authenticate('github', { session: false }), handleOAuthCallback);
router.post('/refresh', validateToken);

export default router;