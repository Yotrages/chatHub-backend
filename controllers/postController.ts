import { Request, Response } from "express";
import { Post } from "../Models/Post";
import { AuthRequest, IReply } from "../types";
import { User } from "../Models/User";
import mongoose, { Types } from "mongoose";

export class PostsController {
  // Get all posts (social feed)
  static async getPosts(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;

      const posts = await Post.find()
        .populate("authorId", "username avatar")
        .populate("likes", "username avatar") 
        .populate({
          path: "comments",
          populate: {
            path: "authorId",
            select: "username avatar",
          },
          options: { sort: { createdAt: -1 } },
        }).populate("comments.likes", "username avatar")
        .populate("comments.replies.authorId", "username avatar")
        .populate("comments.replies.likes", "username avatar")
        .populate("comments.replies.replies.authorId", "username avatar")
        .populate("comments.replies.replies.likes", "username avatar")
        .sort({ createdAt: -1 }) 
        .skip(skip)
        .limit(limit);

      const totalPosts = await Post.countDocuments();
      const totalPages = Math.ceil(totalPosts / limit);

      res.json({
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
      res.status(500).json({ error: "Failed to fetch posts" });
    }
  }

  // Create new post
  static async createPost(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { content } = req.body;
      const files = req.files as Express.Multer.File[]; 
      const authorId = req.user?.userId;

      if (!authorId) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      if (!content && (!files || files.length === 0)) {
        res.status(400).json({ error: "Post must have content or images" });
        return;
      }

      const imageUrls = files ? files.map((file) => file.path) : []; // ✅ file.path contains Cloudinary URL

      const post = new Post({
        content: content || "", 
        authorId,
        images: imageUrls, 
        likes: [],
        comments: [],
      });

      await post.save();

      await post.populate("authorId", "username avatar")

      res.status(201).json({
        success: true,
        message: "Post created successfully",
        post,
      });
    } catch (error) {
      console.error("Create post error:", error);
      res.status(500).json({ error: "Failed to create post" });
    }
  }

