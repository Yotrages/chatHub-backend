import dotenv from 'dotenv';
import { User } from '../Models/User';

dotenv.config();

export const config = {
  redirectBase: process.env.FRONTEND_URL || "http://localhost:3000",
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  JWT_SECRET: process.env.JWT_SECRET || 'fallback-secret-key',
  JWT_EXPIRE: process.env.JWT_EXPIRE || '7d',
  MONGODB_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/chatapp',
  CORS_ORIGIN: process.env.FRONTEND_URL || 'http://localhost:3000' || "http://localhost:3001" || "http://localhost:5173",
  UPLOAD_PATH: process.env.UPLOAD_PATH || './uploads',
  MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE || '5242880'), // 5MB
};

export const SOCKET_EVENTS = {
  CONNECTION: 'connection',
  DISCONNECT: 'disconnect',
  AUTHENTICATE: 'authenticate',
  JOIN_CONVERSATION: 'join-conversation',
  LEAVE_CONVERSATION: 'leave-conversation',
  SEND_MESSAGE: 'send-message',
  NEW_MESSAGE: 'new-message',
  MESSAGE_SENT: 'message-sent',
  TYPING: 'typing',
  STOP_TYPING: 'stop-typing',
  USER_TYPING: 'user-typing',
  USER_STOP_TYPING: 'user-stop-typing',
  USER_ONLINE: 'user-online',
  USER_OFFLINE: 'user-offline',
  NEW_POST: 'new-post',
  CONVERSATION_CREATED: 'conversation-created',
  AUTH_ERROR: 'auth-error',
} as const;

export const MESSAGE_TYPES = {
  TEXT: 'text',
  IMAGE: 'image',
  FILE: 'file',
} as const;

export const CONVERSATION_TYPES = {
  DIRECT: 'direct',
  GROUP: 'group',
} as const;

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export const ERROR_MESSAGES = {
  USER_NOT_FOUND: 'User not found',
  INVALID_CREDENTIALS: 'Invalid credentials',
  USER_ALREADY_EXISTS: 'User already exists',
  UNAUTHORIZED: 'Unauthorized access',
  FORBIDDEN: 'Access forbidden',
  CONVERSATION_NOT_FOUND: 'Conversation not found',
  MESSAGE_NOT_FOUND: 'Message not found',
  POST_NOT_FOUND: 'Post not found',
  INVALID_TOKEN: 'Invalid token',
  TOKEN_EXPIRED: 'Token expired',
  SERVER_ERROR: 'Internal server error',
  VALIDATION_ERROR: 'Validation error',
  FILE_TOO_LARGE: 'File size too large',
  INVALID_FILE_TYPE: 'Invalid file type',
} as const;

export const SUCCESS_MESSAGES = {
  USER_CREATED: 'User created successfully',
  LOGIN_SUCCESS: 'Login successful',
  MESSAGE_SENT: 'Message sent successfully',
  POST_CREATED: 'Post created successfully',
  CONVERSATION_CREATED: 'Conversation created successfully',
  FILE_UPLOADED: 'File uploaded successfully',
} as const;


export async function detectMentions(content: string): Promise<string[]> {
  const mentionRegex = /@(\w+)/g;
  const mentions = content.match(mentionRegex)?.map(m => m.slice(1)) || [];
  const users = await User.find({ username: { $in: mentions } }).select('_id');
  return users.map(user => user._id.toString());
}


export async function populateNestedReplies(replies: any[]): Promise<void> {
  for (let reply of replies) {
    if (reply.authorId && !reply.authorId.username) {
      await User.populate(reply, {
        path: 'authorId',
        select: 'username avatar'
      });
    }

    if (reply.reactions && reply.reactions.length > 0) {
      await User.populate(reply, {
        path: 'reactions.userId',
        select: 'username avatar'
      });
    }

    if (reply.replies && reply.replies.length > 0) {
      await populateNestedReplies(reply.replies);
    }
  }
}


// async function updateReportStatus(reportId: string, status: string) {
//   const report = await Report.findByIdAndUpdate(reportId, { status }, { new: true });
//   const settings = await UserSettings.findOne({ userId: report.reporterId });
//   if (settings?.notifications.inApp.systemUpdates) {
//     await createNotification(report.reporterId, 'systemUpdates', {
//       message: `Your report (${report.reportType}) has been ${status}`,
//       url: `/settings/reports`
//     });
//   }
// }

export function containsBlockedKeywords(content: string, blockedKeywords: string[]): boolean {
  if (!content || !blockedKeywords || blockedKeywords.length === 0) {
    return false;
  }

  const contentLower = content.toLowerCase();
  return blockedKeywords.some(keyword => 
    contentLower.includes(keyword.toLowerCase())
  );
}

export function isSensitiveContent(content: string): boolean {
  if (!content) {
    return false;
  }

  const sensitiveWords = [
    'explicit',
    'violence',
    'hate',
    'offensive',
  ];

  const sensitivePatterns = [
    /\b(explicit|graphic|nsfw)\b/i, 
    /\b(violence|abuse|assault)\b/i, 
    /\b(hate|discriminat(e|ion)|slur)\b/i, 
  ];

  const contentLower = content.toLowerCase();

  const hasSensitiveWord = sensitiveWords.some(word => 
    contentLower.includes(word)
  );

  const hasSensitivePattern = sensitivePatterns.some(pattern => 
    pattern.test(contentLower)
  );

  return hasSensitiveWord || hasSensitivePattern;
}