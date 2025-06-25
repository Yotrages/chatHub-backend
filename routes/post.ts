import express from "express";
import { PostsController } from "../controllers/postController.js";
import { authenticateToken } from "../middleware/authMiddleware.js";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";
import multer from "multer";

const router = express.Router();

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: (req, file) => {
    return {
      folder: "posts", 
      allowedFormats: ["jpeg", "png", "jpg", "gif", "webp", "svg", "mp4", "mp3"], 
      resource_type: "auto",
    };
  },
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 5 // Max 5 images per post
  }
});

router.get("/", PostsController.getPosts);
router.get("/:userId/post", PostsController.getUserPosts);
router.get("/:postId/comment/:commentId/reply/:replyId", authenticateToken, PostsController.getReplyLikeStatus);
router.get("/:postId/comment/:commentId", authenticateToken, PostsController.getBulkReplyLikeStatus);
router.get("/:postId/comment/:commentId/reply/:replyId", authenticateToken, PostsController.getReplyLikers);
router.get("/search/:query",  PostsController.searchPost);
router.post("/", authenticateToken, upload.array('images'), PostsController.createPost);
router.post("/:postId/like", authenticateToken, PostsController.toggleLike);
router.post("/:postId/comment/:commentId", authenticateToken, PostsController.toggleLikeComment);
router.post("/:postId/comment", authenticateToken, PostsController.createComment);
router.post("/:postId/comment/:commentId/reply", authenticateToken, PostsController.addReply);
router.post("/:postId/comment/:commentId/reply/:parentReplyId", authenticateToken, PostsController.addNestedReply);
router.post("/:postId/comment/:commentId/reply/like/:replyId", authenticateToken, PostsController.likeReply);
router.post("/:postId/comment/:commentId/reply/nestedReply/:nestedReplyId", authenticateToken, PostsController.likeNestedReply);
router.put("/:postId/comment/:commentId", authenticateToken, PostsController.updateComment);
router.put("/:postId", authenticateToken, upload.array('images'), PostsController.updatePost);
router.delete("/:postId", authenticateToken, PostsController.deletePost);
router.delete("/:postId/comment/:commentId", authenticateToken, PostsController.deleteComment);
router.delete("/:postId/comment/:commentId/reply/:replyId", authenticateToken, PostsController.deleteReply);

export default router;
