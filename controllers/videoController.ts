// // controllers/videoController.js
// import mongoose from 'mongoose';
// import { Post } from '../Models/Post.js';

// export const getVideoPosts = async (req, res) => {
//   try {
//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 10;
//     const skip = (page - 1) * limit;

//     // Define video file extensions
//     const videoExtensions = /\.(mp4|avi|mov|wmv|flv|webm|mpeg)$/i;

//     // Aggregation pipeline to filter posts with video content
//     const pipeline = [
//       {
//         $match: {
//           isDeleted: false,
//           visibility: { $in: ['public', 'friends'] }, // Adjust based on user's visibility preferences
//           images: {
//             $elemMatch: {
//               $regex: videoExtensions
//             }
//           }
//         }
//       },
//       {
//         $lookup: {
//           from: 'users',
//           localField: 'authorId',
//           foreignField: '_id',
//           as: 'author',
//           pipeline: [
//             {
//               $project: {
//                 username: 1,
//                 avatar: 1,
//                 fullName: 1,
//                 isVerified: 1
//               }
//             }
//           ]
//         }
//       },
//       {
//         $unwind: '$author'
//       },
//       {
//         $lookup: {
//           from: 'users',
//           localField: 'reactions.userId',
//           foreignField: '_id',
//           as: 'reactionUsers'
//         }
//       },
//       {
//         $addFields: {
//           reactions: {
//             $map: {
//               input: '$reactions',
//               as: 'reaction',
//               in: {
//                 userId: {
//                   $arrayElemAt: [
//                     {
//                       $filter: {
//                         input: '$reactionUsers',
//                         cond: { $eq: ['$$this._id', '$$reaction.userId'] }
//                       }
//                     },
//                     0
//                   ]
//                 },
//                 emoji: '$$reaction.emoji',
//                 createdAt: '$$reaction.createdAt'
//               }
//             }
//           },
//           // Extract only video files from images array
//           videos: {
//             $filter: {
//               input: '$images',
//               cond: {
//                 $regexMatch: {
//                   input: '$$this',
//                   regex: videoExtensions
//                 }
//               }
//             }
//           },
//           // Keep non-video images separate if needed
//           thumbnails: {
//             $filter: {
//               input: '$images',
//               cond: {
//                 $not: {
//                   $regexMatch: {
//                     input: '$$this',
//                     regex: videoExtensions
//                   }
//                 }
//               }
//             }
//           }
//         }
//       },
//       {
//         $project: {
//           reactionUsers: 0 // Remove the temporary field
//         }
//       },
//       {
//         $sort: { createdAt: -1 }
//       },
//       {
//         $facet: {
//           posts: [
//             { $skip: skip },
//             { $limit: limit }
//           ],
//           totalCount: [
//             { $count: 'count' }
//           ]
//         }
//       }
//     ];

//     const result = await Post.aggregate(pipeline);
//     const posts = result[0].posts;
//     const totalItems = result[0].totalCount[0]?.count || 0;
//     const totalPages = Math.ceil(totalItems / limit);

//     const pagination = {
//       currentPage: page,
//       totalPages,
//       totalItems,
//       hasNextPage: page < totalPages,
//       hasPrevPage: page > 1
//     };

//     res.status(200).json({
//       success: true,
//       posts,
//       pagination
//     });

//   } catch (error) {
//     console.error('Error fetching video posts:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch video posts',
//       error: error.message
//     });
//   }
// };

// // Get trending video posts (based on recent reactions and comments)
// export const getTrendingVideoPosts = async (req, res) => {
//   try {
//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 10;
//     const skip = (page - 1) * limit;

//     const videoExtensions = /\.(mp4|avi|mov|wmv|flv|webm|mpeg)$/i;
//     const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

