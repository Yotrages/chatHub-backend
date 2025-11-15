import { Follow } from "../Models/Follow";
import { User } from "../Models/User";
import { UserSettings } from "../Models/userSettings";
import { NotificationService } from "./notificationServices";
import { IFollow } from "../types";
import mongoose from "mongoose";

export class FollowService {
  private static async shouldSendNotification(
    recipientId: string,
    notificationType: 'newFollower'
  ): Promise<boolean> {
    const recipientSettings = await UserSettings.findOne({ userId: recipientId });
    return recipientSettings?.notifications.inApp[notificationType] ?? true;
  }

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

  static async followUser(
    followerId: string,
    followingId: string
  ): Promise<IFollow> {
    try {
      if (followerId === followingId) {
        throw new Error("Users cannot follow themselves");
      }

      const isBlocked = await this.areUsersBlocked(followerId, followingId);
      if (isBlocked) {
        throw new Error("Cannot follow this user");
      }

      const [followerSettings, followingSettings] = await Promise.all([
        UserSettings.findOne({ userId: followerId }),
        UserSettings.findOne({ userId: followingId }),
      ]);

      if (followerSettings?.account.isDeactivated) {
        throw new Error("Your account is deactivated");
      }

      if (followingSettings?.account.isDeactivated) {
        throw new Error("This account is deactivated");
      }

      const existingFollow = await Follow.findOne({ followerId, followingId });
      if (existingFollow) {
        throw new Error("Already following this user");
      }

      const userToFollow = await User.findById(followingId);
      if (!userToFollow) {
        throw new Error("User not found");
      }

      const follow = new Follow({
        followerId,
        followingId,
        status: userToFollow.isPrivate ? "pending" : "accepted",
      });

      await follow.save();

      if (follow.status === "accepted") {
        await Promise.all([
          User.findByIdAndUpdate(followerId, {
            $inc: { followingCount: 1 },
            $addToSet: { following: followingId },
          }),
          User.findByIdAndUpdate(followingId, {
            $inc: { followersCount: 1 },
            $addToSet: { followers: followerId },
          }),
        ]);

        const shouldNotify = await this.shouldSendNotification(
          followingId,
          'newFollower'
        );

        if (shouldNotify) {
          const follower = await User.findById(followerId).select('username');
          await NotificationService.createNotification({
            recipientId: followingId,
            senderId: followerId,
            type: "follow",
            message: `${follower?.username || "Someone"} started following you`,
            entityType: "user",
            entityId: followerId,
            actionUrl: `/profile/${followerId}`,
          });
        }
      } else {
        const shouldNotify = await this.shouldSendNotification(
          followingId,
          'newFollower'
        );

        if (shouldNotify) {
          const follower = await User.findById(followerId).select('username');
          await NotificationService.createNotification({
            recipientId: followingId,
            senderId: followerId,
            type: "follow",
            message: `${follower?.username || "Someone"} requested to follow you`,
            entityType: "user",
            entityId: followerId,
            actionUrl: `/profile/${followerId}`,
          });
        }
      }

      return follow;
    } catch (error) {
      console.error("Error following user:", error);
      throw error;
    }
  }

  static async unfollowUser(followerId: string, followingId: string) {
    try {
      const follow = await Follow.findOneAndDelete({ followerId, followingId });

      if (!follow) {
        throw new Error("Follow relationship not found");
      }

      if (follow.status === "accepted") {
        await Promise.all([
          User.findByIdAndUpdate(followerId, {
            $inc: { followingCount: -1 },
            $pull: { following: followingId },
          }),
          User.findByIdAndUpdate(followingId, {
            $inc: { followersCount: -1 },
            $pull: { followers: followerId },
          }),
        ]);
      }

      return { success: true };
    } catch (error) {
      console.error("Error unfollowing user:", error);
      throw error;
    }
  }

