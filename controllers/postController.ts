import { Request, Response } from "express";
import { Post, Comment } from "../Models/Post";
import { AuthRequest } from "../types";
import { User } from "../Models/User";
import mongoose from "mongoose";
import { detectMentions, HTTP_STATUS } from "../utils/constant";
import { NotificationService } from "../services/notificationServices";
import { UserSettings } from "../Models/userSettings";

export class PostsController {
  static async getPosts(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      let posts;

      if (userId) {
        const currentUser = await User.findById(userId).select("following");
        const followingIds = currentUser?.following || [];
        const userSetting = await UserSettings.findOne({ userId: userId });
        const blockedPosts = userSetting?.content.blockedPosts;

        const allPosts = await Post.aggregate([
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

        const unblockedPosts = allPosts.filter((post) => {
          !blockedPosts?.some((item) => item.toString() === post._id);
        });

        posts = unblockedPosts;
        await Post.populate(posts, [
          {
            path: "authorId",
            select: "username name avatar",
          },
          {
            path: "reactions.userId",
            select: "username name avatar",
          },
        ]);
      } else {
        posts = await Post.find({ isDeleted: false })
          .populate("authorId", "username name avatar")
          .populate("reactions.userId", "username name avatar")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit);
      }

      const totalPosts = await Post.countDocuments({ isDeleted: false });
      const totalPages = Math.ceil(totalPosts / limit);

      res.status(HTTP_STATUS.OK).json({
        success: true,
        posts,
        pagination: {
          currentPage: page,
          totalPages,
          totalPosts,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      });
    } catch (error) {
      console.error("Get posts error:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json({ error: "Failed to fetch posts" });
    }
  }

  static async getPostComments(req: Request, res: Response): Promise<void> {
    try {
      const { postId } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;

      const topLevelComments = await Comment.find({
        dynamicId: postId,
        parentCommentId: null,
        isDeleted: false,
      })
        .populate("authorId", "username name avatar")
        .populate("reactions.userId", "username name avatar")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const commentsWithReplies = await Promise.all(
        topLevelComments.map(async (comment) => {
          const replies = await PostsController.getNestedReplies(
            comment._id.toString()
          );
          return {
            ...comment.toObject(),
            replies,
          };
        })
      );

      const totalComments = await Comment.countDocuments({
        dynamicId: postId,
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
      const { postId, commentId } = req.body;

      const comment = await Comment.findOne({
        _id: commentId,
        dynamicId: postId,
        parentCommentId: null,
      });
      if (!comment) {
        res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Comment not found" });
        return;
      }
      const replies = await PostsController.getNestedReplies(
        comment._id.toString()
      );

      const response = { ...comment.toObject(), replies };
      res.status(HTTP_STATUS.OK).json({ comment: response });
    } catch (error: any) {
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error });
    }
  }

  static async getNestedReplies(parentCommentId: string): Promise<any[]> {
    const replies = await Comment.find({
      parentCommentId,
      isDeleted: false,
    })
      .populate("authorId", "username name avatar")
      .populate("reactions.userId", "username name avatar")
      .sort({ createdAt: 1 });

    const repliesWithNested = await Promise.all(
      replies.map(async (reply) => {
        const nestedReplies = await PostsController.getNestedReplies(
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

  static async createPost(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { content } = req.body;
      const files = req.files as Express.Multer.File[];
      const userId = req.user?.userId;

      if (!userId) {
        res
          .status(HTTP_STATUS.UNAUTHORIZED)
          .json({ error: "User not authenticated" });
        return;
      }

      const userSettings = await UserSettings.findOne({ userId });
      if (userSettings?.account.isDeactivated) {
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: "Cannot create post: Account is deactivated" });
        return;
      }

      if (!content && (!files || files.length === 0)) {
        res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json({ error: "Post must have content or images" });
        return;
      }

      const visibility = userSettings?.privacy.profileVisibility || "public";

      const imageUrls = files ? files.map((file) => file.path) : [];
      const post = new Post({
        content: content || "",
        authorId: userId,
        images: imageUrls,
        reactions: [],
        visibility,
      });

      await post.save();
      await post.populate("authorId", "username name avatar");
      await User.findByIdAndUpdate(userId, {
        $inc: { postsCount: 1 },
      });

      if (content && userSettings?.notifications.inApp.mentioned) {
        const mentionedUserIds = await detectMentions(content);
        const sender = await User.findById(userId).select("username name");
        for (const mentionedUserId of mentionedUserIds) {
          let mentionedObjectId = new mongoose.Types.ObjectId(mentionedUserId);
          if (mentionedUserId !== userId) {
            const recipientSettings = await UserSettings.findOne({
              userId: mentionedObjectId,
            });
            if (
              recipientSettings?.security.blockedUsers.includes(
                new mongoose.Types.ObjectId(userId)
              ) ||
              userSettings?.security.blockedUsers.includes(mentionedObjectId)
            ) {
              continue;
            }

            if (recipientSettings?.notifications.inApp.mentioned) {
              await NotificationService.createNotification({
                recipientId: mentionedUserId,
                senderId: userId,
                type: "mention",
                message: `${
                  sender?.username || "Someone"
                } mentioned you in a post`,
                entityType: "post",
                entityId: post._id.toString(),
                actionUrl: `/post/${post._id}`,
              });
            }
          }
        }
      }

      res.status(HTTP_STATUS.CREATED).json({
        success: true,
        message: "Post created successfully",
        post,
      });
    } catch (error) {
      console.error("Create post error:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json({ error: "Failed to create post" });
    }
  }

  static async createComment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { postId } = req.params;
      const { content, parentCommentId } = req.body;
      const file = req.file as Express.Multer.File;
      const authorId = req.user?.userId;

      if (!content || !postId || !authorId) {
        res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json({ error: "Missing required fields" });
        return;
      }

      const post = await Post.findById(postId);
      if (!post) {
        res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Post not found" });
        return;
      }

      if (parentCommentId) {
        const parentComment = await Comment.findById(parentCommentId);
        if (!parentComment) {
          res
            .status(HTTP_STATUS.NOT_FOUND)
            .json({ error: "Parent comment not found" });
          return;
        }
      }

      const newComment = new Comment({
        dynamicId: postId,
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
        await Comment.findByIdAndUpdate(parentCommentId, {
          $inc: { repliesCount: 1 },
        });
      } else {
        await Post.findByIdAndUpdate(postId, { $inc: { commentsCount: 1 } });
      }

      await newComment.save();
      await newComment.populate("authorId", "username name avatar");

      if (!parentCommentId && post.authorId.toString() !== authorId) {
        const sender = await User.findById(authorId).select("username name");
        await NotificationService.createNotification({
          recipientId: post.authorId.toString(),
          senderId: authorId,
          type: "comment",
          message: `${
            sender?.username || "Someone"
          } commented on your post`,
          entityType: "comment",
          entityId: newComment._id.toString(),
          actionUrl: `/post/${postId}#comment-${newComment._id}`,
        });
      }

      if (parentCommentId) {
        const parentComment = await Comment.findById(parentCommentId);
        if (parentComment && parentComment.authorId.toString() !== authorId) {
          const sender = await User.findById(authorId).select("username name");
          await NotificationService.createNotification({
            recipientId: parentComment.authorId.toString(),
            senderId: authorId,
            type: "reply",
            message: `${
              sender?.username || "Someone"
            } replied to your comment`,
            entityType: "comment",
            entityId: newComment._id.toString(),
            actionUrl: `/post/${postId}#comment-${newComment._id}`,
          });
        }
      }

      const mentionedUserIds = await detectMentions(content);
      const sender = await User.findById(authorId).select("username name");
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
            actionUrl: `/post/${postId}#comment-${newComment._id}`,
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
      const { postId } = req.params;
      const { emoji, name } = req.body;
      const userId = req.user?.userId;

      if (!userId) {
        res
          .status(HTTP_STATUS.UNAUTHORIZED)
          .json({ error: "User not authenticated" });
        return;
      }

      const post = await Post.findById(postId);
      if (!post) {
        res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Post not found" });
        return;
      }
      const userObjectId = new mongoose.Types.ObjectId(userId);

      post.reactions = post.reactions.filter(
        (reaction, index, self) =>
          index ===
          self.findIndex(
            (r) => r.userId.toString() === reaction.userId.toString()
          )
      );

      const existingReactionIndex = post.reactions.findIndex(
        (r) => r.userId.toString() === userObjectId.toString()
      );

      let isLiked = false;
      let actionType = "";

      if (existingReactionIndex !== -1) {
        const existingReaction = post.reactions[existingReactionIndex];
        if (existingReaction.emoji.category === emoji) {
          post.reactions.splice(existingReactionIndex, 1);
          isLiked = false;
          actionType = "removed";
        } else {
          post.reactions[existingReactionIndex].emoji = {
            category: emoji,
            name,
          };
          isLiked = true;
          actionType = "updated";
        }
      } else {
        post.reactions.push({
          userId: userObjectId.toString(),
          emoji: { category: emoji, name },
        });
        isLiked = true;
        actionType = "added";

        if (post.authorId.toString() !== userId) {
          const sender = await User.findById(userId).select("username name");
          await NotificationService.createNotification({
            recipientId: post.authorId.toString(),
            senderId: userId,
            type: "like_post",
            message: `${
              sender?.username || "Someone"
            } reacted to your post`,
            entityType: "post",
            entityId: post._id.toString(),
            actionUrl: `/post/${post._id}`,
          });
        }
      }

      await post.save();
      await post.populate("reactions.userId", "username name avatar");
      const user = await User.findById(userId);
      if (!user) {
        res.status(HTTP_STATUS.NOT_FOUND).json({ error: "User not found" });
        return;
      }
      if (!user.likedPost.includes(post._id)) {
        user.likedPost.push(post._id);
        await user.save();
      }

      res.json({
        reactions: post.reactions,
        postId,
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

      const comment = await Comment.findById(commentId);
      if (!comment) {
        res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Comment not found" });
        return;
      }

      const userObjectId = new mongoose.Types.ObjectId(userId);

      // Remove duplicates
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

        // Notify comment author
        if (comment.authorId.toString() !== userId) {
          const sender = await User.findById(userId).select("username name");
          await NotificationService.createNotification({
            recipientId: comment.authorId.toString(),
            senderId: userId,
            type: "like_comment",
            message: `${
              sender?.username || "Someone"
            } reacted to your comment`,
            entityType: "comment",
            entityId: comment._id.toString(),
            actionUrl: `/post/${comment.dynamicId}#comment-${comment._id}`,
          });
        }
      }

      await comment.save();
      await comment.populate("reactions.userId", "username name avatar");

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

      const comment = await Comment.findById(commentId);
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

      const comment = await Comment.findById(commentId);
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
      await comment.populate("authorId", "username name avatar");

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

  // Get single post with comments
  static async getSinglePost(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const post = await Post.findById(id)
        .populate("authorId", "username name avatar")
        .populate("reactions.userId", "username name avatar");

      if (!post) {
        res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Post not found" });
        return;
      }

      // Get comments separately using the new structure
      // const topLevelComments = await Comment.find({
      //   dynamicId: id,
      //   parentCommentId: null,
      //   isDeleted: false,
      // })
      //   .populate("authorId", "username name avatar")
      //   .populate("reactions.userId", "username name avatar")
      //   .sort({ createdAt: -1 });

      // // Get nested replies for each comment
      // const commentsWithReplies = await Promise.all(
      //   topLevelComments.map(async (comment) => {
      //     const replies = await PostsController.getNestedReplies(
      //       comment._id.toString()
      //     );
      //     return {
      //       ...comment.toObject(),
      //       replies,
      //     };
      //   })
      // );

      res.json({
        success: true,
        post: {
          ...post.toObject(),
        },
      });
    } catch (error) {
      console.error("Get single post error:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json({ error: "Failed to fetch post" });
    }
  }

  static async deletePost(req: AuthRequest, res: Response): Promise<void> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { postId } = req.params;
      const userId = req.user?.userId;

      const post = await Post.findById(postId).session(session);
      if (!post) {
        await session.abortTransaction();
        res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Post not found" });
        return;
      }

      if (post.authorId.toString() !== userId) {
        await session.abortTransaction();
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: "Not authorized to delete this post" });
        return;
      }

      post.isDeleted = true;
      await post.save({ session });

      await Comment.updateMany(
        { dynamicId: postId },
        { $set: { isDeleted: true } },
        { session }
      );

      await session.commitTransaction();
      res.status(HTTP_STATUS.OK).json({ message: "Post deleted successfully" });
    } catch (error) {
      await session.abortTransaction();
      console.error("Delete post error:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json({ error: "Failed to delete post" });
    } finally {
      session.endSession();
    }
  }

  static async updatePost(req: AuthRequest, res: Response) {
    const authorId = req.user?.userId;
    const { postId } = req.params;
    const { content, existingImages } = req.body;
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
          .json({ error: "Post must have content or images" });
        return;
      }

      const post = await Post.findOne({ _id: postId });
      if (!post) {
        res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Post not found" });
        return;
      }
      if (post.authorId.toString() !== authorId) {
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ message: "You are not authorized to update this Post" });
        return;
      }

      const updateData: any = {};
      if (content) updateData.content = content;
      if (images && images.length > 0) {
        const newImages = images.map((image) => image.path);
        if (existingImages && existingImages.length > 0) {
          updateData.images = [...existingImages, ...newImages];
        } else {
          updateData.images = newImages;
        }
      }

      const updatedPost = await Post.findByIdAndUpdate(postId, updateData, {
        new: true,
      }).populate("authorId", "username avatar");
      res
        .status(HTTP_STATUS.OK)
        .json({ Post: updatedPost, _id: updatedPost?._id });
    } catch (error: any) {
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json({ message: "Server Error" });
    }
  }

