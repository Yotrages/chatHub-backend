import { Request, Response } from 'express';
import { FollowService } from '../services/followServices';
import { User } from '../Models/User';
import { NotificationService } from '../services/notificationServices';
import { HTTP_STATUS } from '../utils/constant';

export class FollowController {
  static async followUser(req: Request, res: Response) {
    try {
      const followerId = req.user?.userId;
      const { userId } = req.params;

        if (!followerId) {
        res.status(HTTP_STATUS.FORBIDDEN).json({error: "You are not authenticated"})
        return;
      }

      const follow = await FollowService.followUser(followerId, userId);
      
      res.json({
        success: true,
        data: follow,
        message: 'Successfully followed user'
      });
    } catch (error: any) {
      console.error('Error in followUser:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: error.message || 'Failed to follow user'
      });
    }
  }

  static async unfollowUser(req: Request, res: Response) {
    try {
      const followerId = req.user?.userId;
      const { userId } = req.params;

        if (!followerId) {
        res.status(HTTP_STATUS.FORBIDDEN).json({error: "You are not authenticated"})
        return;
      }

      await FollowService.unfollowUser(followerId, userId);
      
      res.json({
        success: true,
        message: 'Successfully unfollowed user'
      });
    } catch (error : any) {
      console.error('Error in unfollowUser:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: error.message || 'Failed to unfollow user'
      });
    }
  }

  static async getFollowers(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const result = await FollowService.getFollowers(userId, page, limit);
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Error in getFollowers:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to fetch followers'
      });
    }
  }

  static async getFollowing(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const result = await FollowService.getFollowing(userId, page, limit);
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Error in getFollowing:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to fetch following'
      });
    }
  }

  static async isFollowing(req: Request, res: Response) {
    try {
      const followerId = req.user?.userId;
      const { userId } = req.params;

      if (!followerId) {
        res.status(HTTP_STATUS.FORBIDDEN).json({error: "You are not authenticated"})
        return;
      }

      const isFollowing = await FollowService.isFollowing(followerId, userId);
      
      res.json({
        success: true,
        data: { isFollowing }
      });
    } catch (error) {
      console.error('Error in isFollowing:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to check follow status'
      });
    }
  }

  static async getPendingRequests(req: Request, res: Response) {
    try {
      const userId = req.user?.userId;
        if (!userId) {
        res.status(HTTP_STATUS.FORBIDDEN).json({error: "You are not authenticated"})
        return;
      }
      const pendingRequests = await FollowService.getPendingFollowRequests(userId);
      
      res.json({
        success: true,
        data: pendingRequests
      });
    } catch (error) {
      console.error('Error in getPendingRequests:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to fetch pending requests'
      });
    }
  }

  static async acceptFollowRequest(req: Request, res: Response) {
    try {
      const userId = req.user?.userId;
      const { followId } = req.body;

      if (!userId) {
        res.status(HTTP_STATUS.FORBIDDEN).json({error: "You are not authenticated"});
        return;
      }

      const follow = await FollowService.acceptFollowRequest(followId, userId);

      // Notify the follower
      const recipient = await User.findById(follow.followerId).select('username name');
      await NotificationService.createNotification({
        recipientId: follow.followerId.toString(),
        senderId: userId,
        type: 'follow',
        message: `${recipient?.username || recipient?.name || 'Someone'} accepted your follow request`,
        entityType: 'user',
        entityId: userId,
        actionUrl: `/profile/${userId}`
      });

      res.json({
        success: true,
        data: follow,
        message: 'Follow request accepted'
      });
    } catch (error: any) {
      console.error('Error in acceptFollowRequest:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: error.message || 'Failed to accept follow request'
      });
    }
  }

  static async rejectFollowRequest(req: Request, res: Response) {
    try {
      const userId = req.user?.userId;
      const { followId } = req.body;

      if (!userId) {
        res.status(HTTP_STATUS.FORBIDDEN).json({error: "You are not authenticated"})
        return;
      }

      await FollowService.rejectFollowRequest(followId, userId);
      
      res.json({
        success: true,
        message: 'Follow request rejected'
      });
    } catch (error: any) {
      console.error('Error in rejectFollowRequest:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: error.message || 'Failed to reject follow request'
      });
    }
  }
}