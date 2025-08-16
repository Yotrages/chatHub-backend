// routes/settings.ts
import express, { Request, Response } from 'express';
import { UserSettings, Report } from '../Models/userSettings';
import { authenticateToken } from '../middleware/authMiddleware';
import { body, validationResult } from 'express-validator';
import multer from 'multer';
import path from 'path';
import { User } from '../Models/User';
import { HTTP_STATUS } from '../utils/constant';
import { schemas, validate } from '../middleware/validation';
import { Post } from '../Models/Post';

const router = express.Router();

// Configure multer for background image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/backgrounds/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// GET /api/settings - Get user settings
router.get('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    let settings = await UserSettings.findOne({ userId: req.user?.userId });
    
    if (!settings) {
      // Create default settings
      settings = new UserSettings({ userId: req.user?.userId });
      await settings.save();
    }
    
    res.json(settings);
  } catch (error) {
    console.error(error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ message: 'Server error' });
  }
});

// PUT /api/settings/privacy - Update privacy settings
router.put('/privacy', [
  authenticateToken,
  body('profileVisibility').optional().isIn(['public', 'friends', 'private']),
  body('allowMessagesFrom').optional().isIn(['everyone', 'friends', 'none']),
  body('showOnlineStatus').optional().isBoolean(),
  body('allowTagging').optional().isBoolean(),
  body('showEmail').optional().isBoolean(),
  body('showPhoneNumber').optional().isBoolean()
], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
   res.status(HTTP_STATUS.BAD_REQUEST).json({ errors: errors.array() });
   return;
  }
  
  try {
    const settings = await UserSettings.findOneAndUpdate(
      { userId: req.user?.userId },
      { $set: { privacy: req.body } },
      { new: true, upsert: true }
    );

    const userPrivacy = settings.privacy.profileVisibility

    const user = await User.findById(req.user?.userId)

  
    if (user && userPrivacy === "private") {
      user.isPrivate = true
      await user.save()
    }
    
    res.json(settings);
  } catch (error) {
    console.error(error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ message: 'Server error' });
  }
});

// PUT /api/settings/notifications - Update notification settings
router.put('/notifications', [
  authenticateToken,
  body('email').optional().isObject(),
  body('push').optional().isObject(),
  body('inApp').optional().isObject()
], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
   res.status(HTTP_STATUS.BAD_REQUEST).json({ errors: errors.array() });
   return;
  }
  
  try {
    const settings = await UserSettings.findOneAndUpdate(
      { userId: req.user?.userId },
      { $set: { notifications: req.body } },
      { new: true, upsert: true }
    );
    
    res.json(settings);
  } catch (error) {
    console.error(error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ message: 'Server error' });
  }
});

// PUT /api/settings/appearance - Update appearance settings
router.put('/appearance', [
  authenticateToken,
  body('theme').optional().isIn(['light', 'dark', 'auto']),
  body('language').optional().isString(),
  body('fontSize').optional().isIn(['small', 'medium', 'large']),
  body('accentColor').optional().isString()
], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
     res.status(HTTP_STATUS.BAD_REQUEST).json({ errors: errors.array() });
     return;
  }
  
  try {
    const settings = await UserSettings.findOneAndUpdate(
      { userId: req.user?.userId },
      { $set: { appearance: req.body } },
      { new: true, upsert: true }
    );
    
    res.json(settings);
  } catch (error) {
    console.error(error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ message: 'Server error' });
  }
});

// POST /api/settings/background - Upload background image
router.post('/background', [authenticateToken, upload.single('background')], async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'No file uploaded' });
      return;
    }
    
    const backgroundImage = `/uploads/backgrounds/${req.file.filename}`;
    
    const settings = await UserSettings.findOneAndUpdate(
      { userId: req.user?.userId },
      { $set: { 'appearance.backgroundImage': backgroundImage } },
      { new: true, upsert: true }
    );
    
    res.json({ backgroundImage, settings });
  } catch (error) {
    console.error(error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ message: 'Server error' });
  }
});

// PUT /api/settings/security - Update security settings
router.put('/security', [
  authenticateToken,
  body('twoFactorAuth').optional().isBoolean(),
  body('loginAlerts').optional().isBoolean(),
  body('sessionTimeout').optional().isInt({ min: 15, max: 1440 })
], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
   res.status(HTTP_STATUS.BAD_REQUEST).json({ errors: errors.array() });
   return;
  }
  
  try {
    const settings = await UserSettings.findOneAndUpdate(
      { userId: req.user?.userId },
      { $set: { security: { ...req.body } } },
      { new: true, upsert: true }
    );
    
    res.json(settings);
  } catch (error) {
    console.error(error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ message: 'Server error' });
  }
});

// POST /api/settings/block-user - Block a user
router.post('/block-user', [
  authenticateToken,
  body('userId').isString().notEmpty()
], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
   res.status(HTTP_STATUS.BAD_REQUEST).json({ errors: errors.array() });
   return;
  }
  
  try {
    const { userId } = req.body;
    
    const settings = await UserSettings.findOneAndUpdate(
      { userId: req.user?.userId },
      { $addToSet: { 'security.blockedUsers': userId } },
      { new: true, upsert: true }
    );
    
    res.json(settings);
  } catch (error) {
    console.error(error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ message: 'Server error' });
  }
});

