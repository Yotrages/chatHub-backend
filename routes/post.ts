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
    fileSize: 10 * 1024 * 1024, 
    files: 5 
  }
});

router.get("/", PostsController.getPosts);
router.get('/:id', PostsController.getSinglePost);
router.get("/:postId/comments", authenticateToken, PostsController.getPostComments);
router.get("/:postId/comments/:commentId", authenticateToken, PostsController.getSingleCommentReplies)
router.post("/", authenticateToken, upload.array('images'), PostsController.createPost);
router.post("/:postId/react", authenticateToken, PostsController.addReaction);
router.post("/:postId/comment/:commentId/react", authenticateToken, PostsController.addCommentReaction);
router.post("/:postId/comment", authenticateToken, PostsController.createComment);
router.post('/:postId/save', PostsController.savePost)
router.post('/:postId/share', authenticateToken, PostsController.trackPostShare);
router.put("/:postId/comment/:commentId", authenticateToken, PostsController.updateComment);
router.put("/:postId", authenticateToken, upload.array('images'), PostsController.updatePost);
router.delete("/:postId", authenticateToken, PostsController.deletePost);
router.delete("/:postId/comment/:commentId", authenticateToken, PostsController.deleteComment);


export default router;
