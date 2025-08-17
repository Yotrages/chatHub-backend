import mongoose, { Schema } from "mongoose";
import { IComment, IPost } from "../types";

// Reaction schema for likes, loves, etc.
const reactionSchema = new Schema({
  userId: {
          type: Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        emoji: {
          category: {
            type: String,
            required: true,
          },
          name: {
            type: String,
            required: true,
          },
        },
}, { timestamps: true });

// Comment schema with self-referencing for unlimited nesting
const commentSchema = new Schema<IComment>({
  dynamicId: {
    type: Schema.Types.ObjectId,
    ref: 'Post',
    required: true
  },
  parentCommentId: {
    type: Schema.Types.ObjectId,
    ref: 'Comment',
    default: null // null means it's a top-level comment
  },
  authorId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true,
    maxlength: [2000, "Comment cannot exceed 2000 characters"]
  },
file: {
      type: String,
      sparse: true,
    },
  reactions: [reactionSchema],
  repliesCount: {
    type: Number,
    default: 0
  },
  isEdited: {
    type: Boolean,
    default: false
  },
  editedAt: {
    type: Date
  },
  // For soft delete
  isDeleted: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

// Post schema
const postSchema = new Schema<IPost>({
  authorId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true,
    maxlength: [10000, "Post cannot exceed 5000 characters"]
  },
  images: [
      {
        type: String,
        validate: {
          validator: function (v) {
            return /\.(jpg|jpeg|png|gif|bmp|webp|mp4|avi|mov|wmv|flv|webm|mp3|mpeg)$/i.test(
              v
            );
          },
          message: "Invalid media URL format",
        },
      },
    ],
  reactions: [reactionSchema],
  commentsCount: {
    type: Number,
    default: 0
  },
    shareCount: { type: Number, default: 0 }, 

  isEdited: {
    type: Boolean,
    default: false
  },
  editedAt: {
    type: Date
  },
  // Privacy settings
  visibility: {
    type: String,
    enum: ['public', 'friends', 'private'],
    default: 'public'
  },
  // For soft delete
  isDeleted: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

// Indexes for better performance
commentSchema.index({ dynamicId: 1, parentCommentId: 1, createdAt: -1 });
commentSchema.index({ authorId: 1 });
postSchema.index({ authorId: 1, createdAt: -1 });
postSchema.index({ createdAt: -1 });

// Middleware to update counts
// commentSchema.post('save', async function() {
//   if (this.isNew && !this.isDeleted) {
//     // Update post comment count
//     await mongoose.model('Post').findByIdAndUpdate(
//       this.dynamicId,
//       { $inc: { commentsCount: 1 } }
//     );
    
//     // Update parent comment reply count if it's a reply
//     if (this.parentCommentId) {
//       await mongoose.model('Comment').findByIdAndUpdate(
//         this.parentCommentId,
//         { $inc: { repliesCount: 1 } }
//       );
//     }
//   }
// });

export const Comment = mongoose.model("Comment", commentSchema);
export const Post = mongoose.model("Post", postSchema);