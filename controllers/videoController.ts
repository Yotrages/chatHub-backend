import mongoose, { PipelineStage } from 'mongoose';
import { Post } from '../Models/Post.js';

export const getVideoPosts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const videoExtensions = '\\.(mp4|avi|mov|wmv|flv|webm|mpeg)$';

    const pipeline: PipelineStage[] = [
      {
        $match: {
          isDeleted: false,
          visibility: { $in: ['public', 'friends'] },
          images: {
            $elemMatch: {
              $regex: videoExtensions,
              $options: 'i',
            },
          },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'authorId',
          foreignField: '_id',
          as: 'author',
          pipeline: [
            {
              $project: {
                username: 1,
                avatar: 1,
                fullName: 1,
                isVerified: 1,
              },
            },
          ],
        },
      },
      {
        $unwind: '$author',
      },
      {
        $lookup: {
          from: 'users',
          localField: 'reactions.userId',
          foreignField: '_id',
          as: 'reactionUsers',
        },
      },
      {
        $addFields: {
          reactions: {
            $map: {
              input: '$reactions',
              as: 'reaction',
              in: {
                user: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: '$reactionUsers',
                        cond: { $eq: ['$$this._id', '$$reaction.userId'] },
                      },
                    },
                    0,
                  ],
                },
                emoji: '$$reaction.emoji',
                createdAt: '$$reaction.createdAt',
                updatedAt: '$$reaction.updatedAt',
              },
            },
          },
          videos: {
            $filter: {
              input: '$images',
              cond: {
                $regexMatch: {
                  input: '$$this',
                  regex: videoExtensions,
                  options: 'i',
                },
              },
            },
          },
          thumbnails: {
            $filter: {
              input: '$images',
              cond: {
                $not: {
                  $regexMatch: {
                    input: '$$this',
                    regex: videoExtensions,
                    options: 'i',
                  },
                },
              },
            },
          },
        },
      },
      {
        $project: {
          reactionUsers: 0,
        },
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $facet: {
          posts: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: 'count' }],
        },
      },
    ];

    const result = await Post.aggregate(pipeline);
    const posts = result[0].posts;
    const totalItems = result[0].totalCount[0]?.count || 0;
    const totalPages = Math.ceil(totalItems / limit);

    const pagination = {
      currentPage: page,
      totalPages,
      totalItems,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    };

    res.status(200).json({
      success: true,
      posts,
      pagination,
    });
  } catch (error) {
    console.error('Error fetching video posts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch video posts',
      error: error.message,
    });
  }
};

export const getTrendingVideoPosts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const videoExtensions = '\\.(mp4|avi|mov|wmv|flv|webm|mpeg)$';
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    const pipeline: PipelineStage[] = [
      {
        $match: {
          isDeleted: false,
          visibility: { $in: ['public', 'friends'] },
          createdAt: { $gte: threeDaysAgo },
          images: {
            $elemMatch: {
              $regex: videoExtensions,
              $options: 'i',
            },
          },
        },
      },
      {
        $addFields: {
          reactionCount: { $size: '$reactions' },
          engagementScore: {
            $add: [
              { $multiply: [{ $size: '$reactions' }, 2] },
              '$commentsCount',
              { $multiply: ['$shareCount', 3] },
            ],
          },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'authorId',
          foreignField: '_id',
          as: 'author',
          pipeline: [
            {
              $project: {
                username: 1,
                avatar: 1,
                fullName: 1,
                isVerified: 1,
              },
            },
          ],
        },
      },
      {
        $unwind: '$author',
      },
      {
        $lookup: {
          from: 'users',
          localField: 'reactions.userId',
          foreignField: '_id',
          as: 'reactionUsers',
        },
      },
      {
        $addFields: {
          reactions: {
            $map: {
              input: '$reactions',
              as: 'reaction',
              in: {
                user: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: '$reactionUsers',
                        cond: { $eq: ['$$this._id', '$$reaction.userId'] },
                      },
                    },
                    0,
                  ],
                },
                emoji: '$$reaction.emoji',
                createdAt: '$$reaction.createdAt',
                updatedAt: '$$reaction.updatedAt',
              },
            },
          },
          videos: {
            $filter: {
              input: '$images',
              cond: {
                $regexMatch: {
                  input: '$$this',
                  regex: videoExtensions,
                  options: 'i',
                },
              },
            },
          },
        },
      },
      {
        $project: {
          reactionUsers: 0,
        },
      },
      {
        $sort: {
          engagementScore: -1,
          createdAt: -1,
        },
      },
      {
        $facet: {
          posts: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: 'count' }],
        },
      },
    ];

    const result = await Post.aggregate(pipeline);
    const posts = result[0].posts;
    const totalItems = result[0].totalCount[0]?.count || 0;
    const totalPages = Math.ceil(totalItems / limit);

    const pagination = {
      currentPage: page,
      totalPages,
      totalItems,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    };

    res.status(200).json({
      success: true,
      posts,
      pagination,
    });
  } catch (error) {
    console.error('Error fetching trending video posts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch trending video posts',
      error: error.message,
    });
  }
};

export const getVideoPostById = async (req, res) => {
  try {
    const { postId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid post ID',
      });
    }

    const videoExtensions = '\\.(mp4|avi|mov|wmv|flv|webm|mpeg)$';

    const pipeline: PipelineStage[] = [
      // Stage 1: Match specific post
      {
        $match: {
          _id: new mongoose.Types.ObjectId(postId),
          isDeleted: false,
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'authorId',
          foreignField: '_id',
          as: 'author',
          pipeline: [
            {
              $project: {
                username: 1,
                avatar: 1,
                fullName: 1,
                isVerified: 1,
              },
            },
          ],
        },
      },
      {
        $unwind: '$author',
      },
      {
        $lookup: {
          from: 'users',
          localField: 'reactions.userId',
          foreignField: '_id',
          as: 'reactionUsers',
        },
      },
      {
        $addFields: {
          reactions: {
            $map: {
              input: '$reactions',
              as: 'reaction',
              in: {
                user: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: '$reactionUsers',
                        cond: { $eq: ['$$this._id', '$$reaction.userId'] },
                      },
                    },
                    0,
                  ],
                },
                emoji: '$$reaction.emoji',
                createdAt: '$$reaction.createdAt',
                updatedAt: '$$reaction.updatedAt',
              },
            },
          },
          videos: {
            $filter: {
              input: '$images',
              cond: {
                $regexMatch: {
                  input: '$$this',
                  regex: videoExtensions,
                  options: 'i',
                },
              },
            },
          },
        },
      },
      {
        $project: {
          reactionUsers: 0,
        },
      },
    ];

    const result = await Post.aggregate(pipeline);
    const post = result[0];

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Video post not found',
      });
    }

    if (!post.videos || post.videos.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Post does not contain video content',
      });
    }

    res.status(200).json({
      success: true,
      post,
    });
  } catch (error) {
    console.error('Error fetching video post:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch video post',
      error: error.message,
    });
  }
};