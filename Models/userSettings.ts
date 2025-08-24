// models/UserSettings.ts
import mongoose, { Document, Schema } from 'mongoose';

export interface IUserSettings extends Document {
  userId: mongoose.Types.ObjectId;
  
  // Privacy Settings
  privacy: {
    profileVisibility: 'public' | 'friends' | 'private';
    allowMessagesFrom: 'everyone' | 'friends' | 'none';
    showOnlineStatus: boolean;
    allowTagging: boolean;
    showEmail: boolean;
    showPhoneNumber: boolean;
  };
  
  // Notification Settings
  notifications: {
    email: {
      newFollower: boolean;
      messageReceived: boolean;
      postLiked: boolean;
      postCommented: boolean;
      mentioned: boolean;
      systemUpdates: boolean;
    };
    push: {
      newFollower: boolean;
      messageReceived: boolean;
      postLiked: boolean;
      postCommented: boolean;
      mentioned: boolean;
      systemUpdates: boolean;
    };
    inApp: {
      newFollower: boolean;
      messageReceived: boolean;
      postLiked: boolean;
      postCommented: boolean;
      mentioned: boolean;
      systemUpdates: boolean;
      onlineStatus: boolean;
    };
  };
  
  // Appearance Settings
  appearance: {
    theme: 'light' | 'dark' | 'auto';
    language: string;
    fontSize: 'small' | 'medium' | 'large';
    backgroundImage: string;
    accentColor: string;
  };
  
  // Security Settings
  security: {
    twoFactorAuth: boolean;
    loginAlerts: boolean;
    sessionTimeout: number; // in minutes
    blockedUsers: mongoose.Types.ObjectId[];
    trustedDevices: {
      deviceId: string | undefined;
      deviceName: string;
      lastUsed: Date;
      trusted: boolean;
    }[];
  };
  
  // Content Settings
  content: {
    autoPlayVideos: boolean;
    showSensitiveContent: boolean;
    contentLanguages: string[];
    blockedKeywords: string[];
    blockedPosts: mongoose.Types.ObjectId[]
  };
  
  // Account Settings
  account: {
    isDeactivated: boolean;
    deactivatedAt?: Date;
    deleteScheduledAt?: Date;
    dataDownloadRequests: {
      requestedAt: Date;
      status: 'pending' | 'processing' | 'completed' | 'failed';
      downloadUrl?: string;
      expiresAt?: Date;
    }[];
  };
  
  createdAt: Date;
  updatedAt: Date;
}

const UserSettingsSchema = new Schema<IUserSettings>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  
  privacy: {
    profileVisibility: {
      type: String,
      enum: ['public', 'friends', 'private'],
      default: 'public'
    },
    allowMessagesFrom: {
      type: String,
      enum: ['everyone', 'friends', 'none'],
      default: 'friends'
    },
    showOnlineStatus: {
      type: Boolean,
      default: true
    },
    allowTagging: {
      type: Boolean,
      default: true
    },
    showEmail: {
      type: Boolean,
      default: false
    },
    showPhoneNumber: {
      type: Boolean,
      default: false
    }
  },
  
  notifications: {
    email: {
      newFollower: { type: Boolean, default: true },
      messageReceived: { type: Boolean, default: true },
      postLiked: { type: Boolean, default: true },
      postCommented: { type: Boolean, default: true },
      mentioned: { type: Boolean, default: true },
      systemUpdates: { type: Boolean, default: true },
    },
    push: {
      newFollower: { type: Boolean, default: true },
      messageReceived: { type: Boolean, default: true },
      postLiked: { type: Boolean, default: false },
      postCommented: { type: Boolean, default: true },
      mentioned: { type: Boolean, default: true },
      systemUpdates: { type: Boolean, default: false }
    },
    inApp: {
      newFollower: { type: Boolean, default: true },
      messageReceived: { type: Boolean, default: true },
      postLiked: { type: Boolean, default: true },
      postCommented: { type: Boolean, default: true },
      mentioned: { type: Boolean, default: true },
      systemUpdates: { type: Boolean, default: true },
      onlineStatus: { type: Boolean, default: true }
    }
  },
  
  appearance: {
    theme: {
      type: String,
      enum: ['light', 'dark', 'auto'],
      default: 'auto'
    },
    language: {
      type: String,
      default: 'en'
    },
    fontSize: {
      type: String,
      enum: ['small', 'medium', 'large'],
      default: 'medium'
    },
    backgroundImage: {
      type: String,
      default: ''
    },
    accentColor: {
      type: String,
      default: '#3b82f6'
    }
  },
  
  security: {
    twoFactorAuth: {
      type: Boolean,
      default: false
    },
    loginAlerts: {
      type: Boolean,
      default: true
    },
    sessionTimeout: {
      type: Number,
      default: 60 // 1 hour
    },
    blockedUsers: [{
      type: Schema.Types.ObjectId,
      ref: 'User'
    }],
    trustedDevices: [{
      deviceId: { type: String, required: true },
      deviceName: { type: String, required: true },
      lastUsed: { type: Date, default: Date.now },
      trusted: { type: Boolean, default: false }
    }]
  },
  
  content: {
    autoPlayVideos: {
      type: Boolean,
      default: true
    },
    showSensitiveContent: {
      type: Boolean,
      default: false
    },
    contentLanguages: [{
      type: String,
      default: ['en']
    }],
    blockedKeywords: [String],
    blockedPosts: [{
      type: Schema.Types.ObjectId,
      ref: 'Post'
    }]
  },
  
  account: {
    isDeactivated: {
      type: Boolean,
      default: false
    },
    deactivatedAt: Date,
    deleteScheduledAt: Date,
    dataDownloadRequests: [{
      requestedAt: { type: Date, default: Date.now },
      status: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed'],
        default: 'pending'
      },
      downloadUrl: String,
      expiresAt: Date
    }]
  }
}, {
  timestamps: true
});

// Create indexes
UserSettingsSchema.index({ 'security.blockedUsers': 1 });

export const UserSettings = mongoose.model<IUserSettings>('UserSettings', UserSettingsSchema);

// Report Schema for abuse reporting
export interface IReport extends Document {
  reporterId: mongoose.Types.ObjectId;
  reportedUserId?: mongoose.Types.ObjectId;
  reportedStoryId?: mongoose.Types.ObjectId;
  reportedPostId?: mongoose.Types.ObjectId;
  reportedCommentId?: mongoose.Types.ObjectId;
  reportType: 'spam' | 'harassment' | 'inappropriate_content' | 'fake_account' | 'copyright' | 'other';
  description: string;
  status: 'pending' | 'investigating' | 'resolved' | 'dismissed';
  adminNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ReportSchema = new Schema<IReport>({
  reporterId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reportedUserId: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  reportedPostId: {
    type: Schema.Types.ObjectId,
    ref: 'Post'
  },
  reportedCommentId: {
    type: Schema.Types.ObjectId,
    ref: 'Comment'
  },
  reportedStoryId: {
    type: Schema.Types.ObjectId,
    ref: 'Story'
  },
  reportType: {
    type: String,
    enum: ['spam', 'harassment', 'inappropriate_content', 'fake_account', 'copyright', 'other'],
    required: true
  },
  description: {
    type: String,
    required: true,
    maxlength: 1000
  },
  status: {
    type: String,
    enum: ['pending', 'investigating', 'resolved', 'dismissed'],
    default: 'pending'
  },
  adminNotes: String
}, {
  timestamps: true
});

ReportSchema.index({ reporterId: 1 });
ReportSchema.index({ status: 1 });

export const Report = mongoose.model<IReport>('Report', ReportSchema);