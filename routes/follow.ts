// routes/follows.ts
import express from 'express';
import { FollowController } from '../controllers/follow';
import { authenticateToken } from '../middleware/authMiddleware'; // Your auth middleware

const router = express.Router();

// POST /api/follows/:userId - Follow a user
router.post('/:userId', authenticateToken, FollowController.followUser);

// DELETE /api/follows/:userId - Unfollow a user
router.delete('/:userId', authenticateToken, FollowController.unfollowUser);

// GET /api/follows/:userId/followers - Get user's followers
router.get('/:userId/followers', authenticateToken, FollowController.getFollowers);

// GET /api/follows/:userId/following - Get user's following
router.get('/:userId/following', authenticateToken, FollowController.getFollowing);

// GET /api/follows/:userId/status - Check if current user is following this user
router.get('/:userId/status', authenticateToken, FollowController.isFollowing);

// GET /api/follows/requests/pending - Get pending follow requests
router.get('/requests/pending', authenticateToken, FollowController.getPendingRequests);

// PUT /api/follows/requests/:followId/accept - Accept follow request
router.put('/requests/accept', authenticateToken, FollowController.acceptFollowRequest);

// PUT /api/follows/requests/:followId/reject - Reject follow request
router.put('/requests/reject', authenticateToken, FollowController.rejectFollowRequest);

export default router;
