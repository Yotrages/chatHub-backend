import express from "express";
import { ReelsController } from "../controllers/reelsController.js";
import { authenticateToken } from "../middleware/authMiddleware.js";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";
import multer from "multer";

const router = express.Router();

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: (req, file) => {
    return {
      folder: "reels", 
      allowedFormats: ["mp4", "ogg"], 
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

router.get("/", ReelsController.getReels);
router.get('/:id', ReelsController.getSingleReel);
router.get("/:reelId/comments", authenticateToken, ReelsController.getReelsComments);
router.post("/", authenticateToken, upload.single('fileUrl'), ReelsController.createReel);
router.post("/:reelId/react", authenticateToken, ReelsController.addReaction);
router.get("/viewers/:storyId", authenticateToken, ReelsController.getReelViewers);
router.post("/viewers/:storyId", authenticateToken, ReelsController.setReelViewers);
router.post("/:reelId/comment/:commentId/react", authenticateToken, ReelsController.addCommentReaction);
router.post("/:reelId/comment", authenticateToken, ReelsController.createComment);
router.post('/:reelId/save', ReelsController.saveReel)
router.post('/:reelId/share', authenticateToken, ReelsController.trackReelShare);
router.put("/:reelId/comment/:commentId", authenticateToken, ReelsController.updateComment);
router.delete("/:reelId", authenticateToken, ReelsController.deleteReel);
router.delete("/:reelId/comment/:commentId", authenticateToken, ReelsController.deleteComment);


export default router;
