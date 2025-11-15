import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../Models/User";
import { Post } from "../Models/Post";
import { HTTP_STATUS } from "../utils/constant";
import cloudinary from "../config/cloudinary";
import { Reels } from "../Models/Reels";
import { UserSettings } from "../Models/userSettings";
import mongoose from "mongoose";

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

const areUsersBlocked = async (
  userId1: string,
  userId2: string
): Promise<boolean> => {
  const [settings1, settings2] = await Promise.all([
    UserSettings.findOne({ userId: userId1 }),
    UserSettings.findOne({ userId: userId2 }),
  ]);

  const userId1Obj = new mongoose.Types.ObjectId(userId1);
  const userId2Obj = new mongoose.Types.ObjectId(userId2);

  return (
    settings1?.security.blockedUsers.some((id) => id.equals(userId2Obj)) ||
    settings2?.security.blockedUsers.some((id) => id.equals(userId1Obj)) ||
    false
  );
};

const canViewProfile = async (
  viewerId: string | undefined,
  profileUserId: string
): Promise<{ allowed: boolean; reason?: string }> => {
  const profileSettings = await UserSettings.findOne({ userId: profileUserId });

  if (!profileSettings) {
    return { allowed: true };
  }

  if (profileSettings.account.isDeactivated) {
    return { allowed: false, reason: "This account is deactivated" };
  }

  const profileVisibility = profileSettings.privacy.profileVisibility;

  if (profileVisibility === 'public') {
    return { allowed: true };
  }

  if (!viewerId) {
    return { allowed: false, reason: "This profile is private" };
  }

  if (viewerId === profileUserId) {
    return { allowed: true };
  }

  const isBlocked = await areUsersBlocked(viewerId, profileUserId);
  if (isBlocked) {
    return { allowed: false, reason: "This profile is not accessible" };
  }

  if (profileVisibility === 'private') {
    return { allowed: false, reason: "This profile is private" };
  }

  if (profileVisibility === 'friends') {
    const [viewer, profileUser] = await Promise.all([
      User.findById(viewerId).select('following'),
      User.findById(profileUserId).select('following')
    ]);

    const viewerIdObj = new mongoose.Types.ObjectId(viewerId);
    const profileUserIdObj = new mongoose.Types.ObjectId(profileUserId);

    const areMutualFollowers =
      viewer?.following.some((id) => id.equals(profileUserIdObj)) &&
      profileUser?.following.some((id) => id.equals(viewerIdObj));

    if (!areMutualFollowers) {
      return { allowed: false, reason: "This profile is only visible to friends" };
    }
  }

  return { allowed: true };
};

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

    const userSettings = new UserSettings({
      userId: savedUser._id,
    });
    await userSettings.save();

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

    const userSettings = await UserSettings.findOne({ userId: user._id });
    if (userSettings?.account.isDeactivated) {
      return res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "This account has been deactivated" });
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

    if (userSettings?.notifications.inApp.onlineStatus !== false) {
      user.online = true;
      await user.save();
    }

    const response = await User.findById(user._id)
      .select("-password -provider -providerId")
      .populate("followers", "-password -provider -providerId")
      .populate("following", "-password -provider -providerId");

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

    const userSettings = await UserSettings.findOne({ userId: user._id });
    if (userSettings?.account.isDeactivated) {
      return res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ message: "Cannot change password: Account is deactivated" });
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

export const getSuggestedUsers = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 15;
    const skip = (page - 1) * limit;

    if (!userId) {
      res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: "You are not authenticated" });
      return;
    }

    const userSettings = await UserSettings.findOne({ userId });
    const blockedUsers = userSettings?.security.blockedUsers || [];

    const usersWhoBlockedMe = await UserSettings.find({
      'security.blockedUsers': new mongoose.Types.ObjectId(userId)
    }).select('userId');
    
    const blockerIds = usersWhoBlockedMe.map(s => s.userId);
    const allBlockedUserIds = [...blockedUsers, ...blockerIds];

    const users = await User.find({
      _id: { 
        $ne: userId,
        $nin: allBlockedUserIds 
      },
      followers: { $ne: userId },
    })
      .select("-password -providerId -provider")
      .sort({ followersCount: -1 })
      .skip(skip)
      .limit(limit);

    const activeUsers = [];
    for (const user of users) {
      const settings = await UserSettings.findOne({ userId: user._id });
      if (!settings?.account.isDeactivated) {
        activeUsers.push(user);
      }
    }

    const totalUser = await User.countDocuments({
      _id: { 
        $ne: userId,
        $nin: allBlockedUserIds
      },
      followers: { $ne: userId },
    });
    const totalPages = Math.ceil(totalUser / limit);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      users: activeUsers,
      pagination: {
        currentPage: page,
        totalPages,
        totalUser: activeUsers.length,
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
    if (!userId) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "Not authenticated" });
      return;
    }

    const userSettings = await UserSettings.findOne({ userId });
    const blockedUsers = userSettings?.security.blockedUsers || [];

    const usersWhoBlockedMe = await UserSettings.find({
      'security.blockedUsers': new mongoose.Types.ObjectId(userId)
    }).select('userId');
    
    const blockerIds = usersWhoBlockedMe.map(s => s.userId);
    const allBlockedUserIds = [...blockedUsers, ...blockerIds];

    const users = await User.find({
      _id: { $nin: allBlockedUserIds }
    }).select("username avatar bio follower following email isPrivate");

    const otherUsers = users.filter((user) => user._id.toString() !== userId);

    const activeUsers = [];
    for (const user of otherUsers) {
      const settings = await UserSettings.findOne({ userId: user._id });
      if (!settings?.account.isDeactivated) {
        activeUsers.push(user);
      }
    }

    res.status(HTTP_STATUS.OK).json(activeUsers);
  } catch (error: any) {
    console.log(error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ message: "Server error" });
  }
};