//     const pipeline = [
//       {
//         $match: {
//           isDeleted: false,
//           visibility: { $in: ['public', 'friends'] },
//           createdAt: { $gte: threeDaysAgo }, // Only recent posts
//           images: {
//             $elemMatch: {
//               $regex: videoExtensions
//             }
//           }
//         }
//       },
//       {
//         $addFields: {
//           reactionCount: { $size: '$reactions' },
//           engagementScore: {
//             $add: [
//               { $multiply: [{ $size: '$reactions' }, 2] }, // Reactions worth 2 points
//               '$commentsCount', // Comments worth 1 point
//               { $multiply: ['$shareCount', 3] } // Shares worth 3 points
//             ]
//           }
//         }
//       },
//       {
//         $lookup: {
//           from: 'users',
//           localField: 'authorId',
//           foreignField: '_id',
//           as: 'author',
//           pipeline: [
//             {
//               $project: {
//                 username: 1,
//                 avatar: 1,
//                 fullName: 1,
//                 isVerified: 1
//               }
//             }
//           ]
//         }
//       },
//       {
//         $unwind: '$author'
//       },
//       {
//         $addFields: {
//           videos: {
//             $filter: {
//               input: '$images',
//               cond: {
//                 $regexMatch: {
//                   input: '$$this',
//                   regex: videoExtensions
//                 }
//               }
//             }
//           }
//         }
//       },
//       {
//         $sort: { 
//           engagementScore: -1,
//           createdAt: -1 
//         }
//       },
//       {
//         $facet: {
//           posts: [
//             { $skip: skip },
//             { $limit: limit }
//           ],
//           totalCount: [
//             { $count: 'count' }
//           ]
//         }
//       }
//     ];

//     const result = await Post.aggregate(pipeline);
//     const posts = result[0].posts;
//     const totalItems = result[0].totalCount[0]?.count || 0;
//     const totalPages = Math.ceil(totalItems / limit);

//     const pagination = {
//       currentPage: page,
//       totalPages,
//       totalItems,
//       hasNextPage: page < totalPages,
//       hasPrevPage: page > 1
//     };

//     res.status(200).json({
//       success: true,
//       posts,
//       pagination
//     });

//   } catch (error) {
//     console.error('Error fetching trending video posts:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch trending video posts',
//       error: error.message
//     });
//   }
// };

// // Get video post by ID with enhanced details
// export const getVideoPostById = async (req, res) => {
//   try {
//     const { postId } = req.params;

//     const pipeline = [
//       {
//         $match: {
//           _id: new mongoose.Types.ObjectId(postId),
//           isDeleted: false
//         }
//       },
//       {
//         $lookup: {
//           from: 'users',
//           localField: 'authorId',
//           foreignField: '_id',
//           as: 'author'
//         }
//       },
//       {
//         $unwind: '$author'
//       },
//       {
//         $lookup: {
//           from: 'users',
//           localField: 'reactions.userId',
//           foreignField: '_id',
//           as: 'reactionUsers'
//         }
//       },
//       {
//         $addFields: {
//           reactions: {
//             $map: {
//               input: '$reactions',
//               as: 'reaction',
//               in: {
//                 userId: {
//                   $arrayElemAt: [
//                     {
//                       $filter: {
//                         input: '$reactionUsers',
//                         cond: { $eq: ['$$this._id', '$$reaction.userId'] }
//                       }
//                     },
//                     0
//                   ]
//                 },
//                 emoji: '$$reaction.emoji',
//                 createdAt: '$$reaction.createdAt'
//               }
//             }
//           },
//           videos: {
//             $filter: {
//               input: '$images',
//               cond: {
//                 $regexMatch: {
//                   input: '$$this',
//                   regex: /\.(mp4|avi|mov|wmv|flv|webm|mpeg)$/i
//                 }
//               }
//             }
//           }
//         }
//       },
//       {
//         $project: {
//           reactionUsers: 0
//         }
//       }
//     ];

//     const result = await Post.aggregate(pipeline);
//     const post = result[0];

//     if (!post) {
//       return res.status(404).json({
//         success: false,
//         message: 'Video post not found'
//       });
//     }

//     // Check if post actually contains videos
//     if (!post.videos || post.videos.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: 'Post does not contain video content'
//       });
//     }

//     res.status(200).json({
//       success: true,
//       post
//     });

//   } catch (error) {
//     console.error('Error fetching video post:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch video post',
//       error: error.message
//     });
//   }
// };