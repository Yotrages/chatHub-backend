import dotenv from 'dotenv';
import 'express-async-errors';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import authRoutes from './routes/auth.js';
import chatRoutes from './routes/chat.js';
import postsRoutes from './routes/post.js';
import passport from 'passport';
import session from 'express-session';
import configurePassport from './config/passport.js';
import { SocketHandler } from './socket/socketHandler.js';
import connectDB from './config/db.js';
import { config, HTTP_STATUS } from './utils/constant.js';
import { authLimiter, generalLimiter, readLimiter } from './middleware/validation.js';
import notificationRoutes from './routes/notification';
import followRoutes from './routes/follow';
import reelsRoutes from './routes/reels.js';
import storiesRoutes from './routes/stories.js';
import searchRoutes  from './routes/search.js'
import userSettings from './routes/userSettings.js'
import memoryThreads from './routes/memoryThreads.js'
import videoRoutes from './routes/video.js'


dotenv.config();

connectDB();
configurePassport();

const app = express();
if (config.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}
const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: [
      process.env.FRONTEND_URL,
      "http://localhost:3000",
      "http://localhost:5173",
      "http://localhost:3001",
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true,
  },
  allowEIO3: true,
  transports: ['websocket', 'polling'],
  
  pingTimeout: 120000, 
  pingInterval: 25000, 
  
  upgradeTimeout: 30000, 
  allowUpgrades: true,
  
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, 
    skipMiddlewares: true,
  },
  maxHttpBufferSize: 1e8,
  
  perMessageDeflate: {
    threshold: 1024,
    zlibDeflateOptions: {
      chunkSize: 8 * 1024,
    },
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
  },
  httpCompression: {
    threshold: 1024,
  },

  path: '/socket.io/',
});

io.engine.on("connection_error", (err) => {
  console.error('Socket.IO Engine Error:', {
    code: err.code,
    message: err.message,
    context: err.context,
  });
});

io.engine.on("initial_headers", (headers, request) => {
  headers["X-Custom-Header"] = "socket-io";
});

// Redis adapter for horizontal scaling (optional - works without Redis)
const redisUrl = process.env.REDIS_URL;
let pubClient: Redis | null = null;
let subClient: Redis | null = null;

if (redisUrl) {
  console.log('🔴 REDIS_URL detected, setting up Socket.io Redis adapter...');

  // Use URL directly - ioredis handles parsing and TLS automatically
  // For Redis Cloud with rediss://, it will use TLS with proper cert verification
  const redisOptions = {
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => {
      if (times > 3) {
        console.error('❌ Redis connection failed after 3 retries, running without Redis adapter');
        return null;
      }
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true,
  };

  try {
    pubClient = new Redis(redisUrl, redisOptions);
    subClient = pubClient.duplicate();

    pubClient.on('error', (err) => {
      console.error('❌ Redis pub client error:', err.message);
    });

    subClient.on('error', (err) => {
      console.error('❌ Redis sub client error:', err.message);
    });

    pubClient.on('connect', () => {
      console.log('✅ Redis pub client connected');
    });

    subClient.on('connect', () => {
      console.log('✅ Redis sub client connected');
    });

    pubClient.on('ready', () => {
      console.log('✅ Redis pub client ready');
    });

    subClient.on('ready', () => {
      console.log('✅ Redis sub client ready');
    });

    // Use Promise-based approach instead of top-level await
    pubClient.connect()
      .then(() => subClient!.connect())
      .then(() => {
        io.adapter(createAdapter(pubClient!, subClient!));
        console.log('✅ Socket.io Redis adapter configured successfully');
        console.log('📡 Cross-instance messaging enabled');
      })
      .catch((err) => {
        console.error('❌ Failed to setup Redis adapter:', err.message);
        console.log('⚠️ Running without Redis adapter (single-instance mode)');
        pubClient = null;
        subClient = null;
      });
  } catch (err) {
    console.error('❌ Failed to create Redis clients:', err);
    console.log('⚠️ Running without Redis adapter (single-instance mode)');
  }
} else {
  console.log('ℹ️ No REDIS_URL provided, running in single-instance mode');
  console.log('💡 Set REDIS_URL to enable cross-instance messaging');
}

app.set('io', io);
new SocketHandler(io);

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
    process.env.FRONTEND_URL,
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:3001",
  ].filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Set-Cookie'],
  maxAge: 86400, 
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: true,
  cookie: { 
  secure: config.NODE_ENV === 'production', 
  sameSite: config.NODE_ENV === 'production' ? 'none' : 'lax',
  httpOnly: true
}
}));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user: any, done) => done(null, user));

app.get('/health', (req, res) => {
  res.status(HTTP_STATUS.OK).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    environment: config.NODE_ENV,
    socket: {
      connections: io.engine.clientsCount,
      transport: 'websocket/polling',
      status: 'operational',
    },
  });
});

if (config.NODE_ENV !== 'production') {
  app.get('/socket-status', (req, res) => {
    const sockets = Array.from(io.sockets.sockets.values());
    res.json({
      totalConnections: io.engine.clientsCount,
      connectedSockets: sockets.length,
      sockets: sockets.map(s => ({
        id: s.id,
        connected: s.connected,
        transport: s.conn?.transport?.name,
        userId: (s as any).userId,
      })),
    });
  });
}

// API routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/chat', generalLimiter, chatRoutes);
app.use('/api/posts', generalLimiter, postsRoutes);
app.use('/api/notifications', readLimiter, notificationRoutes);
app.use('/api/follows', generalLimiter, followRoutes);
app.use('/api/reels', readLimiter, reelsRoutes);
app.use('/api/stories', readLimiter, storiesRoutes);
app.use('/api/search', readLimiter, searchRoutes);
app.use('/api/settings', generalLimiter, userSettings);
app.use('/api', generalLimiter, memoryThreads);
app.use('/api/videos', readLimiter, videoRoutes);

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
const shutdown = async () => {
  console.log('Shutting down gracefully...');

  io.sockets.sockets.forEach(socket => {
    socket.disconnect(true);
  });

  // Close Redis connections if they exist
  // Note: pubClient and subClient are declared in the Redis setup block above
  // They are accessible here due to function scope
  if (typeof pubClient !== 'undefined' && pubClient) {
    console.log('Closing Redis pub client...');
    await pubClient.quit();
  }
  if (typeof subClient !== 'undefined' && subClient) {
    console.log('Closing Redis sub client...');
    await subClient.quit();
  }

  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Forcing shutdown');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const PORT = config.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT} in ${config.NODE_ENV} mode`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Socket.IO server ready`);
});

export default app;