// DELETE /api/settings/unblock-user/:userId - Unblock a user
router.delete('/unblock-user/:userId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    
    const settings = await UserSettings.findOneAndUpdate(
      { userId: req.user?.userId },
      { $pull: { 'security.blockedUsers': userId } },
      { new: true }
    );
    
    res.json(settings);
  } catch (error) {
    console.error(error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ message: 'Server error' });
  }
});

// PUT /api/settings/content - Update content settings
router.put('/content', [
  authenticateToken,
  body('autoPlayVideos').optional().isBoolean(),
  body('showSensitiveContent').optional().isBoolean(),
  body('contentLanguages').optional().isArray(),
  body('blockedKeywords').optional().isArray()
], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
     res.status(HTTP_STATUS.BAD_REQUEST).json({ errors: errors.array() });
     return;
  }
  
  try {
    const settings = await UserSettings.findOneAndUpdate(
      { userId: req.user?.userId },
      { $set: { content: req.body } },
      { new: true, upsert: true }
    );
    
    res.json(settings);
  } catch (error) {
    console.error(error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ message: 'Server error' });
  }
});

// POST /api/settings/deactivate - Deactivate account
router.post('/deactivate', authenticateToken, async (req: Request, res: Response) => {
  try {
    const settings = await UserSettings.findOneAndUpdate(
      { userId: req.user?.userId },
      { 
        $set: { 
          'account.isDeactivated': true,
          'account.deactivatedAt': new Date()
        }
      },
      { new: true, upsert: true }
    );
    
    res.json({ message: 'Account deactivated successfully', settings });
  } catch (error) {
    console.error(error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ message: 'Server error' });
  }
});

// POST /api/settings/reactivate - Reactivate account
router.post('/reactivate', authenticateToken, async (req: Request, res: Response) => {
  try {
    const settings = await UserSettings.findOneAndUpdate(
      { userId: req.user?.userId },
      { 
        $set: { 
          'account.isDeactivated': false
        },
        $unset: {
          'account.deactivatedAt': '',
          'account.deleteScheduledAt': ''
        }
      },
      { new: true, upsert: true }
    );
    
    res.json({ message: 'Account reactivated successfully', settings });
  } catch (error) {
    console.error(error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ message: 'Server error' });
  }
});

// POST /api/settings/schedule-delete - Schedule account deletion
router.post('/schedule-delete', authenticateToken, async (req: Request, res: Response) => {
  try {
    const deleteDate = new Date();
    deleteDate.setDate(deleteDate.getDate() + 30); // 30 days from now
    
    const settings = await UserSettings.findOneAndUpdate(
      { userId: req.user?.userId },
      { 
        $set: { 
          'account.deleteScheduledAt': deleteDate
        }
      },
      { new: true, upsert: true }
    );
    
    res.json({ message: 'Account deletion scheduled', deleteDate, settings });
  } catch (error) {
    console.error(error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ message: 'Server error' });
  }
});

// POST /api/settings/request-data - Request data download
router.post('/request-data', authenticateToken, async (req: Request, res: Response) => {
  try {
    const settings = await UserSettings.findOneAndUpdate(
      { userId: req.user?.userId },
      { 
        $push: { 
          'account.dataDownloadRequests': {
            requestedAt: new Date(),
            status: 'pending'
          }
        }
      },
      { new: true, upsert: true }
    );
    
    // Here you would typically trigger a background job to generate the data export
    
    res.json({ message: 'Data download request submitted', settings });
  } catch (error) {
    console.error(error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ message: 'Server error' });
  }
});

// POST /api/settings/report - Submit a report
router.post('/report', [
  authenticateToken,
  body('reportedUserId').optional().isString(),
  body('reportedPostId').optional().isString(),
  body('reportedCommentId').optional().isString(),
  body('reportType').isIn(['spam', 'harassment', 'inappropriate_content', 'fake_account', 'copyright', 'other']),
  body('description').isString().isLength({ min: 10, max: 1000 })
], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
   res.status(HTTP_STATUS.BAD_REQUEST).json({ errors: errors.array() });
   return;
  }
  
  try {
    const report = new Report({
      reporterId: req.user?.userId,
      ...req.body
    });
    
    await report.save();
    
    res.json({ message: 'Report submitted successfully', report });
  } catch (error) {
    console.error(error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ message: 'Server error' });
  }
});

// GET /api/settings/my-reports - Get user's reports
router.get('/my-reports', authenticateToken, async (req: Request, res: Response) => {
  try {
    const reports = await Report.find({ reporterId: req.user?.userId })
      .sort({ createdAt: -1 })
      .populate('reportedUserId', 'username avatar')
      .populate('reportedPostId', 'content createdAt')
      .populate('reportedCommentId', 'content createdAt parentCommentId');
    
    res.json(reports);
  } catch (error) {
    console.error(error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ message: 'Server error' });
  }
});

router.post('/block-post', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
  const { postId } = req.body
  const post = await Post.findById(postId)
  if (!post) {
    res.status(404).json({ error: "Post not found" })
  }
  await UserSettings.findOneAndUpdate({userId: userId}, { $push: { 'content.blockedPosts': postId}})
  res.status(HTTP_STATUS.OK).json({success: true, postId, message: "Post blocked successfully"})
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: "Internal Server Error" })
  }
})

export default router;