import dotenv from 'dotenv';

dotenv.config();

export const config = {
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  JWT_SECRET: process.env.JWT_SECRET || 'fallback-secret-key',
  JWT_EXPIRE: process.env.JWT_EXPIRE || '7d',
  MONGODB_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/chatapp',
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:3000' || "http://localhost:3001" || "http://localhost:5173",
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