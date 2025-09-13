import express from "express";
import { getVideoPosts, getVideoPostById, getTrendingVideoPosts } from "../controllers/videoController.js";
import { authenticateToken } from "../middleware/authMiddleware.js"; 

const router = express.Router();

// Get all video posts with pagination and filters
router.get("/", authenticateToken, getVideoPosts);

// Get trending videos
router.get("/trending", authenticateToken, getTrendingVideoPosts);

// Get specific video post by ID
router.get("/:postId", authenticateToken, getVideoPostById);

export default router;