import { Request, Response } from 'express';
import { FollowService } from '../services/followServices';
import { User } from '../Models/User';
import { HTTP_STATUS } from '../utils/constant';
import { UserSettings } from '../Models/userSettings';
import mongoose from 'mongoose';

export class FollowController {
  private static async areUsersBlocked(
    userId1: string,
    userId2: string
  ): Promise<boolean> {
    const [settings1, settings2] = await Promise.all([
      UserSettings.findOne({ userId: userId1 }),
      UserSettings.findOne({ userId: userId2 }),
    ]);

    const userId1Obj = new mongoose.Types.ObjectId(userId1);
    const userId2Obj = new mongoose.Types.ObjectId(userId2);

    return (
      settings1?.security.blockedUsers.some((id) => id.equals(userId2Obj)) ||
      settings2?.security.blockedUsers.some((id) => id.equals(userId1Obj)) ||
      false
    );
  }

  private static async shouldSendNotification(
    recipientId: string,
    notificationType: 'newFollower'
  ): Promise<boolean> {
    const recipientSettings = await UserSettings.findOne({ userId: recipientId });
    return recipientSettings?.notifications.inApp[notificationType] ?? true;
  }

  private static async canAccessProfile(
    viewerId: string | undefined,
    profileUserId: string
  ): Promise<{ allowed: boolean; reason?: string }> {
    const profileSettings = await UserSettings.findOne({ userId: profileUserId });

    if (!profileSettings) {
      return { allowed: true };
    }

    if (profileSettings.account.isDeactivated) {
      return { allowed: false, reason: "This account is deactivated" };
    }

    if (!viewerId) {
      return { allowed: false, reason: "This profile is private" };
    }

    const isBlocked = await this.areUsersBlocked(viewerId, profileUserId);
    if (isBlocked) {
      return { allowed: false, reason: "This profile is not accessible" };
    }

    return { allowed: true };
  }

  static async followUser(req: Request, res: Response) {
    try {
      const followerId = req.user?.userId;
      const { userId } = req.params;

      if (!followerId) {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "You are not authenticated" });
        return;
      }

      if (followerId === userId) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: "You cannot follow yourself" });
        return;
      }

      const followerSettings = await UserSettings.findOne({ userId: followerId });
      if (followerSettings?.account.isDeactivated) {
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: "Cannot follow users: Account is deactivated" });
        return;
      }

      const targetSettings = await UserSettings.findOne({ userId });
      if (targetSettings?.account.isDeactivated) {
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: "This account is deactivated" });
        return;
      }

      const isBlocked = await FollowController.areUsersBlocked(followerId, userId);
      if (isBlocked) {
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: "Cannot follow this user" });
        return;
      }

      const canAccess = await FollowController.canAccessProfile(followerId, userId);
      if (!canAccess.allowed) {
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: canAccess.reason || "Cannot follow this user" });
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
        res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "You are not authenticated" });
        return;
      }

      if (followerId === userId) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: "You cannot unfollow yourself" });
        return;
      }

      const followerSettings = await UserSettings.findOne({ userId: followerId });
      if (followerSettings?.account.isDeactivated) {
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: "Cannot unfollow users: Account is deactivated" });
        return;
      }

      await FollowService.unfollowUser(followerId, userId);

      res.json({
        success: true,
        message: 'Successfully unfollowed user'
      });
    } catch (error: any) {
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
      const viewerId = req.user?.userId;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const canAccess = await FollowController.canAccessProfile(viewerId, userId);
      if (!canAccess.allowed) {
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: canAccess.reason || "Cannot access this profile" });
        return;
      }

      const result = await FollowService.getFollowers(userId, page, limit);

      if (viewerId) {
        const viewerSettings = await UserSettings.findOne({ userId: viewerId });
        const blockedUsers = viewerSettings?.security.blockedUsers || [];

        result.followers = result.followers.filter((follower: any) => {
          const followerId = follower._id || follower.followerId?._id;
          return !blockedUsers.some((blockedId) => 
            blockedId.equals(followerId)
          );
        });

        result.total = result.followers.length;
      }

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
      const viewerId = req.user?.userId;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const canAccess = await FollowController.canAccessProfile(viewerId, userId);
      if (!canAccess.allowed) {
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: canAccess.reason || "Cannot access this profile" });
        return;
      }

      const result = await FollowService.getFollowing(userId, page, limit);

      if (viewerId) {
        const viewerSettings = await UserSettings.findOne({ userId: viewerId });
        const blockedUsers = viewerSettings?.security.blockedUsers || [];

        result.following = result.following.filter((following: any) => {
          const followingId = following._id || following.followingId?._id;
          return !blockedUsers.some((blockedId) => 
            blockedId.equals(followingId)
          );
        });

        result.total = result.following.length;
      }

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
        res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "You are not authenticated" });
        return;
      }

      const isBlocked = await FollowController.areUsersBlocked(followerId, userId);
      if (isBlocked) {
        res.json({
          success: true,
          data: { isFollowing: false }
        });
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
        res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "You are not authenticated" });
        return;
      }

      const userSettings = await UserSettings.findOne({ userId });
      if (userSettings?.account.isDeactivated) {
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: "Account is deactivated" });
        return;
      }

      const pendingRequests = await FollowService.getPendingFollowRequests(userId);

      const blockedUsers = userSettings?.security.blockedUsers || [];
      const filteredRequests = pendingRequests.filter((request: any) => {
        const requesterId = request.followerId?._id || request.followerId;
        return !blockedUsers.some((blockedId) => 
          blockedId.equals(requesterId)
        );
      });

      res.json({
        success: true,
        data: filteredRequests
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
        res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "You are not authenticated" });
        return;
      }

      const userSettings = await UserSettings.findOne({ userId });
      if (userSettings?.account.isDeactivated) {
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: "Cannot accept follow requests: Account is deactivated" });
        return;
      }

      const follow = await FollowService.acceptFollowRequest(followId, userId);

      const isBlocked = await FollowController.areUsersBlocked(
        userId,
        follow.followerId.toString()
      );
      if (isBlocked) {
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: "Cannot accept follow request from blocked user" });
        return;
      }     

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
        res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "You are not authenticated" });
        return;
      }

      const userSettings = await UserSettings.findOne({ userId });
      if (userSettings?.account.isDeactivated) {
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: "Cannot reject follow requests: Account is deactivated" });
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

  static async removeFollower(req: Request, res: Response) {
    try {
      const userId = req.user?.userId;
      const { followerId } = req.params;

      if (!userId) {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "You are not authenticated" });
        return;
      }

      const userSettings = await UserSettings.findOne({ userId });
      if (userSettings?.account.isDeactivated) {
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: "Cannot remove followers: Account is deactivated" });
        return;
      }

      await FollowService.unfollowUser(followerId, userId);

      res.json({
        success: true,
        message: 'Follower removed successfully'
      });
    } catch (error: any) {
      console.error('Error in removeFollower:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: error.message || 'Failed to remove follower'
      });
    }
  }
}