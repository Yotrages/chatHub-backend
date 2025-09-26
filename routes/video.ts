import express from "express";
import { getVideoPosts, getVideoPostById, getTrendingVideoPosts } from "../controllers/videoController.js";
import { authenticateToken } from "../middleware/authMiddleware.js"; 

const router = express.Router();

router.get("/", authenticateToken, getVideoPosts);

router.get("/trending", authenticateToken, getTrendingVideoPosts);

router.get("/:postId", authenticateToken, getVideoPostById);

export default router;