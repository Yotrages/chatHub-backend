import { Response, Request } from "express";
import { AuthRequest } from "../types";
import { Stories } from "../Models/Stories";
import mongoose, { Types } from "mongoose";
import { NotificationService } from "../services/notificationServices";
import { User } from "../Models/User";
import { detectMentions, HTTP_STATUS } from "../utils/constant";

export class storiesController {
  static async getStories(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      const stories = await Stories.find()
        .populate("authorId", "username name avatar")
        .populate("reactions.userId", "username name avatar") // Fixed: populate reactions instead of likes
        .sort({ createdAt: -1 }) // Most recent first
        .skip(skip)
        .limit(limit);

      const total = await Stories.countDocuments();
      const hasMore = page * limit < total;

      if (stories.length === 0) {
         res.status(HTTP_STATUS.OK).json({
          success: true,
          data: [],
          message: "No stories available",
          pagination: {
            page,
            limit,
            total,
            hasMore,
          },
        });
        return;
      }

     res.status(HTTP_STATUS.OK).json({
        success: true,
        data: stories,
        pagination: {
          page,
          limit,
          total,
          hasMore,
        },
      });
    } catch (err: any) {
      console.error("Error fetching stories:", err);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: "Server Error",
        message: "Failed to fetch stories",
      });
    }
  }

  static async createStories(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      const { text, fileType = "video", textPosition, background } = req.body;
      const file = req.file as Express.Multer.File;

      if (!userId) {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({
          success: false,
          error: "Only authenticated users can post stories",
        });
        return;
      }

      if (!file && !text) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: "Either a file or text is required to create a story",
        });
        return;
      }

      const allowedTypes = ["image", "video"];
      if (fileType && !allowedTypes.includes(fileType.toLowerCase())) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: "Invalid file type. Must be image or video",
        });
        return;
      }

      let parsedTextPosition;
      try {
        parsedTextPosition = textPosition
          ? JSON.parse(textPosition)
          : { x: 0, y: 0 };
        if (
          typeof parsedTextPosition !== "object" ||
          typeof parsedTextPosition.x !== "number" ||
          typeof parsedTextPosition.y !== "number"
        ) {
          throw new Error("Invalid textPosition format");
        }
      } catch (error) {
         res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error:
            "Invalid textPosition format. Must be { x: number, y: number }",
        });
        return;
      }

      const newStories = new Stories({
        fileType: fileType.toLowerCase(),
        text: text?.trim(),
        fileUrl: file ? file.path : "",
        reactions: [], // Fixed: use reactions instead of likes
        viewers: [],
        authorId: userId,
        textPosition: parsedTextPosition,
        background: file ? "" : background || "",
      });

      await newStories.save();
      await newStories.populate("authorId", "username name avatar");

      // Notify mentioned users in story text
      if (text) {
        const mentionedUserIds = await detectMentions(text);
        const sender = await User.findById(userId).select("username name");
        for (const mentionedUserId of mentionedUserIds) {
          if (mentionedUserId !== userId) {
            await NotificationService.createNotification({
              recipientId: mentionedUserId,
              senderId: userId,
              type: "mention",
              message: `${
                sender?.username || sender?.name || "Someone"
              } mentioned you in a story`,
              entityType: "story",
              entityId: newStories._id.toString(),
              actionUrl: `/stories/${newStories._id}`,
            });
          }
        }
      }

       res.status(HTTP_STATUS.CREATED).json({
        success: true,
        data: newStories,
        message: "story created successfully",
      });
    } catch (error: any) {
      console.error("Error creating story:", error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: "Server error",
        message: "Failed to create story",
      });
    }
  }

  // Like/Unlike story
  static async storiesReaction(req: AuthRequest, res: Response) {
    try {
      const { storyId } = req.params;
      const { emoji } = req.body;
      const userId = req.user?.userId;

      if (!userId) {
         res.status(HTTP_STATUS.UNAUTHORIZED).json({
          success: false,
          error: "User not authenticated",
        });
        return;
      }

      if (!storyId || !mongoose.Types.ObjectId.isValid(storyId)) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: "Valid story ID is required",
        });
        return;
      }

      const story = await Stories.findById(storyId);
      if (!story) {
        res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          error: "Story not found",
        });
        return;
      }

      const userObjectId = new Types.ObjectId(userId);
      const hasReacted = story.reactions.some(
        (r) => r.userId.toString() === userObjectId.toString()
      ); // Fixed: proper comparison

      if (hasReacted) {
        story.reactions = story.reactions.filter(
          (r) => r.userId.toString() !== userObjectId.toString()
        );
      } else {
        story.reactions.push({ userId, emoji });
        // Notify story author (if not self)
        if (story.authorId.toString() !== userId) {
          const sender = await User.findById(userId).select("username name");
          await NotificationService.createNotification({
            recipientId: story.authorId.toString(),
            senderId: userId,
            type: "like_story",
            message: `${
              sender?.username || sender?.name || "Someone"
            } liked your story`,
            entityType: "story",
            entityId: story._id.toString(),
            actionUrl: `/stories/${story._id}`,
          });
        }
      }

      await story.save();
      await story.populate("reactions.userId", "username avatar name");

      res.status(HTTP_STATUS.OK).json({
        success: true,
        data: {
          storyId: storyId,
          reactions: story.reactions, // Fixed: use reactions instead of likes
          reactionsCount: story.reactions.length,
          isLiked: !hasReacted,
          userId,
        },
        message: hasReacted
          ? "Reaction removed from story"
          : "Reaction added to story",
      });
    } catch (error: any) {
      console.error("Error reacting to story:", error);
       res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: "Server error",
        message: "Failed to react to story",
      });
    }
  }

  // Delete story
  static async deleteStories(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      const { storyId } = req.params;

      if (!userId) {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({
          success: false,
          error: "User not authenticated",
        });
        return;
      }

      if (!storyId || !mongoose.Types.ObjectId.isValid(storyId)) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: "Valid story ID is required",
        });
        return;
      }

      const story = await Stories.findById(storyId);
      if (!story) {
        res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          error: "story not found",
        });
        return;
      }

      if (story.authorId.toString() !== userId) {
        res.status(HTTP_STATUS.FORBIDDEN).json({
          success: false,
          error: "Not authorized to delete this story",
        });
        return;
      }

      await Stories.findByIdAndDelete(storyId);

       res.status(HTTP_STATUS.OK).json({
        success: true,
        message: "story deleted successfully",
      });
    } catch (error: any) {
      console.error("Error deleting story:", error);
       res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: "Server error",
        message: "Failed to delete story",
      });
    }
  }

  // Get story viewers (only for story owner)
  static async getStoryViewers(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      const { storyId } = req.params;

      if (!userId) {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({
          success: false,
          error: "User not authenticated",
        });
        return;
      }

      if (!storyId || !mongoose.Types.ObjectId.isValid(storyId)) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: "Valid story ID is required",
        });
        return;
      }

      const story = await Stories.findById(storyId).populate(
        "viewers",
        "username name avatar"
      );
      if (!story) {
        res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          error: "story not found",
        });
        return;
      }

      if (story.authorId.toString() !== userId) {
        res.status(HTTP_STATUS.FORBIDDEN).json({
          success: false,
          error: "You are not authorized to view this story's viewers",
        });
        return;
      }

       res.status(HTTP_STATUS.OK).json({
        success: true,
        data: {
          viewers: story.viewers,
          viewersCount: story.viewers.length,
          storyId,
          viewedAt: story.viewedAt
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

  // Set story viewer (track view)
  static async setStoryViewers(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      const { storyId } = req.params;

      if (!userId) {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({
          success: false,
          error: "User not authenticated",
        });
        return;
      }
      
      if (!storyId || !mongoose.Types.ObjectId.isValid(storyId)) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: "Valid story ID is required",
        });
        return;
      }
      
      const story = await Stories.findById(storyId);
      if (!story) {
        res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          error: "story not found",
        });
        return;
      }
      
      const userObjectId = new mongoose.Types.ObjectId(userId);
      const alreadyViewed = story.viewers.some((viewer) =>
        viewer.equals(userObjectId)
      );

      if (alreadyViewed) {
        res.status(HTTP_STATUS.OK).json({
          success: true,
          message: "View already recorded",
          data: {
            storyId,
            viewersCount: story.viewers.length,
          },
        });
        return;
      }

      story.viewers = story.viewers.filter(
        (viewers, index, self) =>
          index ===
          self.findIndex(
            (r) => r.toString() === viewers.toString()
          )
      );

      story.viewers.push(userObjectId);
      story.viewedAt = new Date(Date.now())
      await story.save();
      await story.populate("viewers", "username avatar name");

      res.status(HTTP_STATUS.OK).json({
        success: true,
        data: {
          storyId,
          viewers: story.viewers,
          viewersCount: story.viewers.length,
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

  static async getUserStories(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;

      if (!userId) {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({
          success: false,
          error: "User not authenticated",
        });
        return;
      }

      const stories = await Stories.find({ authorId: userId })
        .populate("authorId", "username name avatar")
        .populate("reactions.userId", "username name avatar") // Fixed: populate reactions instead of likes
        .sort({ createdAt: -1 });

        res.status(HTTP_STATUS.OK).json({
          success: true,
          data: stories,
          count: stories.length,
      });
    } catch (error: any) {
      console.error("Error fetching user stories:", error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: "Server error",
        message: "Failed to fetch user stories",
      });
    }
  }

  static async getTrendingStories(req: Request, res: Response) {
    try {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const stories = await Stories.find({
        createdAt: { $gte: weekAgo },
      })
        .populate("authorId", "username name avatar")
        .populate("reactions.userId", "username name avatar") // Fixed: populate reactions instead of likes
        .sort({
          reactions: -1,
        })
        .limit(20);

    res.status(HTTP_STATUS.OK).json({
        success: true,
        data: stories,
        message: "Trending stories from last 7 days",
      });
    } catch (error: any) {
      console.error("Error fetching trending stories:", error);
       res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: "Server error",
        message: "Failed to fetch trending stories",
      });
    }
  }
}
