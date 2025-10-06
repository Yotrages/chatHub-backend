import { Request, Response } from "express";
import { Reels, ReelComment } from "../Models/Reels";
import { AuthRequest } from "../types";
import { User } from "../Models/User";
import mongoose, { Types } from "mongoose";
import { detectMentions, HTTP_STATUS } from "../utils/constant";
import { NotificationService } from "../services/notificationServices";
import { UserSettings } from "../Models/userSettings";

export class ReelsController {
  static async getReels(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      let reels;

      if (userId) {
        const currentUser = await User.findById(userId).select("following");
        const followingIds = currentUser?.following || [];

        reels = await Reels.aggregate([
          { $match: { isDeleted: false } },
          {
            $addFields: {
              isFollowing: {
                $cond: {
                  if: { $in: ["$authorId", followingIds] },
                  then: 1,
                  else: 0,
                },
              },
            },
          },
          {
            $sort: {
              isFollowing: -1,
              createdAt: -1,
            },
          },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              isFollowing: 0,
            },
          },
        ]);

        await Reels.populate(reels, [
          {
            path: "authorId",
            select: "username avatar",
          },
          {
            path: "reactions.userId",
            select: "username avatar",
          },
          {
            path: "viewers.viewer",
            select: "username avatar"
          }
        ]);
      } else {
        reels = await Reels.find({ isDeleted: false })
          .populate("authorId", "username avatar")
          .populate("reactions.userId", "username avatar")
          .populate("viewers.viewer", "username avatar")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit);
      }

      const totalReels = await Reels.countDocuments({ isDeleted: false });
      const totalPages = Math.ceil(totalReels / limit);

      res.json({
        success: true,
        reels,
        pagination: {
          currentPage: page,
          totalPages,
          totalReels,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      });
    } catch (error) {
      console.error("Get reels error:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json({ error: "Failed to fetch reels" });
    }
  }

  static async getReelsComments(req: Request, res: Response): Promise<void> {
    try {
      const { reelId } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;

      const topLevelComments = await ReelComment.find({
        dynamicId: reelId,
        parentCommentId: null,
        isDeleted: false,
      })
        .populate("authorId", "username avatar")
        .populate("reactions.userId", "username avatar")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const commentsWithReplies = await Promise.all(
        topLevelComments.map(async (comment) => {
          const replies = await ReelsController.getNestedReplies(
            comment._id.toString()
          );
          return {
            ...comment.toObject(),
            replies,
          };
        })
      );

      const totalComments = await ReelComment.countDocuments({
        dynamicId: reelId,
        parentCommentId: null,
        isDeleted: false,
      });

      res.json({
        success: true,
        comments: commentsWithReplies,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalComments / limit),
          totalComments,
          hasNextPage: page < Math.ceil(totalComments / limit),
          hasPrevPage: page > 1,
        },
      });
    } catch (error) {
      console.error("Get comments error:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json({ error: "Failed to fetch comments" });
    }
  }

  static async getSingleCommentReplies(req: Request, res: Response) {
    try {
      const { reelId, commentId } = req.body;

      const comment = await ReelComment.findOne({
        _id: commentId,
        dynamicId: reelId,
        parentCommentId: null,
      });
      if (!comment) {
        res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Comment not found" });
        return;
      }
      const replies = await ReelsController.getNestedReplies(
        comment._id.toString()
      );

      const response = { ...comment.toObject(), replies };
      res.status(HTTP_STATUS.OK).json({ comment: response });
    } catch (error: any) {
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error });
    }
  }

  static async getNestedReplies(parentCommentId: string): Promise<any[]> {
    const replies = await ReelComment.find({
      parentCommentId,
      isDeleted: false,
    })
      .populate("authorId", "username avatar")
      .populate("reactions.userId", "username avatar")
      .sort({ createdAt: 1 });

    const repliesWithNested = await Promise.all(
      replies.map(async (reply) => {
        const nestedReplies = await ReelsController.getNestedReplies(
          reply._id.toString()
        );
        return {
          ...reply.toObject(),
          replies: nestedReplies,
        };
      })
    );

    return repliesWithNested;
  }

  static async createReel(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      const { title } = req.body;
      const file = req.file as Express.Multer.File;

      if (!userId) {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({
          success: false,
          error: "Only authenticated users can Reels reels",
        });
        return;
      }

      const userSettings = await UserSettings.findOne({ userId });
      if (userSettings?.account.isDeactivated) {
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: "Cannot create reel: Account is deactivated" });
        return;
      }

      if (!file) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: "a short video is required to create reel",
        });
        return;
      }

      const visibility = userSettings?.privacy.profileVisibility || "public";
      const newReels = new Reels({
        fileUrl: file.path,
        title,
        reactions: [],
        authorId: userId,
        visibility,
      });

      await newReels.save();
      await newReels.populate("authorId", "username avatar");

      res.status(HTTP_STATUS.CREATED).json({
        success: true,
        reel: newReels,
        message: "Reel created successfully",
      });
    } catch (error: any) {
      console.error("Error creating reel:", error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: "Server error",
        message: "Failed to create reel",
      });
    }
  }

  static async createComment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { reelId } = req.params;
      const { content, parentCommentId } = req.body;
      const file = req.file as Express.Multer.File;
      const authorId = req.user?.userId;

      if (!content || !reelId || !authorId) {
        res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json({ error: "Missing required fields" });
        return;
      }

      const reel = await Reels.findById(reelId);
      if (!reel) {
        res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Reels not found" });
        return;
      }

      if (parentCommentId) {
        const parentComment = await ReelComment.findById(parentCommentId);
        if (!parentComment) {
          res
            .status(HTTP_STATUS.NOT_FOUND)
            .json({ error: "Parent comment not found" });
          return;
        }
      }

      const newComment = new ReelComment({
        dynamicId: reelId,
        parentCommentId: parentCommentId || null,
        authorId,
        content,
        file: file ? file.path : undefined,
        reactions: [],
        isDeleted: false,
        isEdited: false,
        createdAt: new Date(),
      });

      if (parentCommentId) {
        await ReelComment.findByIdAndUpdate(parentCommentId, {
          $inc: { repliesCount: 1 },
        });
      } else {
        await Reels.findByIdAndUpdate(reelId, { $inc: { commentsCount: 1 } });
      }

      await newComment.save();
      await newComment.populate("authorId", "username avatar");

      if (!parentCommentId && reel.authorId.toString() !== authorId) {
        const sender = await User.findById(authorId).select("username");
        await NotificationService.createNotification({
          recipientId: reel.authorId.toString(),
          senderId: authorId,
          type: "comment",
          message: `${sender?.username || "Someone"} commented on your reel`,
          entityType: "comment",
          entityId: newComment._id.toString(),
          actionUrl: `/reel/${reelId}#comment-${newComment._id}`,
        });
      }

      if (parentCommentId) {
        const parentComment = await ReelComment.findById(parentCommentId);
        if (parentComment && parentComment.authorId.toString() !== authorId) {
          const sender = await User.findById(authorId).select("username");
          await NotificationService.createNotification({
            recipientId: parentComment.authorId.toString(),
            senderId: authorId,
            type: "reply",
            message: `${sender?.username || "Someone"} replied to your comment`,
            entityType: "comment",
            entityId: newComment._id.toString(),
            actionUrl: `/reel/${reelId}#comment-${newComment._id}`,
          });
        }
      }

      const mentionedUserIds = await detectMentions(content);
      const sender = await User.findById(authorId).select("username");
      for (const mentionedUserId of mentionedUserIds) {
        if (mentionedUserId !== authorId) {
          await NotificationService.createNotification({
            recipientId: mentionedUserId,
            senderId: authorId,
            type: "mention",
            message: `${
              sender?.username || "Someone"
            } mentioned you in a comment`,
            entityType: "comment",
            entityId: newComment._id.toString(),
            actionUrl: `/reel/${reelId}#comment-${newComment._id}`,
          });
        }
      }

      res.status(HTTP_STATUS.CREATED).json({
        success: true,
        comment: newComment,
        message: parentCommentId
          ? "Reply added successfully"
          : "Comment added successfully",
      });
    } catch (error) {
      console.error("Create comment error:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json({ error: "Failed to create comment" });
    }
  }

  static async addReaction(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { reelId } = req.params;
      const { emoji, name } = req.body;
      const userId = req.user?.userId;

      if (!userId) {
        res
          .status(HTTP_STATUS.UNAUTHORIZED)
          .json({ error: "User not authenticated" });
        return;
      }

      const reel = await Reels.findById(reelId);
      if (!reel) {
        res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Reels not found" });
        return;
      }

      const userObjectId = new mongoose.Types.ObjectId(userId);

      reel.reactions = reel.reactions.filter(
        (reaction, index, self) =>
          index ===
          self.findIndex(
            (r) => r.userId.toString() === reaction.userId.toString()
          )
      );

      const existingReactionIndex = reel.reactions.findIndex(
        (r) => r.userId.toString() === userObjectId.toString()
      );

      let isLiked = false;
      let actionType = "";

      if (existingReactionIndex !== -1) {
        const existingReaction = reel.reactions[existingReactionIndex];
        if (existingReaction.emoji.category === emoji) {
          reel.reactions.splice(existingReactionIndex, 1);
          isLiked = false;
          actionType = "removed";
        } else {
          reel.reactions[existingReactionIndex].emoji = {
            category: emoji,
            name,
          };
          isLiked = true;
          actionType = "updated";
        }
      } else {
        reel.reactions.push({
          userId: userObjectId.toString(),
          emoji: { category: emoji, name },
        });
        isLiked = true;
        actionType = "added";

        if (reel.authorId.toString() !== userId) {
          const sender = await User.findById(userId).select("username");
          await NotificationService.createNotification({
            recipientId: reel.authorId.toString(),
            senderId: userId,
            type: "like_reel",
            message: `${sender?.username || "Someone"} reacted to your reel`,
            entityType: "reel",
            entityId: reel._id.toString(),
            actionUrl: `/reel/${reel._id}`,
          });
        }
      }

      await reel.save();
      await reel.populate("reactions.userId", "username avatar");

      res.json({
        reactions: reel.reactions,
        reelId,
        isLiked,
        userId,
        actionType,
        currentUserReaction: isLiked ? emoji : null,
      });
    } catch (error) {
      console.error("Toggle reaction error:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json({ error: "Server error" });
    }
  }

  static async addCommentReaction(
    req: AuthRequest,
    res: Response
  ): Promise<void> {
    try {
      const { commentId } = req.params;
      const { emoji, name } = req.body;
      const userId = req.user?.userId;

      if (!userId) {
        res
          .status(HTTP_STATUS.UNAUTHORIZED)
          .json({ error: "User not authenticated" });
        return;
      }

      const comment = await ReelComment.findById(commentId);
      if (!comment) {
        res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Comment not found" });
        return;
      }

      const userObjectId = new mongoose.Types.ObjectId(userId);

      comment.reactions = comment.reactions.filter(
        (reaction, index, self) =>
          index ===
          self.findIndex(
            (r) => r.userId.toString() === reaction.userId.toString()
          )
      );

      const existingReactionIndex = comment.reactions.findIndex(
        (r) => r.userId.toString() === userObjectId.toString()
      );

      let isLiked = false;
      let actionType = "";

      if (existingReactionIndex !== -1) {
        const existingReaction = comment.reactions[existingReactionIndex];
        if (existingReaction.emoji.category === emoji) {
          comment.reactions.splice(existingReactionIndex, 1);
          isLiked = false;
          actionType = "removed";
        } else {
          comment.reactions[existingReactionIndex].emoji = {
            category: emoji,
            name,
          };
          isLiked = true;
          actionType = "updated";
        }
      } else {
        comment.reactions.push({
          userId: userObjectId.toString(),
          emoji: { category: emoji, name },
        });
        isLiked = true;
        actionType = "added";

        if (comment.authorId.toString() !== userId) {
          const sender = await User.findById(userId).select("username");
          await NotificationService.createNotification({
            recipientId: comment.authorId.toString(),
            senderId: userId,
            type: "like_comment",
            message: `${sender?.username || "Someone"} reacted to your comment`,
            entityType: "comment",
            entityId: comment._id.toString(),
            actionUrl: `/reel/${comment.dynamicId}#comment-${comment._id}`,
          });
        }
      }

      await comment.save();
      await comment.populate("reactions.userId", "username avatar");

      res.json({
        reactions: comment.reactions,
        commentId,
        isLiked,
        userId,
        actionType,
        currentUserReaction: isLiked ? emoji : null,
      });
    } catch (error) {
      console.error("Toggle comment reaction error:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json({ error: "Server error" });
    }
  }

  static async deleteComment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { commentId } = req.params;
      const userId = req.user?.userId;

      const comment = await ReelComment.findById(commentId);
      if (!comment) {
        res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Comment not found" });
        return;
      }

      if (comment.authorId.toString() !== userId) {
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: "Not authorized to delete this comment" });
        return;
      }

      comment.isDeleted = true;
      await comment.save();

      res.json({
        success: true,
        message: "Comment deleted successfully",
      });
    } catch (error) {
      console.error("Delete comment error:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json({ error: "Failed to delete comment" });
    }
  }

  static async updateComment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { commentId } = req.params;
      const { content } = req.body;
      const userId = req.user?.userId;

      if (!content) {
        res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json({ error: "Content is required" });
        return;
      }

      const comment = await ReelComment.findById(commentId);
      if (!comment) {
        res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Comment not found" });
        return;
      }

      if (comment.authorId.toString() !== userId) {
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: "Not authorized to update this comment" });
        return;
      }

      comment.content = content;
      comment.isEdited = true;
      comment.editedAt = new Date();
      await comment.save();
      await comment.populate("authorId", "username avatar");

      res.json({
        success: true,
        comment,
        message: "Comment updated successfully",
      });
    } catch (error) {
      console.error("Update comment error:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json({ error: "Failed to update comment" });
    }
  }

  static async getSingleReel(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const reel = await Reels.findById(id)
        .populate("authorId", "username avatar")
        .populate("reactions.userId", "username avatar");

      if (!reel) {
        res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Reels not found" });
        return;
      }

      const topLevelComments = await ReelComment.find({
        dynamicId: id,
        parentCommentId: null,
        isDeleted: false,
      })
        .populate("authorId", "username avatar")
        .populate("reactions.userId", "username avatar")
        .sort({ createdAt: -1 });

      const commentsWithReplies = await Promise.all(
        topLevelComments.map(async (comment) => {
          const replies = await ReelsController.getNestedReplies(
            comment._id.toString()
          );
          return {
            ...comment.toObject(),
            replies,
          };
        })
      );

      res.json({
        success: true,
        reel: {
          ...reel.toObject(),
          comments: commentsWithReplies,
        },
      });
    } catch (error) {
      console.error("Get single reel error:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json({ error: "Failed to fetch reel" });
    }
  }

  static async deleteReel(req: AuthRequest, res: Response): Promise<void> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { reelId } = req.params;
      const userId = req.user?.userId;

      const reel = await Reels.findById(reelId).session(session);
      if (!reel) {
        await session.abortTransaction();
        res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Reels not found" });
        return;
      }

      if (reel.authorId.toString() !== userId) {
        await session.abortTransaction();
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: "Not authorized to delete this reel" });
        return;
      }

      reel.isDeleted = true;
      await reel.save({ session });

      await ReelComment.updateMany(
        { dynamicId: reelId },
        { $set: { isDeleted: true } },
        { session }
      );

      await session.commitTransaction();
      res
        .status(HTTP_STATUS.OK)
        .json({ message: "Reels deleted successfully" });
    } catch (error) {
      await session.abortTransaction();
      console.error("Delete reel error:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json({ error: "Failed to delete reel" });
    } finally {
      session.endSession();
    }
  }

  static async updateReels(req: AuthRequest, res: Response) {
    const authorId = req.user?.userId;
    const { reelId } = req.params;
    const { content } = req.body;
    const images = req.files as Express.Multer.File[];

    try {
      if (!authorId) {
        res
          .status(HTTP_STATUS.UNAUTHORIZED)
          .json({ error: "User not authenticated" });
        return;
      }

      if (!content && (!images || images.length === 0)) {
        res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json({ error: "Reels must have content or images" });
        return;
      }

      const reel = await Reels.findOne({ _id: reelId });
      if (!reel) {
        res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Reels not found" });
        return;
      }
      if (reel.authorId.toString() !== authorId) {
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ message: "You are not authorized to update this Reels" });
        return;
      }

      const updateData: any = {};
      if (content) updateData.content = content;
      if (images && images.length > 0) {
        updateData.images = images.map((image) => image.path);
      }

      const updatedReels = await Reels.findByIdAndUpdate(reelId, updateData, {
        new: true,
      }).populate("authorId", "username avatar");
      res
        .status(HTTP_STATUS.OK)
        .json({ Reels: updatedReels, _id: updatedReels?._id });
    } catch (error: any) {
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json({ message: "Server Error" });
    }
  }

  static async trackReelShare(req: AuthRequest, res: Response) {
    const { reelId } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(HTTP_STATUS.UNAUTHORIZED);
      throw new Error("User not authenticated");
    }

    if (!reelId) {
      res.status(HTTP_STATUS.BAD_REQUEST);
      throw new Error("Reelss ID is required");
    }

    const reels = await Reels.findById(reelId);
    if (!reels) {
      res.status(HTTP_STATUS.NOT_FOUND);
      throw new Error("Reelss not found");
    }

    reels.shareCount = (reels.shareCount || 0) + 1;
    await reels.save();

    res.status(HTTP_STATUS.OK).json({ shareCount: reels.shareCount });
  }

  static async saveReel(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const userId = req.user?.userId;

    try {
      if (!userId) {
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: "You are not authenticated" });
        return;
      }
      const reel = await Reels.findOne({ _id: id });
      if (!reel) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: "Reelss not found" });
        return;
      }

      const user = await User.findById(userId);

      if (!user.savedReel.includes(reel._id)) {
        user.savedReel.push(reel._id);
        await user.save();
      }
      res.status(HTTP_STATUS.OK).json({
        success: true,
        reel,
      });
      return;
    } catch (error) {
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json({ error: "Internal server error" });
    }
  }

  static async getReelViewers(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      const { reelId } = req.params;

      if (!userId) {
          res.status(HTTP_STATUS.UNAUTHORIZED).json({
            success: false,
            error: "User not authenticated",
          });
        return;
      }

      if (!reelId || !mongoose.Types.ObjectId.isValid(reelId)) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: "Valid reel ID is required",
        });
        return;
      }

      const reel = await Reels.findById(reelId).populate(
        "viewers",
        "username avatar"
      );
      if (!reel) {
        res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          error: "reel not found",
        });
        return;
      }

      if (reel.authorId.toString() !== userId) {
        res.status(HTTP_STATUS.FORBIDDEN).json({
          success: false,
          error: "You are not authorized to view this reel's viewers",
        });
        return;
      }

      res.status(HTTP_STATUS.OK).json({
        success: true,
        data: {
          viewers: reel.viewers,
          viewersCount: reel.viewers.length,
          reelId,
        },
      });
    } catch (error: any) {
      console.error("Error fetching story viewers:", error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: "Server error",
        message: "Failed to fetch story viewers",
      });
    }
  }

  static async setReelViewers(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      const { reelId } = req.params;

      if (!userId) {
          res.status(HTTP_STATUS.UNAUTHORIZED).json({
            success: false,
            error: "User not authenticated",
          });
        return;
      }

      if (!reelId || !mongoose.Types.ObjectId.isValid(reelId)) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: "Valid reel ID is required",
        });
        return;
      }

      const reel = await Reels.findById(reelId);
      if (!reel) {
        res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          error: "reel not found",
        });
        return;
      }

      const userObjectId = new mongoose.Types.ObjectId(userId);
      const alreadyViewed = reel.viewers.some((viewer) =>
        viewer.viewer.equals(userObjectId)
      );

      if (alreadyViewed) {
        res.status(HTTP_STATUS.OK).json({
          success: true,
          message: "View already recorded",
          data: {
            reelId,
            viewersCount: reel.viewers.length,
          },
        });
        return;
      }

      reel.viewers = reel.viewers.filter(
        (viewers, index, self) =>
          index === self.findIndex((r) => r.toString() === viewers.toString())
      );

      reel.viewers.push({ viewer: userObjectId, viewedAt: new Date() });
      await reel.save();
      await reel.populate("viewers", "username avatar name");

      res.status(HTTP_STATUS.OK).json({
        success: true,
        data: {
          reelId,
          viewers: reel.viewers,
          viewersCount: reel.viewers.length,
        },
        message: "View recorded successfully",
      });
    } catch (error: any) {
      console.error("Error setting story viewer:", error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: "Server Error",
        message: "Failed to record view",
      });
    }
  }
}
