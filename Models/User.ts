import mongoose, { Schema } from 'mongoose';
import { IUser } from '../types';

const userSchema = new Schema<IUser>({
  username: {
    type: String,
    unique: true,
    sparse: true, 
    trim: true,
    minlength: [3, 'Username must be at least 3 characters'],
    maxlength: [30, 'Username cannot exceed 30 characters'],
  },
  name: {
    type: String,
    trim: true,
    maxlength: [50, 'Name cannot exceed 50 characters'],
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email'],
  },
  password: {
    type: String,
    required: function(this: IUser) {
      return !this.provider;
    },
    minlength: [6, 'Password must be at least 6 characters'],
  },
  provider: {
    type: String,
    enum: ['google', 'github', null],
    default: null,
  },
  providerId: {
    type: String,
    sparse: true, 
  },
  avatar: {
    type: String,
    default: null,
  },
  online: {
    type: Boolean,
    default: false,
  },
  lastSeen: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

userSchema.index({ provider: 1, providerId: 1 }, { 
  unique: true, 
  sparse: true 
});

userSchema.pre('save', function(next) {
  if (this.provider && !this.providerId) {
    return next(new Error('Provider ID is required for OAuth users'));
  }
  
  if (!this.provider && !this.password) {
    return next(new Error('Password is required for manual registration'));
  }
  
  next();
});

export const User = mongoose.model<IUser>('User', userSchema);