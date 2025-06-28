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
  }] 
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
images: [{
  type: String,
  validate: {
    validator: function(v) {
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

postSchema.index({ authorId: 1 });
postSchema.index({ createdAt: -1 });

export const Post = mongoose.model<IPost>('Post', postSchema);