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

// Comment schema with self-referencing for unlimited nesting
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
      default: null, // null means it's a top-level comment
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
    // For soft delete
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
    viewers: [{
        type: Schema.Types.ObjectId,
        ref: "User"
      }],
      viewedAt: {
    type: Date
  },
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
    // For soft delete
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

// commentSchema.post('save', async function() {
//   if (this.isNew && !this.isDeleted) {
//     // Update post comment count
//     await mongoose.model('Reels').findByIdAndUpdate(
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

export const ReelComment = mongoose.model("ReelComment", commentSchema);
export const Reels = mongoose.model("Reels", reelsSchema);
