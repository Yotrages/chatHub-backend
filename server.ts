import dotenv from 'dotenv';
import 'express-async-errors';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import { Server } from 'socket.io';
import authRoutes from './routes/auth.js';
import chatRoutes from './routes/chat.js';
import postsRoutes from './routes/post.js';
import passport from 'passport';
import session from 'express-session';
import configurePassport from './config/passport.js';
import { SocketHandler } from './socket/socketHandler.js';
import connectDB from './config/db.js';
import { config, HTTP_STATUS } from './utils/constant.js';
import { generalLimiter } from './middleware/validation.js';
import notificationRoutes from './routes/notification';
import followRoutes from './routes/follow';
import reelsRoutes from './routes/reels.js';
import storiesRoutes from './routes/stories.js';
import searchRoutes  from './routes/search.js'
import userSettings from './routes/userSettings.js'



dotenv.config();

connectDB();
configurePassport();

const app = express();
const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: [
      process.env.FRONTEND_URL, "http://localhost:3000",
      "http://localhost:5173",
      "http://localhost:3001",
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true,
  },
  allowEIO3: true,
  transports: ['websocket', 'polling'],
});

app.set('io', io); 
new SocketHandler(io);

// Middleware to inject io into requests
app.use((req, res, next) => {
  req.io = io; 
  next();
});


app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
    },
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

app.use(cors({
  origin: [
    process.env.FRONTEND_URL, "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:3001",
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: '*',
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false },
}));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user: any, done) => done(null, user));

app.use(generalLimiter);


app.get('/health', (req, res) => {
  res.status(HTTP_STATUS.OK).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    environment: config.NODE_ENV,
    socketConnections: io.engine.clientsCount,
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/follows', followRoutes);
app.use('/api/reels', reelsRoutes);
app.use('/api/stories', storiesRoutes);
app.use('/api/search', searchRoutes)
app.use('api/settings', userSettings)

// Catch all for undefined routes
app.use('*', (req, res) => {
  res.status(HTTP_STATUS.NOT_FOUND).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

// Global error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    success: false,
    message: 'Something went wrong!',
    error: config.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Graceful shutdown handlers
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

const PORT = config.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} in ${config.NODE_ENV} mode`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔌 Socket.IO server ready`);
});

export default app;