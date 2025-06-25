import mongoose, { Schema } from 'mongoose';
import { IPost, IComment, IReply } from '../types';


const replySchema = new Schema<IReply>({
  authorId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  content: {
    type: String,
    required: [true, 'Reply content is required'],
    trim: true,
    maxlength: [500, 'Reply cannot exceed 500 characters'],
  },
  likes: [{
    type: Schema.Types.ObjectId,
    ref: 'User',
  }],
  replies: [{
    type: Schema.Types.Mixed
  }] // Change this to embed the schema directly
}, { timestamps: true });


const commentSchema = new Schema<IComment>({
  authorId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  content: {
    type: String,
    required: [true, 'Comment content is required'],
    trim: true,
    maxlength: [500, 'Comment cannot exceed 500 characters'],
  },  
  likes: [{
    type: Schema.Types.ObjectId,
    ref: 'User',
  }],
  replies: [replySchema]
}, {timestamps: true});

const postSchema = new Schema<IPost>({
  authorId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  content: {
    type: String,
    required: [true, 'Post content is required'],
    trim: true,
    maxlength: [2000, 'Post cannot exceed 2000 characters'],
  },
// Instead of just checking for image extensions
images: [{
  type: String,
  validate: {
    validator: function(v) {
      // Accept both image and video formats
      return /\.(jpg|jpeg|png|gif|bmp|webp|mp4|avi|mov|wmv|flv|webm)$/i.test(v);
    },
    message: 'Invalid media URL format'
  }
}],
  likes: [{
    type: Schema.Types.ObjectId,
    ref: 'User',
  }],
  comments: [commentSchema],
}, {
  timestamps: true,
});

// Indexes for better performance
postSchema.index({ authorId: 1 });
postSchema.index({ createdAt: -1 });

export const Post = mongoose.model<IPost>('Post', postSchema);