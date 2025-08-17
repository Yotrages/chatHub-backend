import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../Models/User";
import { Post } from "../Models/Post";
import { HTTP_STATUS } from "../utils/constant";
import cloudinary from "../config/cloudinary";
import { Reels } from "../Models/Reels";
import { UserSettings } from "../Models/userSettings";

interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  avatar: File | undefined;
}

interface LoginRequest {
  email: string;
  password: string | undefined;
}

export const register = async (
  req: Request<{}, {}, RegisterRequest>,
  res: Response
): Promise<Response> => {
  try {
    const { username, email, password } = req.body;
    const avatar = req.file;

    console.log("Register request body:", req.body);
    console.log("Register request file:", req.file);

    if (!username || !email || !password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: "Username, email, and password are required",
      });
    }
    if (!req.file) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: "image upload failed",
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: "Invalid email format",
      });
    }

    if (password.length < 6) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: "Password must be at least 6 characters long",
      });
    }

    const existingUser = await User.findOne({
      $or: [{ email }, { username }],
    });

    if (existingUser) {
      const field = existingUser.email === email ? "email" : "username";
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: `User with this ${field} already exists`,
      });
    }

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not defined in environment variables");
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: "Server configuration error",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = new User({
      username,
      email,
      password: hashedPassword,
      online: false,
      avatar: avatar?.path || null,
      lastSeen: new Date(),
    });

    console.log("Attempting to save user:", {
      username: user.username,
      email: user.email,
      avatar: user.avatar,
    });

    const savedUser = await user.save();
    console.log("User saved successfully:", savedUser._id);

    return res.status(HTTP_STATUS.CREATED).json({
      message: "User created successfully",
      user: {
        id: savedUser._id,
        username: savedUser.username,
        email: savedUser.email,
        avatar: savedUser.avatar,
      },
    });
  } catch (error: any) {
    console.error("Registration error:", error);

    if (error.name === "ValidationError") {
      const validationErrors = Object.values(error.errors).map(
        (err: any) => err.message
      );
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: "Validation failed",
        details: validationErrors,
      });
    }

    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: `${field} already exists`,
      });
    }

    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      error: "Server error during registration",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const login = async (
  req: Request<{}, {}, LoginRequest>,
  res: Response
): Promise<Response> => {
  try {
    const { email, password } = req.body;

    console.log("Login request:", {
      email: email,
      passwordProvided: !!password,
    });

    if (!email || !password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: "Email and password are required",
      });
    }

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not defined in environment variables");
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: "Server configuration error",
      });
    }

    const user = await User.findOne({ email: email });

    console.log("User found:", !!user);

    if (!user) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json({ error: "Invalid credentials" });
    }
    if (!user.password) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json({ error: "user have no password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    console.log("Password match:", isMatch);

    if (!isMatch) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json({ error: "Invalid credentials" });
    }

    user.online = true;
    await user.save();

    const response = await User.findById(user._id)
      .select("-password")
      .populate(
        "followers",
        "username name email bio followingCount followersCount avatar"
      )
      .populate(
        "following",
        "username name email bio followingCount followersCount avatar"
      );

    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    return res.json({
      message: "Login successful",
      token,
      user: response,
    });
  } catch (error: any) {
    console.error("Login error:", error);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      error: "Server error during login",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const changePassword = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(HTTP_STATUS.NOT_FOUND)
      .json({ message: "All fields are required" });
  }

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ message: "Invalid email account" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    await User.findOneAndUpdate(
      { email: user.email },
      { password: hashedPassword },
      { new: true }
    );

    return res
      .status(HTTP_STATUS.OK)
      .json({ message: "Password updated successfully" });
  } catch (error) {
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ message: "Server Error", error });
  }
};

export const searchUser = async (req: Request, res: Response) => {
  const { query } = req.params;
  try {
    const user = await User.find({
      username: { $regex: query, $options: "i" },
    });
    if (user.length === 0) {
      return res
        .status(HTTP_STATUS.NOT_FOUND)
        .json({ message: "User not found" });
    }
    return res.status(HTTP_STATUS.OK).json(user);
  } catch (error) {
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ message: "Server Error" });
  }
};

