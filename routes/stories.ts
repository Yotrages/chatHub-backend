import express from "express";
import { storiesController } from "../controllers/stories.js";
import { authenticateToken } from "../middleware/authMiddleware";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";
import multer from "multer";

const router = express.Router();

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: (req, file) => {
    return {
      folder: "stories",
      allowedFormats: [
        "png",
        "jpeg",
        "jpg",
        "svg",
        "webp",
        "mp4",
        "mp3",
        "gif",
      ],
      resource_type: "auto",
    };
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
  },
});

router.get("/", storiesController.getStories);
router.post(
  "/",
  authenticateToken,
  upload.single("file"),
  storiesController.createStories
);
router.post("/reaction", authenticateToken, storiesController.storiesReaction);
router.delete("/", authenticateToken, storiesController.deleteStories);
router.get("/viewers/:storyId", authenticateToken, storiesController.getStoryViewers);
router.post("/viewers/:storyId", authenticateToken, storiesController.setStoryViewers);
router.get("/user", authenticateToken, storiesController.getUserStories);
router.get("/trending", authenticateToken, storiesController.getTrendingStories);


export default router