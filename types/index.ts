import { Request } from "express";
import { Document, Types } from "mongoose";
import { Server as SocketIOServer } from "socket.io";

export interface IUser extends Document {
  _id: string;
  username?: string;
  email: string;
  password?: string;
  provider?: "google" | "github" | null;
  providerId?: string;
  avatar?: string;
  online: boolean;
  lastSeen: Date | null;
  starredMessages: Types.ObjectId[];
  createdAt?: Date;
  updatedAt?: Date;
  isPrivate?: boolean;
  bio?: string;
  followersCount?: number;
  followingCount?: number;
  postsCount?: number;
  followers?: Types.ObjectId[];
  following?: Types.ObjectId[];
  archived?: Types.ObjectId[];
  location?: string;
  website?: string;
  isVerified: boolean;
  coverImage: string;
  savedPost: {
    postId: Types.ObjectId;
    savedAt: Date;
  }[];
  likedPost: Types.ObjectId[];
  savedReel: Types.ObjectId[];
  likedReel: Types.ObjectId[];
}

export interface IMessage extends Document {
  _id: string;
  conversationId: {};
  senderId: {};
  content: string;
  type: "text" | "image" | "file";
  timestamp: Date;
  edited?: boolean;
  messageType?: string;
  callStatus?: "missed" | "ended" | "declined" | "failed";
  fileUrl?: string;
  fileName?: string;
  editedAt?: Date;
  isRead?: boolean;
  replyTo?: Types.ObjectId;
  postId: Types.ObjectId;
  reactions?: {
    userId: string;
    emoji: {
      category: string;
      name: string;
    };
  }[];
  readBy: {
    userId: Types.ObjectId;
    readAt: Date;
  }[];
}

export interface IReels extends Document {
  _id: Types.ObjectId;
  fileUrl: string;
  title: string;
  authorId: Types.ObjectId;
  reactions: {
    userId: string;
    emoji: {
      category: string;
      name: string;
    };
  }[];
  viewers: {
    viewer: Types.ObjectId;
    viewedAt?: Date;
  }[];
  shareCount: number;
  commentsCount: number;
  visibility: "public" | "private" | "friends";
  comments: Types.DocumentArray<IComment>;
  createdAt?: Date;
  updatedAt?: Date;
  isDeleted: boolean;
}

export interface IStories extends Document {
  type: "video" | "image";
  fileType: string;
  viewers: {
    viewer: Types.ObjectId;
    viewedAt?: Date;
  }[];
  fileUrl: string;
  text?: string;
  textStyle?: string;
  authorId: Types.ObjectId;
  textPosition: {
    x: number;
    y: number;
  };
  background: string;
  reactions: {
    userId: string;
    emoji: string;
  }[];
}

export interface IConversation extends Document {
  _id: string;
  type: "direct" | "group";
  name?: string;
  description?: string;
  participants: string[];
  admins?: string[];
  lastMessage?: Types.ObjectId;
  pinnedMessages: Types.ObjectId[];
  createdBy: {};
  createdAt: Date;
  updatedAt: Date;
  isPinned?: boolean;
  isMuted?: boolean;
  isArchived?: boolean;
  avatar?: string;
}

export interface IComment extends Document {
  _id: Types.ObjectId;
  dynamicId: Types.ObjectId;
  parentCommentId: Types.ObjectId;
  authorId: Types.ObjectId;
  content: string;
  file?: string;
  repliesCount: number;
  isEdited: boolean;
  editedAt: Date;
  isDeleted: boolean;
  reactions: {
    userId: string;
    emoji: {
      category: string;
      name: string;
    };
  }[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IPost extends Document {
  _id: Types.ObjectId;
  authorId: Types.ObjectId;
  content: string;
  images?: string[];
  commentsCount: number;
  shareCount: number;
  reactions: {
    userId: string;
    emoji: {
      category: string;
      name: string;
    };
  }[];
  comments: Types.DocumentArray<IComment>;
  createdAt?: Date;
  updatedAt?: Date;
  visibility: "public" | "private" | "friends";
  isDeleted: boolean;
  isEdited: boolean;
  editedAt: Date;
}

export interface AuthenticatedSocket {
  userId?: string;
  user?: IUser;
}

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

export interface JWTPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId?: string;
        email?: string;
      };
    }
  }
}

declare global {
  namespace Express {
    interface Request {
      io?: SocketIOServer;
    }
  }
}

export interface AuthRequest extends Request {
  user?: {
    userId?: string;
    email?: string;
  };
}

export interface IFollow {
  _id?: string;
  followerId: Types.ObjectId;
  followingId: Types.ObjectId;
  status: "pending" | "accepted" | "blocked";
  createdAt?: Date;
  updatedAt?: Date;
}

export interface INotification {
  _id?: string;
  recipientId: Types.ObjectId;
  senderId: Types.ObjectId;
  type:
    | "follow"
    | "like_post"
    | "like_reel"
    | "comment"
    | "reply"
    | "message"
    | "mention"
    | "tag"
    | "story"
    | "like_story"
    | "like_reply"
    | "like_comment"
    | "online_status";
  message: string;
  entityType:
    | "post"
    | "reel"
    | "comment"
    | "message"
    | "user"
    | "conversation"
    | "story"
    | "reply";
  entityId: Types.ObjectId;
  isRead: boolean;
  actionUrl?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ServerToClientEvents {
  "new-message": (message: IMessage) => void;
  "user-online": (userId: string) => void;
  "user-offline": (userId: string) => void;
  "user-typing": (data: { userId: string; conversationId: string }) => void;
  "user-stop-typing": (data: {
    userId: string;
    conversationId: string;
  }) => void;
  "conversation-created": (conversation: IConversation) => void;
  "new-post": (post: IPost) => void;
  "message-sent": (message: IMessage) => void;
  "auth-error": (error: string) => void;
}

export interface ClientToServerEvents {
  authenticate: (token: string) => void;
  "join-conversation": (conversationId: string) => void;
  "leave-conversation": (conversationId: string) => void;
  "send-message": (messageData: {
    conversationId: string;
    content: string;
    type?: "text" | "image" | "file";
    replyTo?: string;
  }) => void;
  typing: (data: { conversationId: string }) => void;
  "stop-typing": (data: { conversationId: string }) => void;
  "join-room": (room: string) => void;
  "leave-room": (room: string) => void;
}

export interface IProduct extends Document {
  authorId: Types.ObjectId;
  name: string;
  description: string;
  quantity: number;
  price: number;
  exp?: Date;
  license?: string;
  isDeleted: boolean;
  images?: string[];
}

export interface CallSession {
  callId: string;
  caller: string;
  callee: string;
  isVideo: boolean;
  status: 'calling' | 'ringing' | 'connected' | 'ended' | 'accepted';
  startTime?: Date;
  endTime?: Date;
}