export const getSuggestedUsers = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 15;
    const skip = (page - 1) * limit;
    if (!userId) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "You are not authenticated" });
      return;
    }
    const users = await User.find()
      .select(
        "username avatar name bio followers following followingCount followersCount email"
      )
      .sort({ followersCount: -1 })
      .skip(skip)
      .limit(limit);
    const exemptUser = users.filter((user) => user._id !== userId);
    const totalUser = await User.countDocuments();
    const totalPages = Math.ceil(totalUser / limit);
    res.status(HTTP_STATUS.OK).json({
      success: true,
      users: exemptUser,
      pagination: {
        currentPage: page,
        totalPages,
        totalUser,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (err) {
    console.log(err);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: err });
  }
};

export const getUsers = async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  try {
    const users = await User.find().select(
      "username avatar name bio follower following email isPrivate"
    );
    const otherUsers = users.filter((user) => user._id !== userId);

    res.status(HTTP_STATUS.OK).json(otherUsers);
  } catch (error: any) {
    console.log(error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ message: "Server error" });
  }
};

export const searchAll = async (req: Request, res: Response) => {
  const { query } = req.query;

  try {
    const post = await Post.find({
      content: { $regex: query, $options: "i" },
    });
    const user = await User.find({
      username: { $regex: query, $options: "i" },
      name: { $regex: query, $options: "i" },
    }).select("username name avatar followers following bio email postsCount");
    const allSearchResult = [...post, ...user];
    res.status(HTTP_STATUS.OK).json({
      allSearchResult,
      post,
      user,
    });
  } catch (err: any) {
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ error: "Server Error", err });
  }
};

export const getSingleUser = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const user = await User.findOne({ _id: id })
      .select("-password")
      .populate(
        "followers",
        "username name avatar email bio followers following postsCount"
      );
    if (!user) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ message: "User not found" });
      return;
    }
    res.status(HTTP_STATUS.OK).json(user);
    return;
  } catch (error) {
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ message: "Server Error" });
  }
};

export const getUserPosts = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
    if (!userId) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "Unauthorized" });
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "User not found" });
      return;
    }

    const posts = await Post.find({ authorId: userId, isDeleted: false })
      .populate("authorId", "username name avatar")
      .populate("reactions.userId", "username name avatar")
      .sort({ createdAt: -1 })
      .skip(skip);

    const totalUserPosts = await Post.countDocuments({
      authorId: userId,
      isDeleted: false,
    });
    const totalPages = Math.ceil(totalUserPosts / limit);

    res.json({
      success: true,
      posts,
      pagination: {
        currentPage: page,
        totalPages,
        totalPosts: totalUserPosts,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error(error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ error: "Failed to fetch posts" });
  }
};

export const getUserReels = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
    if (!userId) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "Unauthorized" });
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "User not found" });
      return;
    }

    const reels = await Reels.find({ authorId: userId, isDeleted: false })
      .populate("authorId", "username avatar")
      .populate("reactions.userId", "username name avatar")
      .sort({ createdAt: -1 })
      .skip(skip);

    const totalUserReels = await Post.countDocuments({
      authorId: userId,
      isDeleted: false,
    });
    const totalPages = Math.ceil(totalUserReels / limit);

    res.json({
      success: true,
      reels,
      pagination: {
        currentPage: page,
        totalPages,
        totalReels: totalUserReels,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error(error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ error: "Failed to fetch posts" });
  }
};

const getMostFollowedUsers = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(403).json({ error: "User not authorized " });
    }
    const mostFollowedUser = await User.find().select(
      "name username avatar following followers bio"
    );

    if (mostFollowedUser.length === 0) {
      res.status(200).json({ error: "No followers found" });
    }
    res.status(200).json(mostFollowedUser);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message:
        "Server Error, You may have tpo try again, cux server connection",
    });
  }
};

// const getUserBlockedUsers = async (req: Request, res: Response) => {
//       const userId = req.user?.userId
//       if (!userId) {
//         res.status(403).json({ error: "User not found"})
//       }
//       const userSettingsBlocking = UserSettings.find()
//       const blockedUsers = await User.find({})
// }