  static async trackPostShare(req: AuthRequest, res: Response) {
    const { postId } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(HTTP_STATUS.UNAUTHORIZED);
      throw new Error("User not authenticated");
    }

    if (!postId) {
      res.status(HTTP_STATUS.BAD_REQUEST);
      throw new Error("Posts ID is required");
    }

    const posts = await Post.findById(postId);
    if (!posts) {
      res.status(HTTP_STATUS.NOT_FOUND);
      throw new Error("Posts not found");
    }

    posts.shareCount = (posts.shareCount || 0) + 1;
    await posts.save();

    res.status(HTTP_STATUS.OK).json({ shareCount: posts.shareCount });
  }

  static async savePost(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const userId = req.user?.userId;

    try {
      if (!userId) {
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: "You are not authenticated" });
        return;
      }
      const post = await Post.findOne({ _id: id });
      if (!post) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: "Posts not found" });
        return;
      }

      const user = await User.findById(userId);

      if (!user) {
        res.status(HTTP_STATUS.NOT_FOUND).json({ error: "User not found" });
        return;
      }

      const existingSave = user.savedPost.find(save => save.postId.toString() === post._id.toString());
    
    if (!existingSave) {
      user.savedPost.push({
        postId: post._id,
        savedAt: new Date()
      });
      await user.save();
    }

      res.status(HTTP_STATUS.OK).json({
        success: true,
        post,
      });
      return;
    } catch (error) {
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json({ error: "Internal server error" });
    }
  }
}
