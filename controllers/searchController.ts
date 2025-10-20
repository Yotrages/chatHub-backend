import { Request, Response } from "express";
import { Post } from "../Models/Post";
import { Reels } from "../Models/Reels";
import { User } from "../Models/User";
import { Stories } from "../Models/Stories";
import { SearchHistory } from "../Models/Search";
import { HTTP_STATUS } from "../utils/constant";
import { SortOrder } from "mongoose";

interface PaginationOptions {
  page: number;
  limit: number;
  skip: number;
}

interface PaginationResult {
  page: number;
  limit: number;
  total: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  totalPages: number;
}

export class SearchController {
  private static getPaginationOptions(req: Request): PaginationOptions {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      50,
      Math.max(1, parseInt(req.query.limit as string) || 20)
    );
    const skip = (page - 1) * limit;

    return { page, limit, skip };
  }

  private static createPaginationResult(
    page: number,
    limit: number,
    total: number
  ): PaginationResult {
    const totalPages = Math.ceil(total / limit);
    return {
      page,
      limit,
      total,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      totalPages,
    };
  }

  private static getSortOption(
    sortBy?: string,
    useTextSearch: boolean = false
  ): Record<string, SortOrder | { $meta: string }> {
    switch (sortBy) {
      case "recent":
        return { createdAt: -1 };
      case "popular":
        return { reactions: -1, createdAt: -1 };
      case "relevant":
      default:
        if (useTextSearch) {
          return { score: { $meta: "textScore" }, createdAt: -1 };
        }
        return { createdAt: -1 };
    }
  }

  static async searchAll(req: Request, res: Response) {
    const { query, type, sortBy } = req.query;

    if (!query || typeof query !== "string" || query.trim().length < 1) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: "Query parameter is required and must be a non-empty string",
      });
      return;
    }

    try {
      const trimmedQuery = query.trim();
      const { page, limit, skip } = SearchController.getPaginationOptions(req);
      const userId = req.user?.userId;

      const useTextSearch = sortBy === "relevant";
      const sortOption = SearchController.getSortOption(
        sortBy as string,
        useTextSearch
      );

      if (userId) {
        await SearchController.trackSearch(trimmedQuery, userId);
      }
      let searchCriteria;

      if (useTextSearch) {
        searchCriteria = {
          posts: { $text: { $search: trimmedQuery } },
          reels: { $text: { $search: trimmedQuery } },
          users: { $text: { $search: trimmedQuery } },
          stories: { $text: { $search: trimmedQuery } },
        };
      } else {
        const searchRegex = { $regex: trimmedQuery, $options: "i" };
        searchCriteria = {
          posts: {
            $or: [
              { content: searchRegex },
              { "authorId.username": searchRegex },
            ],
          },
          reels: {
            $or: [{ title: searchRegex }, { "authorId.username": searchRegex }],
          },
          users: {
            $or: [{ username: searchRegex }, { bio: searchRegex }],
          },
          stories: {
            $or: [{ text: searchRegex }, { "authorId.username": searchRegex }],
          },
        };
      }

      const textScoreProjection = useTextSearch
        ? { score: { $meta: "textScore" } }
        : {};

      let results = { posts: [], reels: [], users: [], stories: [] };
      let pagination = {
        posts: {
          page: 1,
          limit,
          total: 0,
          hasNextPage: false,
          hasPrevPage: false,
          totalPages: 0,
        },
        reels: {
          page: 1,
          limit,
          total: 0,
          hasNextPage: false,
          hasPrevPage: false,
          totalPages: 0,
        },
        users: {
          page: 1,
          limit,
          total: 0,
          hasNextPage: false,
          hasPrevPage: false,
          totalPages: 0,
        },
        stories: {
          page: 1,
          limit,
          total: 0,
          hasNextPage: false,
          hasPrevPage: false,
          totalPages: 0,
        },
      };

      if (!type || type === "all") {
        const overviewLimit = Math.min(limit, 10);

        const [posts, postsTotal] = await Promise.all([
          Post.find(searchCriteria.posts, textScoreProjection)
            .populate("authorId", "username avatar isVerified")
            .populate("reactions.userId", "username avatar")
            .sort(sortOption)
            .limit(overviewLimit)
            .lean(),
          Post.countDocuments(searchCriteria.posts),
        ]);

        const [reels, reelsTotal] = await Promise.all([
          Reels.find(searchCriteria.reels, textScoreProjection)
            .populate("authorId", "username avatar isVerified")
            .populate("reactions.userId", "username avatar")
            .sort(sortOption)
            .limit(overviewLimit)
            .lean(),
          Reels.countDocuments(searchCriteria.reels),
        ]);

        const [users, usersTotal] = await Promise.all([
          User.find(searchCriteria.users, {
            ...textScoreProjection,
            password: 0,
            provider: 0,
            providerId: 0,
          })
            .sort(
              sortBy === "popular"
                ? { followersCount: -1 as const }
                : useTextSearch
                ? sortOption
                : { createdAt: -1 as const }
            )
            .limit(overviewLimit)
            .lean(),
          User.countDocuments(searchCriteria.users),
        ]);

        const [stories, storiesTotal] = await Promise.all([
          Stories.find(searchCriteria.stories, textScoreProjection)
            .populate("authorId", "username avatar isVerified")
            .sort(sortOption)
            .limit(overviewLimit)
            .lean(),
          Stories.countDocuments(searchCriteria.stories),
        ]);

        results = { posts, reels, users, stories };
        pagination = {
          posts: SearchController.createPaginationResult(
            1,
            overviewLimit,
            postsTotal
          ),
          reels: SearchController.createPaginationResult(
            1,
            overviewLimit,
            reelsTotal
          ),
          users: SearchController.createPaginationResult(
            1,
            overviewLimit,
            usersTotal
          ),
          stories: SearchController.createPaginationResult(
            1,
            overviewLimit,
            storiesTotal
          ),
        };
      } else {
        switch (type) {
          case "posts":
            const [posts, postsTotal] = await Promise.all([
              Post.find(searchCriteria.posts, textScoreProjection)
                .populate("authorId", "username avatar isVerified")
                .populate("reactions.userId", "username avatar")
                .sort(sortOption)
                .skip(skip)
                .limit(limit)
                .lean(),
              Post.countDocuments(searchCriteria.posts),
            ]);
            results.posts = posts;
            pagination.posts = SearchController.createPaginationResult(
              page,
              limit,
              postsTotal
            );
            break;

          case "reels":
            const [reels, reelsTotal] = await Promise.all([
              Reels.find(searchCriteria.reels, textScoreProjection)
                .populate("authorId", "username avatar isVerified")
                .populate("reactions.userId", "username avatar")
                .sort(sortOption)
                .skip(skip)
                .limit(limit)
                .lean(),
              Reels.countDocuments(searchCriteria.reels),
            ]);
            results.reels = reels;
            pagination.reels = SearchController.createPaginationResult(
              page,
              limit,
              reelsTotal
            );
            break;

          case "users":
            const userSort =
              sortBy === "popular"
                ? { followersCount: -1 as const, createdAt: -1 as const }
                : useTextSearch
                ? sortOption
                : { createdAt: -1 as const };

            const [users, usersTotal] = await Promise.all([
              User.find(searchCriteria.users, {
                ...textScoreProjection,
                password: 0,
                provider: 0,
                providerId: 0,
              })
                .sort(userSort)
                .skip(skip)
                .limit(limit)
                .lean(),
              User.countDocuments(searchCriteria.users),
            ]);
            results.users = users;
            pagination.users = SearchController.createPaginationResult(
              page,
              limit,
              usersTotal
            );
            break;

          case "stories":
            const [stories, storiesTotal] = await Promise.all([
              Stories.find(searchCriteria.stories, textScoreProjection)
                .populate("authorId", "username avatar isVerified")
                .sort(sortOption)
                .skip(skip)
                .limit(limit)
                .lean(),
              Stories.countDocuments(searchCriteria.stories),
            ]);
            results.stories = stories;
            pagination.stories = SearchController.createPaginationResult(
              page,
              limit,
              storiesTotal
            );
            break;

          default:
            res.status(HTTP_STATUS.BAD_REQUEST).json({
              error:
                "Invalid type parameter. Must be one of: posts, reels, users, stories",
            });
            return;
        }
      }

      const totalResults =
        results.posts.length +
        results.reels.length +
        results.users.length +
        results.stories.length;

      res.status(HTTP_STATUS.OK).json({
        success: true,
        results,
        total: totalResults,
        pagination,
        query: trimmedQuery,
        type: type || "all",
        sortBy: sortBy || "relevant",
      });
    } catch (err: any) {
      console.error("Search error:", err);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: "Server Error",
        message: err.message,
      });
    }
  }

   static async getSuggestions(req: Request, res: Response) {
    const { query } = req.query;

    if (!query || typeof query !== "string" || query.trim().length < 2) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: "Query parameter is required and must be at least 2 characters",
      });
      return;
    }

    try {
      const trimmedQuery = query.trim();
      const searchRegex = { $regex: `^${trimmedQuery}`, $options: "i" };
      const userId = req.user?.userId;

      const userSuggestions = await User.find({
        $or: [{ username: searchRegex }, { bio: searchRegex }],
      })
        .select("username avatar isVerified")
        .limit(5)
        .lean();

      const hashtagPattern = new RegExp(`#\\w*${trimmedQuery}\\w*`, "gi");
      const postsWithHashtags = await Post.find({
        content: hashtagPattern,
      })
        .select("content")
        .limit(20)
        .lean();

      const hashtags = new Set<string>();
      postsWithHashtags.forEach((post) => {
        const matches = post.content.match(/#\w+/g);
        if (matches) {
          matches.forEach((tag) => {
            if (tag.toLowerCase().includes(trimmedQuery.toLowerCase())) {
              hashtags.add(tag);
            }
          });
        }
      });

      let recentSearches: string[] = [];
      if (userId) {
        const userRecentSearches = await SearchHistory.find({
          userId,
          query: { $regex: trimmedQuery, $options: "i" },
        })
          .sort({ lastSearched: -1 })
          .limit(5)
          .select("query")
          .lean();
        
        recentSearches = userRecentSearches.map((s) => s.query);
      }

      res.status(HTTP_STATUS.OK).json({
        success: true,
        suggestions: {
          users: userSuggestions,
          hashtags: Array.from(hashtags).slice(0, 5),
          recent: recentSearches,
        },
      });
    } catch (err: any) {
      console.error("Suggestions error:", err);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: "Server Error",
      });
    }
  }


  static async getTrending(req: Request, res: Response) {
    try {
      const { limit = 10 } = req.query;
      const limitNum = Math.min(50, Math.max(1, parseInt(limit as string)));

      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const trendingSearches = await SearchHistory.aggregate([
        {
          $match: {
            lastSearched: { $gte: weekAgo },
          },
        },
        {
          $group: {
            _id: "$query",
            totalCount: { $sum: "$count" },
            userCount: { $sum: 1 },
            lastSearched: { $max: "$lastSearched" },
          },
        },
        {
          $sort: { totalCount: -1 },
        },
        {
          $limit: limitNum,
        },
        {
          $project: {
            query: "$_id",
            count: "$totalCount",
            users: "$userCount",
            lastSearched: 1,
            _id: 0,
          },
        },
      ]);

      const recentPosts = await Post.find({
        createdAt: { $gte: weekAgo },
        content: /#\w+/,
      })
        .select("content reactions")
        .lean();

      const hashtagCounts = new Map<string, number>();
      recentPosts.forEach((post) => {
        const hashtags = post.content.match(/#\w+/g);
        if (hashtags) {
          hashtags.forEach((tag) => {
            const count = hashtagCounts.get(tag) || 0;
            hashtagCounts.set(tag, count + 1 + (post.reactions?.length || 0));
          });
        }
      });

      const trendingHashtags = Array.from(hashtagCounts.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, limitNum)
        .map(([hashtag, count]) => ({ hashtag, count }));

      res.status(HTTP_STATUS.OK).json({
        success: true,
        trending: {
          searches: trendingSearches,
          hashtags: trendingHashtags,
        },
      });
    } catch (err: any) {
      console.error("Trending error:", err);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: "Server Error",
      });
    }
  }

  static async trackSearch(query: string, userId: string) {
    try {
      if (!userId) {
        console.warn("Cannot track search without userId");
        return;
      }

      const existing = await SearchHistory.findOneAndUpdate(
        {
          userId,
          query: query.toLowerCase().trim(),
        },
        {
          $inc: { count: 1 },
          $set: { lastSearched: new Date() },
        },
        { upsert: true, new: true }
      );

      console.log(
        `Tracked search for user ${userId}: ${query}, Count: ${existing.count}`
      );
    } catch (err) {
      console.error("Error tracking search:", err);
    }
  }

  static async getFrequentSearches(req: Request, res: Response) {
    try {
      const { limit = 10 } = req.query;
      const limitNum = Math.min(50, Math.max(1, parseInt(limit as string)));
      const userId = req.user?.userId;

      if (!userId) {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: "User must be authenticated",
        });
        return;
      }

      const frequentSearches = await SearchHistory.find({ userId })
        .sort({ count: -1, lastSearched: -1 })
        .limit(limitNum)
        .select("query count lastSearched")
        .lean();

      res.status(HTTP_STATUS.OK).json({
        success: true,
        searches: frequentSearches,
      });
    } catch (err) {
      console.error("Error fetching frequent searches:", err);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: "Failed to fetch frequent searches",
      });
    }
  }


  static async getSearchStats(req: Request, res: Response) {
    try {
      const { days = 30 } = req.query;
      const daysNum = Math.min(365, Math.max(1, parseInt(days as string)));
      const userId = req.user?.userId;

      if (!userId) {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: "User must be authenticated",
        });
        return;
      }

      const dateFrom = new Date();
      dateFrom.setDate(dateFrom.getDate() - daysNum);

      const stats = await SearchHistory.aggregate([
        {
          $match: {
            userId: userId,
            lastSearched: { $gte: dateFrom },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$lastSearched",
              },
            },
            totalSearches: { $sum: "$count" },
            uniqueQueries: { $sum: 1 },
          },
        },
        {
          $sort: { _id: 1 },
        },
      ]);

      const topQueries = await SearchHistory.find({
        userId,
        lastSearched: { $gte: dateFrom },
      })
        .sort({ count: -1 })
        .limit(20)
        .select("query count lastSearched");

      res.status(HTTP_STATUS.OK).json({
        success: true,
        stats: {
          dailyStats: stats,
          topQueries: topQueries,
          period: `${daysNum} days`,
        },
      });
    } catch (err) {
      console.error("Error fetching search stats:", err);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: "Failed to fetch search statistics",
      });
    }
  }


  static async clearSearchHistory(req: Request, res: Response) {
    try {
      const userId = req.user?.userId;

      if (!userId) {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: "User must be authenticated",
        });
        return;
      }

      const result = await SearchHistory.deleteMany({ userId });

      res.status(HTTP_STATUS.OK).json({
        success: true,
        message: `Cleared ${result.deletedCount} search entries`,
        deletedCount: result.deletedCount,
      });
    } catch (err) {
      console.error("Error clearing search history:", err);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: "Failed to clear search history",
      });
    }
  }

  static async deleteSearchEntry(req: Request, res: Response) {
    try {
      const { searchId } = req.params;
      const userId = req.user?.userId;

      if (!userId) {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: "User must be authenticated",
        });
        return;
      }

      const result = await SearchHistory.findOneAndDelete({
        _id: searchId,
        userId, 
      });

      if (!result) {
        res.status(HTTP_STATUS.NOT_FOUND).json({
          error: "Search entry not found or does not belong to user",
        });
        return;
      }

      res.status(HTTP_STATUS.OK).json({
        success: true,
        message: "Search entry deleted successfully",
      });
    } catch (err) {
      console.error("Error deleting search entry:", err);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: "Failed to delete search entry",
      });
    }
  }


}

export default SearchController;