export const searchAll = async (req: Request, res: Response) => {
  const { query } = req.query;
  const userId = req.user?.userId;

  try {
    let blockedUsers: mongoose.Types.ObjectId[] = [];
    let blockerIds: mongoose.Types.ObjectId[] = [];

    if (userId) {
      const userSettings = await UserSettings.findOne({ userId });
      blockedUsers = userSettings?.security.blockedUsers || [];

      const usersWhoBlockedMe = await UserSettings.find({
        'security.blockedUsers': new mongoose.Types.ObjectId(userId)
      }).select('userId');
      
      blockerIds = usersWhoBlockedMe.map(s => s.userId);
    }

    const allBlockedUserIds = [...blockedUsers, ...blockerIds];

    const post = await Post.find({
      content: { $regex: query, $options: "i" },
      isDeleted: false,
      authorId: { $nin: allBlockedUserIds }
    });

    const user = await User.find({
      username: { $regex: query, $options: "i" },
      _id: { $nin: allBlockedUserIds }
    }).select("username avatar followers following bio email postsCount");

    const activeUsers = [];
    for (const u of user) {
      const settings = await UserSettings.findOne({ userId: u._id });
      if (!settings?.account.isDeactivated) {
        activeUsers.push(u);
      }
    }

    const allSearchResult = [...post, ...activeUsers];

    res.status(HTTP_STATUS.OK).json({
      allSearchResult,
      post,
      user: activeUsers,
    });
  } catch (err: any) {
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ error: "Server Error", err });
  }
};

export const getSingleUser = async (req: Request, res: Response) => {
  const { id } = req.params;
  const viewerId = req.user?.userId;

  try {
    const canAccess = await canViewProfile(viewerId, id);
    if (!canAccess.allowed) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ message: canAccess.reason || "Cannot access this profile" });
      return;
    }

    const user = await User.findOne({ _id: id })
      .select("-password -provider -providerId")
      .populate(
        "followers",
        "username avatar email bio followers following postsCount"
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
    const viewerId = req.user?.userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    if (!userId) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: "User ID required" });
      return;
    }

    const canAccess = await canViewProfile(viewerId, userId);
    if (!canAccess.allowed) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: canAccess.reason || "Cannot access this user's posts" });
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "User not found" });
      return;
    }

    const posts = await Post.find({ authorId: userId, isDeleted: false })
      .populate("authorId", "username avatar")
      .populate("reactions.userId", "username avatar")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

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
    const viewerId = req.user?.userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    if (!userId) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: "User ID required" });
      return;
    }

    const canAccess = await canViewProfile(viewerId, userId);
    if (!canAccess.allowed) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: canAccess.reason || "Cannot access this user's reels" });
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "User not found" });
      return;
    }

    const reels = await Reels.find({ authorId: userId, isDeleted: false })
      .populate("authorId", "username avatar")
      .populate("reactions.userId", "username avatar")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalUserReels = await Reels.countDocuments({
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
      .json({ error: "Failed to fetch reels" });
  }
};

