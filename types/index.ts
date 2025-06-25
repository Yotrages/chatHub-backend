import { Request } from 'express';
import { Document, Types } from 'mongoose';

export interface IUser extends Document {
  _id: string;
  username?: string; // Optional now
  name?: string; // Required for all users
  email: string;
  password?: string; // Optional for OAuth users
  provider?: 'google' | 'github' | null;
  providerId?: string;
  avatar?: string;
  online: boolean;
  lastSeen: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IMessage extends Document {
  _id: string;
  conversationId: {};
  senderId: {};
  content: string;
  type: 'text' | 'image' | 'file';
  timestamp: Date;
  edited?: boolean;
  messageType?: string;
  fileUrl?: string;
  fileName?: string;
  editedAt?: Date;
  isRead?: boolean;
  replyTo?: string;
  reactions?: {
    userId: string;
    emoji: string;
  }[];
}

export interface IConversation extends Document {
  _id: string;
  type: 'direct' | 'group';
  name?: string;
  description?: string;
  participants: string[];
  admins?: string[];
  lastMessage?: string;
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
  authorId: Types.ObjectId;
  content: string;
  replies: IReply[]
  likes: Types.ObjectId[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IReply extends Document {
  authorId: Types.ObjectId;
  content: string;
  likes: Types.ObjectId[];
  replies?: IReply[]; // This matches the embedded schema
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IPost extends Document {
  _id: Types.ObjectId;
  authorId: Types.ObjectId;
  content: string;
  images?: string[];
  likes: Types.ObjectId[];
  comments: Types.DocumentArray<IComment>;
  createdAt?: Date;
  updatedAt?: Date;
}

// Socket types
export interface AuthenticatedSocket {
  userId?: string;
  user?: IUser;
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

// JWT Payload
export interface JWTPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

// Request types
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

export interface AuthRequest extends Request {
  user?: {
    userId?: string;
    email?: string;
  };
}


// Socket events
export interface ServerToClientEvents {
  'new-message': (message: IMessage) => void;
  'user-online': (userId: string) => void;
  'user-offline': (userId: string) => void;
  'user-typing': (data: { userId: string; conversationId: string }) => void;
  'user-stop-typing': (data: { userId: string; conversationId: string }) => void;
  'conversation-created': (conversation: IConversation) => void;
  'new-post': (post: IPost) => void;
  'message-sent': (message: IMessage) => void;
  'auth-error': (error: string) => void;
}

export interface ClientToServerEvents {
  authenticate: (token: string) => void;
  'join-conversation': (conversationId: string) => void;
  'leave-conversation': (conversationId: string) => void;
  'send-message': (messageData: {
    conversationId: string;
    content: string;
    type?: 'text' | 'image' | 'file';
    replyTo?: string;
  }) => void;
  'typing': (data: { conversationId: string }) => void;
  'stop-typing': (data: { conversationId: string }) => void;
  'join-room': (room: string) => void;
  'leave-room': (room: string) => void;
}


