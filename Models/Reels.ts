import mongoose, { Schema } from "mongoose";
import { IComment, IReels } from "../types";

const reactionSchema = new Schema(
  {
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
  },
  { timestamps: true }
);

const commentSchema = new Schema<IComment>(
  {
    dynamicId: {
      type: Schema.Types.ObjectId,
      ref: "Reels",
      required: true,
    },
    parentCommentId: {
      type: Schema.Types.ObjectId,
      ref: "Comment",
      default: null, 
    },
    authorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    content: {
      type: String,
      required: true,
      maxlength: [2000, "Comment cannot exceed 2000 characters"],
    },
    file: {
      type: String,
      sparse: true,
    },
    reactions: [reactionSchema],
    repliesCount: {
      type: Number,
      default: 0,
    },
    isEdited: {
      type: Boolean,
      default: false,
    },
    editedAt: {
      type: Date,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const reelsSchema = new Schema<IReels>(
  {
    fileUrl: {
      type: String,
      required: true,
    },
    title: {
      type: String,
    },
    viewers: [
      {
        viewer: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
        viewedAt: {
          type: Date,
        },
      },
    ],
    authorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reactions: [reactionSchema],
    shareCount: { type: Number, default: 0 },
    commentsCount: {
      type: Number,
      default: 0,
    },
    visibility: {
      type: String,
      enum: ["public", "friends", "private"],
      default: "public",
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

commentSchema.index({ dynamicId: 1, parentCommentId: 1, createdAt: -1 });
commentSchema.index({ authorId: 1 });

reelsSchema.index({ authorId: 1, createdAt: -1 });
reelsSchema.index({ title: 'text' });

export const ReelComment = mongoose.model("ReelComment", commentSchema);
export const Reels = mongoose.model("Reels", reelsSchema);