const getMostFollowedUsers = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "User not authorized" });
      return;
    }

    const userSettings = await UserSettings.findOne({ userId });
    const blockedUsers = userSettings?.security.blockedUsers || [];

    const usersWhoBlockedMe = await UserSettings.find({
      'security.blockedUsers': new mongoose.Types.ObjectId(userId)
    }).select('userId');
    
    const blockerIds = usersWhoBlockedMe.map(s => s.userId);
    const allBlockedUserIds = [...blockedUsers, ...blockerIds];

    const mostFollowedUser = await User.find({
      _id: { $nin: allBlockedUserIds }
    })
      .select("username avatar following followers bio")
      .sort({ followersCount: -1 });

    const activeUsers = [];
    for (const user of mostFollowedUser) {
      const settings = await UserSettings.findOne({ userId: user._id });
      if (!settings?.account.isDeactivated) {
        activeUsers.push(user);
      }
    }

    if (activeUsers.length === 0) {
      res.status(200).json({ message: "No users found" });
      return;
    }

    res.status(200).json(activeUsers);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Server Error",
    });
  }
};

export const getLikedPosts = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const viewerId = req.user?.userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const canAccess = await canViewProfile(viewerId, userId);
    if (!canAccess.allowed) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: canAccess.reason || "Cannot access liked posts" });
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "User not found" });
      return;
    }

    let blockedPostAuthors: mongoose.Types.ObjectId[] = [];
    if (viewerId) {
      const viewerSettings = await UserSettings.findOne({ userId: viewerId });
      blockedPostAuthors = viewerSettings?.security.blockedUsers || [];
    }

    const posts = await Post.find({
      _id: { $in: user.likedPost },
      isDeleted: false,
      authorId: { $nin: blockedPostAuthors }, 
    })
      .populate("authorId", "username avatar")
      .populate("reactions.userId", "username avatar")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const totalPosts = await Post.countDocuments({
      _id: { $in: user.likedPost },
      isDeleted: false,
      authorId: { $nin: blockedPostAuthors },
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
    const viewerId = req.user?.userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const sort = (req.query.sort as string) || "latest";

    if (viewerId !== userId) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "You can only view your own saved posts" });
      return;
    }

    const user = await User.findById(userId).select("savedPost");
    if (!user) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "User not found" });
      return;
    }

    const userSettings = await UserSettings.findOne({ userId });
    const blockedUsers = userSettings?.security.blockedUsers || [];

    const savedPostsMap = new Map(
      user.savedPost.map((saved) => [saved.postId.toString(), saved.savedAt])
    );
    const postIds = user.savedPost.map((saved) => saved.postId);

    const posts = await Post.find({
      _id: { $in: postIds },
      isDeleted: false,
      authorId: { $nin: blockedUsers }, 
    })
      .populate("authorId", "username avatar")
      .populate("reactions.userId", "username avatar")
      .lean();

    const enrichedPosts = posts.map((post) => ({
      ...post,
      savedAt:
        savedPostsMap.get(post._id.toString()) || new Date(post.createdAt),
    }));

    const sortedPosts = enrichedPosts.sort((a, b) => {
      const dateA = new Date(a.savedAt).getTime();
      const dateB = new Date(b.savedAt).getTime();
      return sort === "oldest" ? dateA - dateB : dateB - dateA;
    });

    const startIndex = (page - 1) * limit;
    const paginatedPosts = sortedPosts.slice(startIndex, startIndex + limit);

    const totalPosts = sortedPosts.length;
    const totalPages = Math.ceil(totalPosts / limit);

    res.json({
      success: true,
      posts: paginatedPosts,
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

    console.log("=== UPDATE USER DEBUG ===");
    console.log("req.body:", req.body);
    console.log("req.files:", req.files);

    if (userId !== id) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "Unauthorized to update this profile" });
      return;
    }

    const userSettings = await UserSettings.findOne({ userId: id });
    if (userSettings?.account.isDeactivated) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "Cannot update profile: Account is deactivated" });
      return;
    }

    const user = await User.findById(id);
    if (!user) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "User not found" });
      return;
    }

    const updateData: any = {};

    if (formData.name && typeof formData.name === "string") {
      updateData.name = formData.name;
    }
    if (formData.bio !== undefined) {
      updateData.bio = formData.bio;
    }
    if (formData.location !== undefined) {
      updateData.location = formData.location;
    }
    if (formData.website !== undefined) {
      updateData.website = formData.website;
    }
    if (formData.isPrivate !== undefined) {
      updateData.isPrivate =
        formData.isPrivate === "true" || formData.isPrivate === true;
    }

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

    console.log("Final updateData:", updateData);

    const updatedUser = await User.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    }).select("-password");

    res.status(HTTP_STATUS.OK).json({
      message: "Profile updated successfully",
      user: updatedUser,
    });
  } catch (error: any) {
    console.error("Update user error:", error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      error: "Server error during profile update",
      details: error.message,
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
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    const user = await User.findById(decoded.userId);
    if (!user) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "User not found" });
      return;
    }

    const userSettings = await UserSettings.findOne({ userId: user._id });
    if (userSettings?.account.isDeactivated) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "Account is deactivated" });
      return;
    }

    const newToken = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET!,
      {
        expiresIn: "24h",
      }
    );
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
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "User not authenticated" });
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "User not found" });
      return;
    }

    let userSettings = await UserSettings.findOne({ userId });
    if (!userSettings) {
      userSettings = new UserSettings({ userId: req.user?.userId });
      await userSettings.save();
    }

    if (userSettings.account.isDeactivated) {
      res.status(HTTP_STATUS.FORBIDDEN).json({ error: "Account is deactivated" });
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

      if (userSettings.notifications.inApp.onlineStatus !== false) {
        user.online = true;
        user.lastSeen = null;
      }
    } else {
      if (userSettings.notifications.inApp.onlineStatus !== false) {
        user.online = status === "online";
        user.lastSeen = status === "online" ? null : new Date();
      }
    }

    await user.save();
    res.status(200).json({ success: true, status: user.online });
  } catch (err) {
    console.error("Online status error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

export const getOnlineStatus = async (req: Request, res: Response) => {
  const { userId } = req.params;
  const viewerId = req.user?.userId;

  try {
    const user = await User.findById(userId);
    if (!user) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "User not found" });
      return;
    }

    const userSettings = await UserSettings.findOne({ userId });
    if (userSettings?.account.isDeactivated) {
      res.status(HTTP_STATUS.FORBIDDEN).json({ error: "Account is deactivated" });
      return;
    }

    if (viewerId) {
      const isBlocked = await areUsersBlocked(viewerId, userId);
      if (isBlocked) {
        res.status(HTTP_STATUS.FORBIDDEN).json({ error: "Cannot view online status" });
        return;
      }
    }

    if (userSettings?.notifications.inApp.onlineStatus === false) {
      res.status(HTTP_STATUS.OK).json({ 
        success: true, 
        isOnline: false,
        showStatus: false 
      });
      return;
    }

    const isOnline = user.online;
    res.status(HTTP_STATUS.OK).json({ 
      success: true, 
      isOnline,
      lastSeen: user.lastSeen,
      showStatus: true
    });
  } catch (error: any) {
    console.error("Get online status error:", error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: "Server error" });
  }
};

