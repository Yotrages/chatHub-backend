import { Follow } from "../Models/Follow";
import { User } from "../Models/User";
import { NotificationService } from "./notificationServices";
import { IFollow } from "../types";

export class FollowService {
  static async followUser(
    followerId: string,
    followingId: string
  ): Promise<IFollow> {
    try {
      if (followerId === followingId) {
        throw new Error("Users cannot follow themselves");
      }

      // Check if follow relationship already exists
      const existingFollow = await Follow.findOne({ followerId, followingId });
      if (existingFollow) {
        throw new Error("Already following this user");
      }

      // Check if the user being followed exists
      const userToFollow = await User.findById(followingId);
      if (!userToFollow) {
        throw new Error("User not found");
      }

      // Create follow relationship
      const follow = new Follow({
        followerId,
        followingId,
        status: userToFollow.isPrivate ? "pending" : "accepted",
      });

      await follow.save();

      // Update follower/following counts
      if (follow.status === "accepted") {
        await User.findByIdAndUpdate(followerId, {
          $inc: { followingCount: 1 },
        });
        await User.findByIdAndUpdate(followingId, {
          $inc: { followersCount: 1 },
        });
        await User.findByIdAndUpdate(followerId, {
          $push: { following: { $each: [followingId] } },
        });
        await User.findByIdAndUpdate(followingId, {
          $push: { followers: { $each: [followerId] } },
        });
      }

      // Create notification for the followed user
      const follower = await User.findById(followerId);
      await NotificationService.createNotification({
        recipientId: followingId,
        senderId: followerId,
        type: "follow",
        message: `${
          follower?.username || "Someone"
        } started following you`,
        entityType: "user",
        entityId: followerId,
        actionUrl: `/profile/${followerId}`,
      });

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

      // Update follower/following counts
      await User.findByIdAndUpdate(followerId, {
        $inc: { followingCount: -1 },
      });
      await User.findByIdAndUpdate(followingId, {
        $inc: { followersCount: -1 },
      });
      await User.findByIdAndUpdate(followerId, {
        $pop: { following: { $each: [followingId] } },
      });
      await User.findByIdAndUpdate(followingId, {
        $pop: { followers: { $each: [followerId] } },
      });

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

      const followers = await Follow.find({
        followingId: userId,
        status: "accepted",
      })
        .populate("followerId", "username name avatar email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const totalCount = await Follow.countDocuments({
        followingId: userId,
        status: "accepted",
      });

      return {
        followers: followers.map((f) => f.followerId),
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

      const following = await Follow.find({
        followerId: userId,
        status: "accepted",
      })
        .populate("followingId", "username name avatar email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const totalCount = await Follow.countDocuments({
        followerId: userId,
        status: "accepted",
      });

      return {
        following: following.map((f) => f.followingId),
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
      const pendingRequests = await Follow.find({
        followingId: userId,
        status: "pending",
      })
        .populate("followerId", "username name avatar")
        .sort({ createdAt: -1 });

      return pendingRequests;
    } catch (error) {
      console.error("Error fetching pending follow requests:", error);
      throw error;
    }
  }

  static async acceptFollowRequest(followId: string, userId: string) {
    try {
      const follow = await Follow.findOneAndUpdate(
        { _id: followId, followingId: userId, status: "pending" },
        { status: "accepted" },
        { new: true }
      );

      if (!follow) {
        throw new Error("Follow request not found");
      }

      await User.findByIdAndUpdate(followId, {
          $inc: { followingCount: 1 },
        });
        await User.findByIdAndUpdate(userId, {
          $inc: { followersCount: 1 },
        });
        await User.findByIdAndUpdate(followId, {
          $push: { following: { $each: [userId] } },
        });
        await User.findByIdAndUpdate(userId, {
          $push: { followers: { $each: [followId] } },
        });

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
}
