import mongoose, { Schema } from 'mongoose';
import { IUser } from '../types';

const userSchema = new Schema<IUser>({
  username: {
    type: String,
    unique: true,
    sparse: true, // Allows multiple null values for OAuth users
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
      // Password is required only for manual registration (no provider)
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
    sparse: true, // Allows multiple null values for manual users
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

// Compound index to ensure unique provider + providerId combinations
userSchema.index({ provider: 1, providerId: 1 }, { 
  unique: true, 
  sparse: true // Only applies to documents where both fields exist
});

// Pre-save middleware to handle validation logic
userSchema.pre('save', function(next) {
  // If it's OAuth registration, ensure providerId exists
  if (this.provider && !this.providerId) {
    return next(new Error('Provider ID is required for OAuth users'));
  }
  
  // If it's manual registration, ensure password exists
  if (!this.provider && !this.password) {
    return next(new Error('Password is required for manual registration'));
  }
  
  next();
});

export const User = mongoose.model<IUser>('User', userSchema);