export const blockUser = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { userIdToBlock } = req.params;

    if (!userId) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "Not authenticated" });
      return;
    }

    if (userId === userIdToBlock) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: "Cannot block yourself" });
      return;
    }

    const userSettings = await UserSettings.findOne({ userId });
    if (userSettings?.account.isDeactivated) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "Cannot block users: Account is deactivated" });
      return;
    }

    const userToBlock = await User.findById(userIdToBlock);
    if (!userToBlock) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "User not found" });
      return;
    }

    if (!userSettings) {
      const newSettings = new UserSettings({
        userId,
        security: {
          blockedUsers: [new mongoose.Types.ObjectId(userIdToBlock)]
        }
      });
      await newSettings.save();
    } else {
      const userIdToBlockObj = new mongoose.Types.ObjectId(userIdToBlock);
      if (!userSettings.security.blockedUsers.some(id => id.equals(userIdToBlockObj))) {
        userSettings.security.blockedUsers.push(userIdToBlockObj);
        await userSettings.save();
      }
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: "User blocked successfully"
    });
  } catch (error: any) {
    console.error("Block user error:", error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: "Server error" });
  }
};

export const unblockUser = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { userIdToUnblock } = req.params;

    if (!userId) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "Not authenticated" });
      return;
    }

    const userSettings = await UserSettings.findOne({ userId });
    if (!userSettings) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "User settings not found" });
      return;
    }

    const userIdToUnblockObj = new mongoose.Types.ObjectId(userIdToUnblock);
    userSettings.security.blockedUsers = userSettings.security.blockedUsers.filter(
      id => !id.equals(userIdToUnblockObj)
    );
    await userSettings.save();

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: "User unblocked successfully"
    });
  } catch (error: any) {
    console.error("Unblock user error:", error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: "Server error" });
  }
};

export const getBlockedUsers = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "Not authenticated" });
      return;
    }

    const userSettings = await UserSettings.findOne({ userId });
    if (!userSettings) {
      res.status(HTTP_STATUS.OK).json({ 
        success: true, 
        blockedUsers: [] 
      });
      return;
    }

    const blockedUsers = await User.find({
      _id: { $in: userSettings.security.blockedUsers }
    }).select("username avatar bio email");

    res.status(HTTP_STATUS.OK).json({
      success: true,
      blockedUsers
    });
  } catch (error: any) {
    console.error("Get blocked users error:", error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: "Server error" });
  }
};