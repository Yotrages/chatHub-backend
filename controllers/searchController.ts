import { Request, Response } from "express";
import { Post } from "../Models/Post";
import { Reels } from "../Models/Reels";
import { User } from "../Models/User";
import { Stories } from "../Models/Stories";
import { SearchHistory } from "../Models/Search";
import { HTTP_STATUS } from "../utils/constant";

export class SearchController {
  static async searchAll(req: Request, res: Response) {
    const { query } = req.query;

    if (!query || typeof query !== "string" || query.trim().length < 1) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: "Query parameter is required and must be a non-empty string" });
      return;
    }

    try {
      const trimmedQuery = query.trim();
      await SearchController.trackSearch(trimmedQuery);

      const posts = await Post.find({
        content: { $regex: trimmedQuery, $options: "i" },
      })
        .populate("authorId", "username avatar")
        .populate("reactions.userId", "username name avatar")
        .populate({
          path: "comments",
          populate: {
            path: "authorId",
            select: "username avatar",
          },
          options: { sort: { createdAt: -1 } },
        })
        .populate("comments.reactions.userId", "username avatar")
        .populate("comments.replies.authorId", "username avatar")
        .populate("comments.replies.reactions.userId", "username avatar")
        .populate("comments.replies.replies.authorId", "username avatar")
        .populate("comments.replies.replies.reactions.userId", "username avatar")
        .limit(10)
        .lean();

      const reels = await Reels.find({
        $or: [
          { fileUrl: { $regex: trimmedQuery, $options: "i" } },
          { title: { $regex: trimmedQuery, $options: "i" } },
          { "comments.content": { $regex: trimmedQuery, $options: "i" } },
        ],
      })
        .populate("authorId", "username name avatar")
        .select("fileUrl authorId createdAt")
        .limit(10)
        .lean();

      const users = await User.find({
        $or: [
          { username: { $regex: trimmedQuery, $options: "i" } },
          { name: { $regex: trimmedQuery, $options: "i" } },
          { bio: { $regex: trimmedQuery, $options: "i" } },
        ],
      })
        .select("username name avatar bio followersCount followingCount")
        .limit(10)
        .lean();

      const stories = await Stories.find({
        $or: [
          { text: { $regex: trimmedQuery, $options: "i" } },
          { fileUrl: { $regex: trimmedQuery, $options: "i" } },
        ],
      })
        .populate("authorId", "username name avatar")
        .select("fileUrl text authorId createdAt")
        .limit(10)
        .lean();

      const allSearchResult = { posts, reels, users, stories };

      res.status(HTTP_STATUS.OK).json({
        success: true,
        results: allSearchResult,
        total: posts.length + reels.length + users.length + stories.length,
      });
    } catch (err: any) {
      console.error("Search error:", err);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: "Server Error" });
    }
  }

  static async trackSearch(query: string) {
    try {
      const existing = await SearchHistory.findOneAndUpdate(
        { query: query.toLowerCase() },
        { $inc: { count: 1 }, $set: { lastSearched: new Date() } },
        { upsert: true, new: true }
      );
      console.log(`Tracked search: ${query}, Count: ${existing.count}`);
    } catch (err) {
      console.error("Error tracking search:", err);
    }
  }

  static async getFrequentSearches(req: Request, res: Response) {
    try {
      const frequentSearches = await SearchHistory.find()
        .sort({ count: -1, lastSearched: -1 })
        .limit(10)
        .select("query count lastSearched");
      res.status(HTTP_STATUS.OK).json({ success: true, searches: frequentSearches });
    } catch (err) {
      console.error("Error fetching frequent searches:", err);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: "Failed to fetch frequent searches" });
    }
  }
}

export default SearchController;