export const getLikedPosts = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const user = await User.findById(userId);
    if (!user) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "User not found" });
      return;
    }

    const posts = await Post.find({
      _id: { $in: user.likedPost },
      isDeleted: false,
    })
      .populate("authorId", "username avatar")
      .populate("reactions.userId", "username name avatar")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const totalPosts = await Post.countDocuments({
      _id: { $in: user.likedPost },
      isDeleted: false,
    });
    const totalPages = Math.ceil(totalPosts / limit);

    res.json({
      success: true,
      posts,
      pagination: {
        currentPage: page,
        totalPages,
        totalPosts,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Get liked posts error:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ error: "Failed to fetch liked posts" });
  }
};

export const getSavedPosts = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const user = await User.findById(userId).select("savedPost");
    if (!user) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "User not found" });
      return;
    }

    const posts = await Post.find({
      _id: { $in: user.savedPost },
      isDeleted: false,
    })
      .populate("authorId", "username avatar")
      .populate("reactions.userId", "username name avatar")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const totalPosts = await Post.countDocuments({
      _id: { $in: user.savedPost },
      isDeleted: false,
    });
    const totalPages = Math.ceil(totalPosts / limit);

    res.json({
      success: true,
      posts,
      pagination: {
        currentPage: page,
        totalPages,
        totalPosts,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Get saved posts error:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ error: "Failed to fetch saved posts" });
  }
};

export const updateUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;
    const formData = req.body;

    if (userId !== id) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "Unauthorized to update this profile" });
      return;
    }

    const user = await User.findById(id);
    if (!user) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "User not found" });
      return;
    }

    const updateData: any = { ...formData };

    if (req.files) {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      if (files.avatar && files.avatar[0]) {
        const avatarResult = await cloudinary.uploader.upload(
          files.avatar[0].path,
          {
            folder: "avatar",
            allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"],
          }
        );
        updateData.avatar = avatarResult.secure_url;
      }
      if (files.coverImage && files.coverImage[0]) {
        const coverResult = await cloudinary.uploader.upload(
          files.coverImage[0].path,
          {
            folder: "cover",
            allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"],
            transformation: { quality: "auto", fetch_format: "auto" },
          }
        );
        updateData.coverImage = coverResult.secure_url;
      }
    }

    const updatedUser = await User.findByIdAndUpdate(id, updateData, {
      new: true,
    }).select("-password");

    res.status(HTTP_STATUS.OK).json({
      message: "Profile updated successfully",
      user: updatedUser,
    });
  } catch (error: any) {
    console.error("Update user error:", error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      error: "Server error during profile update",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const validateToken = async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "No token provided" });
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: string;
      iat: number;
    };
    const user = await User.findById(decoded.userId);
    if (!user) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "User not found" });
      return;
    }

    const newToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET!, {
      expiresIn: "24h",
    });
    res.json({ token: newToken });
  } catch (error) {
    res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "Invalid token" });
  }
};

export const updateOnlineStatus = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { status, device } = req.body;

    if (!userId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    let userSettings = await UserSettings.findOne({ userId });
    if (!userSettings) {
      userSettings = new UserSettings({ userId: req.user?.userId });
      await userSettings.save();
    }

    if (userSettings.account.isDeactivated) {
      res.status(403).json({ error: "Account is deactivated" });
      return;
    }

    if (status === "heartbeat") {
      userSettings.security.trustedDevices =
        userSettings.security.trustedDevices || [];
      const sessionIndex = userSettings.security.trustedDevices.findIndex(
        (s) => s.deviceName === device
      );
      if (sessionIndex !== -1) {
        userSettings.security.trustedDevices[sessionIndex].lastUsed =
          new Date();
        userSettings.security.trustedDevices[sessionIndex].deviceId = req.ip;
      } else {
        userSettings.security.trustedDevices.push({
          deviceName: device || "unknown",
          deviceId: req.ip,
          lastUsed: new Date(),
          trusted: false,
        });
      }
      await userSettings.save();
      user.online = true;
      user.lastSeen = null;
    } else {
      user.online = status === "online";
      user.lastSeen = status === "online" ? null : new Date();
    }

    await user.save();
    res.status(200).json({ success: true, status: user.online });
  } catch (err) {
    console.error("Online status error:", err);
    res.status(500).json({ error: "Server error" });
  }
};