  static async toggleLike(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { postId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    const post = await Post.findById(postId);
    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);
    
    const isLiked = post.likes.some(like => like.equals(userObjectId));
    
    if (isLiked) {
      post.likes = post.likes.filter(like => !like.equals(userObjectId));
    } else {
      post.likes.push(userObjectId);
    }

    await post.save();

    await post.populate("likes", "username avatar");

    res.json({
      likes: post.likes,
      postId: postId,
      isLiked: !isLiked, 
      userId,
    });
  } catch (error) {
    console.error("Toggle like error:", error);
    res.status(500).json({ error: "Server error" });
  }
}

  static async createComment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { postId } = req.params;
    const { content } = req.body;
    const authorId = req.user?.userId;

    if (!content || !postId || !authorId) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    const post = await Post.findById(postId);
    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    const newComment = {
      content,
      authorId: new mongoose.Types.ObjectId(authorId),
      likes: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      replies: [] 
    };

    const updatedPost = await Post.findByIdAndUpdate(
      postId,
      { $push: { comments: { $each: [newComment], $position: 0 } } },
      { new: true }
    ).populate("comments.authorId", "username avatar");

    if (!updatedPost) {
      res.status(404).json({ error: "Failed to update post" });
      return;
    }

    const createdComment = updatedPost.comments[0];

    res.status(201).json({ 
      comment: createdComment, 
      postId 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create comment" });
  }
}

  static async getUserPosts(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const user = await User.findById(userId);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const posts = await Post.find()
        .populate("authorId", "username avatar")
        .populate("likes", "username avatar") 
        .populate({
          path: "comments",
          populate: {
            path: "authorId",
            select: "username avatar",
          },
          options: { sort: { createdAt: -1 } }, 
        }).populate("comments.likes", "username avatar")
        .populate("comments.replies.authorId", "username avatar")
        .populate("comments.replies.likes", "username avatar")
        .populate("comments.replies.replies.authorId", "username avatar")
        .populate("comments.replies.replies.likes", "username avatar")
        .sort({ createdAt: -1 })

      const totalUserPosts = await Post.countDocuments({ authorId: userId });

      res.json({
        success: true,
        posts,
        totalPosts: totalUserPosts, 
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch posts" });
    }
  }

  // Update Comment
  static async updateComment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { postId, commentId } = req.params;
      const { content } = req.body;
      const authorId = req.user?.userId;

      if (!content || !postId || !authorId || !commentId) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      const post = await Post.findById(postId);
      if (!post) {
        res.status(404).json({ error: "Post not found" });
        return;
      }

      const commentIndex = post.comments.findIndex(
        (c) =>
          c._id.toString() === commentId && c.authorId.toString() === authorId
      );

      if (commentIndex === -1) {
        res.status(404).json({ error: "Comment not found or unauthorized" });
        return;
      }

      post.comments[commentIndex].content = content;
      await post.save();
      await post.populate("comments.authorId", "username avatar")

      res.status(200).json({ comment: post.comments[commentIndex], postId, _id: post.comments[commentIndex]._id });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to update comment" });
    }
  }

  // Update Post
  static async updatePost(req: AuthRequest, res: Response) {
    const authorId = req.user?.userId;
    const { postId } = req.params;
    const { content } = req.body;
    const images = req.files as Express.Multer.File[];

    try {
      if (!authorId) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      if (!content && (!images || images.length === 0)) {
        res.status(400).json({ error: "Post must have content or images" });
        return;
      }

      const post = await Post.findOne({ _id: postId });
      if (!post) {
        res.status(404).json({ error: "Post not found" });
        return;
      }
      if (post.authorId.toString() !== authorId) {
        res
          .status(403)
          .json({ message: "You are not authorized to update this post" });
        return;
      }

      const updateData: any = {};
      if (content) updateData.content = content;
      if (images && images.length > 0) {
        updateData.images = images.map((image) => image.path);
      }

      const updatedPost = await Post.findByIdAndUpdate(postId, updateData, {
        new: true,
      }).populate("authorId", "username avatar");
      res.status(200).json({post: updatedPost, _id: updatedPost?._id});
    } catch (error: any) {
      res.status(500).json({ message: "Server Error" });
    }
  }

  static async searchPost(req: Request, res: Response) {
    const { query } = req.params;
    try {
      const posts = await Post.find({
        content: { $regex: query, $options: "i" },
      }).populate("authorId", "username avatar")
        .populate("likes", "username avatar") 
        .populate({
          path: "comments",
          populate: {
            path: "authorId",
            select: "username avatar",
          },
          options: { sort: { createdAt: -1 } }, 
        }).populate("comments.likes", "username avatar")
        .populate("comments.replies.authorId", "username avatar")
        .populate("comments.replies.likes", "username avatar")
        .populate("comments.replies.replies.authorId", "username avatar")
        .populate("comments.replies.replies.likes", "username avatar")
        .sort({ createdAt: -1 });

      if (posts.length === 0) {
        res.status(404).json({ message: "No post match your search" });
        return;
      }
      res.status(200).json(posts);
    } catch (err: any) {
      res.status(500).json({ message: "Server Error, failed to search" });
    }
  }

  static async deletePost(req: AuthRequest, res: Response) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { postId } = req.params;
      const userId = req.user?.userId;

      const post = await Post.findById(postId).session(session);
      if (!post) {
        await session.abortTransaction();
        res.status(404).json({ error: "Post not found" });
        return;
      }

      if (post.authorId.toString() !== userId) {
        await session.abortTransaction();
        res.status(403).json({ error: "Not authorized to delete this post" });
        return;
      }

      await Post.findByIdAndDelete(postId).session(session);

      await session.commitTransaction();
      res.status(200).json({ message: "Post deleted successfully" });
    } catch (err) {
      await session.abortTransaction();
      console.error(err);
      res.status(500).json({ error: "Failed to delete post" });
    } finally {
      session.endSession();
    }
  }

  static async deleteComment(req: AuthRequest, res: Response) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { commentId, postId } = req.body;
      const userId = req.user?.userId;

      // Validate input
      if (!commentId || !postId) {
        await session.abortTransaction();
        res.status(400).json({ error: "Missing commentId or postId" });
        return;
      }

      const post = await Post.findById(postId).session(session);
      if (!post) {
        await session.abortTransaction();
        res.status(404).json({ error: "Post not found" });
        return;
      }

      const comment = post.comments.find((c) => c._id.equals(commentId));

      if (!comment) {
        await session.abortTransaction();
        res.status(404).json({ error: "Comment not found" });
        return;
      }

      const isCommentAuthor = comment.authorId.equals(userId);
      // const isPostAuthor = post.authorId.equals(userId);

      if (!isCommentAuthor) {
        await session.abortTransaction();
        res
          .status(403)
          .json({ error: "Not authorized to delete this comment" });
        return;
      }

      post.comments.pull(commentId);
      await post.save({ session });

      await session.commitTransaction();
      res.status(200).json({ message: "Comment deleted successfully" });
    } catch (error) {
      await session.abortTransaction();
      console.error(error);
      res.status(500).json({ error: "Failed to delete comment" });
    } finally {
      session.endSession();
    }
  }

  // Like/Unlike Comment
  static async toggleLikeComment(req: AuthRequest, res: Response) {
  try {
    const { postId, commentId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!Types.ObjectId.isValid(postId) || !Types.ObjectId.isValid(commentId)) {
      res.status(400).json({ error: "Invalid ID format" });
      return;
    }

    const post = await Post.findById(postId);
    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    const comment = post.comments.id(commentId);
    if (!comment) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }

    const userObjectId = new Types.ObjectId(userId);
    const isCurrentlyLiked = comment.likes.some(
      (likeId: any) => likeId.toString() === userId
    );

    if (isCurrentlyLiked) {
      comment.likes = comment.likes.filter(
        (likeId: any) => likeId.toString() !== userId
      );
    } else {
      comment.likes.push(userObjectId);
    }

    await post.save();

    await post.populate({
      path: 'comments.likes',
      select: 'username avatar'
    });

    const updatedComment = post.comments.id(commentId);

    res.status(200).json({
      likes: updatedComment?.likes,
      likesCount: updatedComment?.likes.length,
      postId,
      commentId,
      userId,
      isLiked: !isCurrentlyLiked
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to toggle like" });
  }
}


  // Add Reply to Comment
  static async addReply(req: AuthRequest, res: Response) {
    try {
      const { postId, commentId } = req.params;
      const { content } = req.body;
      const authorId = req.user?.userId;

      if (!content || !authorId) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      const post = await Post.findById(postId);
      if (!post) {
        res.status(404).json({ error: "Post not found" });
        return;
      }

      const comment = post.comments.id(commentId);
      if (!comment) {
        res.status(404).json({ error: "Comment not found" });
        return;
      }

      const newReply = {
        authorId: new Types.ObjectId(authorId),
        content: content.trim(),
        likes: [],
        replies: [],
      };

      comment.replies.push(newReply as any);

      comment.markModified("replies");

      await post.save();

      const createdReply = comment.replies[comment.replies.length - 1];

      await post.populate("comments.replies.authorId", "username avatar");

      res.status(201).json({
        reply: createdReply,
        postId,
        commentId,
        message: "Reply added successfully",
      });
    } catch (error) {
      console.error("Error adding reply:", error);
      res.status(500).json({ error: "Failed to add reply" });
    }
  }

  static async addNestedReply(req: AuthRequest, res: Response) {
    try {
      const { postId, commentId, parentReplyId } = req.params;
      const { content } = req.body;
      const authorId = req.user?.userId;

      if (!content || !authorId) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      if (
        !Types.ObjectId.isValid(postId) ||
        !Types.ObjectId.isValid(commentId) ||
        !Types.ObjectId.isValid(parentReplyId)
      ) {
        res.status(400).json({ error: "Invalid ID format" });
        return;
      }

      const post = await Post.findById(postId);
      if (!post) {
        res.status(404).json({ error: "Post not found" });
        return;
      }

      const comment = post.comments.id(commentId);
      if (!comment) {
        res.status(404).json({ error: "Comment not found" });
        return;
      }

      const findParentReply = (
        replies: Array<IReply>,
        targetId: string
      ): any => {
        for (const reply of replies) {
          if (reply._id && reply._id.toString() === targetId) {
            return reply;
          }
          if (reply.replies && reply.replies.length > 0) {
            const found = findParentReply(reply.replies, targetId);
            if (found) return found;
          }
        }
        return null;
      };

      const parentReply = findParentReply(comment.replies, parentReplyId);
      if (!parentReply) {
        res.status(404).json({ error: "Parent reply not found" });
        return;
      }

      const newNestedReply = {
        authorId: new Types.ObjectId(authorId),
        content: content.trim(),
        likes: [],
        replies: [],
      };

      if (!parentReply.replies) {
        parentReply.replies = [];
      }

      parentReply.replies.push(newNestedReply);

      comment.markModified("replies");

      await post.save();

      const createdReply = parentReply.replies[parentReply.replies.length - 1];

      await post.populate("comments.replies.replies.authorId", "username avatar");

      res.status(201).json({
        reply: createdReply,
        postId,
        commentId,
        parentReplyId: createdReply._id,
        message: "Nested reply added successfully",
      });
    } catch (error) {
      console.error("Error adding nested reply:", error);
      res.status(500).json({ error: "Failed to add nested reply" });
    }
  }

  static async deleteReply(req: AuthRequest, res: Response) {
    try {
      const { postId, commentId, replyId } = req.params;
      const userId = req.user?.userId;

      const post = await Post.findById(postId);
      if (!post) {
        res.status(404).json({ error: "Post not found" });
        return;
      }

      const comment = post.comments.id(commentId);
      if (!comment) {
        res.status(404).json({ error: "Comment not found" });
        return;
      }

      const removeReply = (replies: any[], targetId: string): boolean => {
        for (let i = 0; i < replies.length; i++) {
          if (replies[i]._id.toString() === targetId) {
            if (replies[i].authorId.toString() !== userId) {
              throw new Error("Unauthorized");
            }
            replies.splice(i, 1);
            return true;
          }
          if (replies[i].replies && replies[i].replies.length > 0) {
            if (removeReply(replies[i].replies, targetId)) {
              return true;
            }
          }
        }
        return false;
      };

      const removed = removeReply(comment.replies, replyId);
      if (!removed) {
        res.status(404).json({ error: "Reply not found" });
        return;
      }

      comment.markModified("replies");
      await post.save();

      res.json({
        message: "Reply deleted successfully",
        postId,
        commentId,
        replyId,
      });
    } catch (error: any) {
      if (error.message === "Unauthorized") {
        res.status(403).json({ error: "You can only delete your own replies" });
        return;
      }
      console.error("Error deleting reply:", error);
      res.status(500).json({ error: "Failed to delete reply" });
    }
  }

 static async likeReply(req: AuthRequest, res: Response) {
  try {
    const { postId, commentId, replyId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    if (
      !Types.ObjectId.isValid(postId) ||
      !Types.ObjectId.isValid(commentId) ||
      !Types.ObjectId.isValid(replyId)
    ) {
      res.status(400).json({ error: "Invalid ID format" });
      return;
    }

    const post = await Post.findById(postId);
    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    const comment = post.comments.id(commentId);
    if (!comment) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }

    const findReply = (replies: Array<IReply>, targetId: string): any => {
      for (const reply of replies) {
        if (reply._id && reply._id.toString() === targetId) {
          return reply;
        }
        if (reply.replies && reply.replies.length > 0) {
          const found = findReply(reply.replies, targetId);
          if (found) return found;
        }
      }
      return null;
    };

    const reply = findReply(comment.replies, replyId);
    if (!reply) {
      res.status(404).json({ error: "Reply not found" });
      return;
    }

    const userObjectId = new Types.ObjectId(userId);
    const isCurrentlyLiked = reply.likes.some(
      (likeId: any) => likeId.toString() === userId
    );

    if (isCurrentlyLiked) {
      reply.likes = reply.likes.filter(
        (likeId: any) => likeId.toString() !== userId
      );
    } else {
      reply.likes.push(userObjectId);
    }

    comment.markModified("replies");
    await post.save();

    await post.populate({
      path: 'comments.replies.likes',
      select: 'username avatar'
    });

    const updatedReply = findReply(comment.replies, replyId);

    res.json({
      message: isCurrentlyLiked
        ? "Reply unliked successfully"
        : "Reply liked successfully",
      isLiked: !isCurrentlyLiked,
      likesCount: updatedReply?.likes.length,
      replyId: updatedReply?._id,
      postId,
      commentId,
      userId,
      likes: updatedReply?.likes
    });
  } catch (error) {
    console.error("Error liking reply:", error);
    res.status(500).json({ error: "Failed to like/unlike reply" });
  }
}

static async likeNestedReply(req: AuthRequest, res: Response) {
  try {
    const { postId, commentId, nestedReplyId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    if (
      !Types.ObjectId.isValid(postId) ||
      !Types.ObjectId.isValid(commentId) ||
      !Types.ObjectId.isValid(nestedReplyId)
    ) {
      res.status(400).json({ error: "Invalid ID format" });
      return;
    }

    const post = await Post.findById(postId);
    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    const comment = post.comments.id(commentId);
    if (!comment) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }

    const findAndToggleLike = (
      replies: any[],
      targetId: string,
      userId: string
    ): { found: boolean; isLiked: boolean; reply: any } => {
      for (const reply of replies) {
        if (reply._id && reply._id.toString() === targetId) {
          const userObjectId = new Types.ObjectId(userId);
          const isCurrentlyLiked = reply.likes.some(
            (likeId: any) => likeId.toString() === userId
          );

          if (isCurrentlyLiked) {
            reply.likes = reply.likes.filter(
              (likeId: any) => likeId.toString() !== userId
            );
          } else {
            reply.likes.push(userObjectId);
          }

          return {
            found: true,
            isLiked: !isCurrentlyLiked,
            reply: reply
          };
        }

        if (reply.replies && reply.replies.length > 0) {
          const result = findAndToggleLike(reply.replies, targetId, userId);
          if (result.found) return result;
        }
      }

      return { found: false, isLiked: false, reply: null };
    };

    const result = findAndToggleLike(comment.replies, nestedReplyId, userId);

    if (!result.found) {
      res.status(404).json({ error: "Nested reply not found" });
      return;
    }

    comment.markModified("replies");
    await post.save();

    await post.populate({
      path: 'comments.replies.replies.likes',
      select: 'username avatar'
    });

    const updatedResult = findAndToggleLike(comment.replies, nestedReplyId, userId);

    res.json({
      message: result.isLiked
        ? "Nested reply liked successfully"
        : "Nested reply unliked successfully",
      isLiked: result.isLiked,
      likesCount: result.reply.likes.length,
      replyId: nestedReplyId,
      likes: result.reply.likes
    });
  } catch (error) {
    console.error("Error liking nested reply:", error);
    res.status(500).json({ error: "Failed to like/unlike nested reply" });
  }
}


  static async getReplyLikeStatus(req: AuthRequest, res: Response) {
    try {
      const { postId, commentId, replyId } = req.params;
      const userId = req.user?.userId;

      const post = await Post.findById(postId);
      if (!post) {
        res.status(404).json({ error: "Post not found" });
        return;
      }

      const comment = post.comments.id(commentId);
      if (!comment) {
        res.status(404).json({ error: "Comment not found" });
        return;
      }

      const findReplyLikeStatus = (
        replies: any[],
        targetId: string
      ): {
        found: boolean;
        isLiked: boolean;
        likesCount: number;
        likes: any[];
      } => {
        for (const reply of replies) {
          if (reply._id && reply._id.toString() === targetId) {
            const isLiked = userId
              ? reply.likes.some((likeId: any) => likeId.toString() === userId)
              : false;
            return {
              found: true,
              isLiked,
              likesCount: reply.likes.length,
              likes: reply.likes.map((id: any) => id.toString()),
            };
          }

          if (reply.replies && reply.replies.length > 0) {
            const result = findReplyLikeStatus(reply.replies, targetId);
            if (result.found) return result;
          }
        }

        return { found: false, isLiked: false, likesCount: 0, likes: [] };
      };

      const result = findReplyLikeStatus(comment.replies, replyId);

      if (!result.found) {
        res.status(404).json({ error: "Reply not found" });
        return;
      }

      await post.populate("comments.replies.authorId", "username avatar")

      res.json({
        replyId,
        isLiked: result.isLiked,
        likesCount: result.likesCount,
        likes: result.likes,
      });
    } catch (error) {
      console.error("Error getting reply like status:", error);
      res.status(500).json({ error: "Failed to get reply like status" });
    }
  }

  // Bulk like status for all replies in a comment (useful for UI)
  static async getBulkReplyLikeStatus(req: AuthRequest, res: Response) {
    try {
      const { postId, commentId } = req.params;
      const userId = req.user?.userId;

      const post = await Post.findById(postId);
      if (!post) {
        res.status(404).json({ error: "Post not found" });
        return;
      }

      const comment = post.comments.id(commentId);
      if (!comment) {
        res.status(404).json({ error: "Comment not found" });
        return;
      }

      const getAllReplyLikeStatuses = (replies: any[]): any[] => {
        return replies.map((reply) => {
          const isLiked = userId
            ? reply.likes.some((likeId: any) => likeId.toString() === userId)
            : false;

          return {
            replyId: reply._id.toString(),
            isLiked,
            likesCount: reply.likes.length,
            nestedReplies:
              reply.replies && reply.replies.length > 0
                ? getAllReplyLikeStatuses(reply.replies)
                : [],
          };
        });
      };

      const replyStatuses = getAllReplyLikeStatuses(comment.replies);

      res.json({
        commentId,
        replies: replyStatuses,
      });
    } catch (error) {
      console.error("Error getting bulk reply like status:", error);
      res.status(500).json({ error: "Failed to get bulk reply like status" });
    }
  }

  // Get users who liked a specific reply (with pagination)
  static async getReplyLikers(req: AuthRequest, res: Response) {
    try {
      const { postId, commentId, replyId } = req.params;

      const post = await Post.findById(postId).populate({
        path: "comments.replies.likes",
        select: "username avatar",
      });

      if (!post) {
        res.status(404).json({ error: "Post not found" });
        return;
      }

      const comment = post.comments.id(commentId);
      if (!comment) {
        res.status(404).json({ error: "Comment not found" });
        return;
      }

      const findReplyLikers = (replies: any[], targetId: string): any => {
        for (const reply of replies) {
          if (reply._id && reply._id.toString() === targetId) {
            return reply.likes;
          }
          if (reply.replies && reply.replies.length > 0) {
            const result = findReplyLikers(reply.replies, targetId);
            if (result) return result;
          }
        }
        return null;
      };

      const likers = findReplyLikers(comment.replies, replyId);

      if (!likers) {
        res.status(404).json({ error: "Reply not found" });
        return;
      }

      res.json({
        replyId,
        likers,
        total: likers.length,
      });
    } catch (error) {
      console.error("Error getting reply likers:", error);
      res.status(500).json({ error: "Failed to get reply likers" });
    }
  }
}