  static async getFollowers(
    userId: string,
    page: number = 1,
    limit: number = 20
  ) {
    try {
      const skip = (page - 1) * limit;

      const userSettings = await UserSettings.findOne({ userId });
      const blockedUsers = userSettings?.security.blockedUsers || [];

      const followers = await Follow.find({
        followingId: userId,
        status: "accepted",
        followerId: { $nin: blockedUsers },
      })
        .populate("followerId", "username avatar email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const totalCount = await Follow.countDocuments({
        followingId: userId,
        status: "accepted",
        followerId: { $nin: blockedUsers },
      });

      return {
        followers: followers.map((f) => f.followerId),
        total: totalCount,
        totalCount,
        hasMore: totalCount > skip + followers.length,
      };
    } catch (error) {
      console.error("Error fetching followers:", error);
      throw error;
    }
  }

  static async getFollowing(
    userId: string,
    page: number = 1,
    limit: number = 20
  ) {
    try {
      const skip = (page - 1) * limit;

      const userSettings = await UserSettings.findOne({ userId });
      const blockedUsers = userSettings?.security.blockedUsers || [];

      const following = await Follow.find({
        followerId: userId,
        status: "accepted",
        followingId: { $nin: blockedUsers }, 
      })
        .populate("followingId", "username avatar email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const totalCount = await Follow.countDocuments({
        followerId: userId,
        status: "accepted",
        followingId: { $nin: blockedUsers },
      });

      return {
        following: following.map((f) => f.followingId),
        total: totalCount,
        totalCount,
        hasMore: totalCount > skip + following.length,
      };
    } catch (error) {
      console.error("Error fetching following:", error);
      throw error;
    }
  }

  static async isFollowing(
    followerId: string,
    followingId: string
  ): Promise<boolean> {
    try {
      const isBlocked = await this.areUsersBlocked(followerId, followingId);
      if (isBlocked) {
        return false; 
      }

      const follow = await Follow.findOne({
        followerId,
        followingId,
        status: "accepted",
      });
      return !!follow;
    } catch (error) {
      console.error("Error checking follow status:", error);
      return false;
    }
  }

  static async getPendingFollowRequests(userId: string) {
    try {
      const userSettings = await UserSettings.findOne({ userId });
      const blockedUsers = userSettings?.security.blockedUsers || [];

      const pendingRequests = await Follow.find({
        followingId: userId,
        status: "pending",
        followerId: { $nin: blockedUsers },
      })
        .populate("followerId", "username avatar")
        .sort({ createdAt: -1 });

      return pendingRequests;
    } catch (error) {
      console.error("Error fetching pending follow requests:", error);
      throw error;
    }
  }

  static async acceptFollowRequest(followId: string, userId: string) {
    try {
      const follow = await Follow.findOne({
        _id: followId,
        followingId: userId,
        status: "pending",
      });

      if (!follow) {
        throw new Error("Follow request not found");
      }

      const isBlocked = await this.areUsersBlocked(
        userId,
        follow.followerId.toString()
      );
      if (isBlocked) {
        throw new Error("Cannot accept follow request from blocked user");
      }

      follow.status = "accepted";
      await follow.save();

      await Promise.all([
        User.findByIdAndUpdate(follow.followerId, {
          $inc: { followingCount: 1 },
          $addToSet: { following: userId },
        }),
        User.findByIdAndUpdate(userId, {
          $inc: { followersCount: 1 },
          $addToSet: { followers: follow.followerId },
        }),
      ]);

      const shouldNotify = await this.shouldSendNotification(
        follow.followerId.toString(),
        'newFollower'
      );

      if (shouldNotify) {
        const accepter = await User.findById(userId).select('username');
        await NotificationService.createNotification({
          recipientId: follow.followerId.toString(),
          senderId: userId,
          type: 'follow',
          message: `${accepter?.username || 'Someone'} accepted your follow request`,
          entityType: 'user',
          entityId: userId,
          actionUrl: `/profile/${userId}`
        });
      }

      return follow;
    } catch (error) {
      console.error("Error accepting follow request:", error);
      throw error;
    }
  }

  static async rejectFollowRequest(followId: string, userId: string) {
    try {
      const follow = await Follow.findOneAndDelete({
        _id: followId,
        followingId: userId,
        status: "pending",
      });

      if (!follow) {
        throw new Error("Follow request not found");
      }

      return { success: true };
    } catch (error) {
      console.error("Error rejecting follow request:", error);
      throw error;
    }
  }

  static async removeFollowRelationshipsOnBlock(
    userId: string,
    blockedUserId: string
  ) {
    try {
      await Promise.all([
        this.unfollowUser(userId, blockedUserId).catch(() => {}),
        this.unfollowUser(blockedUserId, userId).catch(() => {}),
      ]);

      await Follow.deleteMany({
        $or: [
          { followerId: userId, followingId: blockedUserId },
          { followerId: blockedUserId, followingId: userId },
        ],
      });

      return { success: true };
    } catch (error) {
      console.error("Error removing follow relationships on block:", error);
      throw error;
    }
  }
}