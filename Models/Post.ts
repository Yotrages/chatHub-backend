import mongoose, { Schema } from "mongoose";
import { IComment, IPost } from "../types";

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

const commentSchema = new Schema<IComment>({
  dynamicId: {
    type: Schema.Types.ObjectId,
    ref: 'Post',
    required: true
  },
  parentCommentId: {
    type: Schema.Types.ObjectId,
    ref: 'Comment',
    default: null 
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
  isDeleted: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

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
  visibility: {
    type: String,
    enum: ['public', 'friends', 'private'],
    default: 'public'
  },
  isDeleted: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

commentSchema.index({ dynamicId: 1, parentCommentId: 1, createdAt: -1 });
commentSchema.index({ authorId: 1 });
postSchema.index({ authorId: 1, createdAt: -1 });
postSchema.index({ createdAt: -1 });
postSchema.index({ content: 'text' });

export const Comment = mongoose.model("Comment", commentSchema);
export const Post = mongoose.model("Post", postSchema);