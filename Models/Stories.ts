import mongoose, { Schema, Types } from "mongoose";
import { IStories } from "../types";

const storiesSchema = new Schema<IStories>({
  fileType: {
    type: String,
    enum: ["image", "video"],
    required: true,
    default: "video",
  },
  fileUrl: {
    type: String,
    required: true
  },
  textStyle: {
    type: String,
  },
  text: {
    type: String,
    sparse: true,
    trim: true,
  },
  viewers: [{
    viewer: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    viewedAt: {
      type: Date
    }
}],
  authorId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  reactions: [{
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    emoji: {
      type: String,
      required: true,
    },
  }],
  textPosition: {
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
  },
  background: {
    type: String,
    default: "",
  },
}, { timestamps: true });

storiesSchema.index({ authorId: 1 });

export const Stories = mongoose.model("Stories", storiesSchema);