import dotenv from 'dotenv';
import 'express-async-errors';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Server } from 'socket.io';
import authRoutes from './routes/auth.js';
import chatRoutes from './routes/chat.js';
import postsRoutes from './routes/post.js';
import passport from 'passport'
import session from 'express-session'
import configurePassport from './config/passport.js';
import { SocketHandler } from './socket/socketHandler.js';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


console.log('CLOUDINARY_API_KEY:', process.env.CLOUDINARY_API_KEY ? 'Loaded' : 'Missing');
dotenv.config();

// Import configurations and utilities
import connectDB from './config/db.js';
import { config } from './utils/constant.js';
import { generalLimiter } from './middleware/validation.js';

// Import socket handler

connectDB();
configurePassport()
const app = express();
const server = createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:5173" || "http://localhost:3001",
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
  }
});

new SocketHandler(io);
// Connect to database

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:']
    }
  },
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(cors({
  origin: config.CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: "*",
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(session({ secret: 'secret', resave: false, saveUninitialized: true }));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user: any, done) => done(null, user));

// Apply rate limiting
app.use(generalLimiter);

// Serve static files (uploads)
app.use('/uploads', express.static(uploadsDir));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    environment: config.NODE_ENV,
  });
});

// API Routes (we'll create these next)
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/posts', postsRoutes);
// app.use('/api/users', require('./routes/users').default);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

// Global error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: config.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

// Start server
const PORT = config.PORT;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} in ${config.NODE_ENV} mode`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});

export default app;