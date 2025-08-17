import mongoose, { Types } from "mongoose";
import { Response } from "express";
import { Conversation } from "../Models/Conversation";
import { Message } from "../Models/Message";
import { AuthRequest } from "../types";
import { User } from "../Models/User";
import { NotificationService } from "../services/notificationServices";
import { Post } from "../Models/Post";
import { HTTP_STATUS } from "../utils/constant";

export const getConversations = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "User not authenticated" });
      return;
    }

    const conversations = await Conversation.find({
      participants: userId,
    })
      .populate("participants", "username avatar online")
      .populate({
        path: "lastMessage",
        populate: { path: "senderId", select: "username avatar" },
      })
      .sort({ updatedAt: -1 });

    res.json(conversations);
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: "Server error" });
  }
};

export const createConversation = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const {
      participantIds,
      type,
      name,
      avatar,
    }: {
      participantIds: string[];
      type: string;
      name?: string;
      avatar?: string;
    } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "User not authenticated" });
      return;
    }

    if (type === "direct" && participantIds.length !== 1) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: "Direct conversation must have exactly one other participant",
      });
      return;
    }

    if (type === "group" && (!name || name.trim().length === 0)) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: "Group conversation must have a name" });
      return;
    }

    const allParticipants = [...participantIds, userId];

    if (type === "direct" && allParticipants.length === 2) {
      const existing = await Conversation.findOne({
        type: "direct",
        participants: { $all: allParticipants, $size: 2 },
      });

      if (existing) {
        res.json(existing);
        return;
      }
    }

    const conversationData: any = {
      type,
      name,
      avatar,
      participants: allParticipants,
      createdBy: userId,
    };

    if (type === "group") {
      conversationData.admins = [userId];
    }

    const conversation = new Conversation(conversationData);
    await conversation.save();
    await conversation.populate("participants", "username avatar online");

    // Notify participants (except the creator)
    const sender = await User.findById(userId).select("username name");
    for (const participantId of participantIds) {
      if (participantId !== userId) {
        await NotificationService.createNotification({
          recipientId: participantId,
          senderId: userId,
          type: "message",
          message: `${
            sender?.username || sender?.name || "Someone"
          } added you to a ${type} conversation`,
          entityType: "conversation",
          entityId: conversation._id,
          actionUrl: `/conversation/${conversation._id}`,
        });
      }
    }

    res.status(HTTP_STATUS.CREATED).json(conversation);
  } catch (error: any) {
    console.error("Conversation creation error:", error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: "Server error", details: error.message });
  }
};

export const getMessages = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const messages = await Message.find({ conversationId })
      .populate([
        { path: "senderId", select: "username avatar name" },
        { path: "reactions.userId", select: "username name avatar" },
        {
          path: "replyTo",
          select: "content senderId messageType fileUrl fileName",
          populate: { path: "senderId", select: "username avatar" },
        },
      ])
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

    res.json(messages.reverse());
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: "Server error" });
  }
};

export const sendMessage = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const conversationId = req.params.conversationId || req.body.conversationId;
    const {
      content,
      messageType = "text",
      fileUrl,
      fileName,
      replyTo,
      postId
    } = req.body;
    const senderId = req.user?.userId;

    if (!senderId) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "User not authenticated" });
      return;
    }

    if (!conversationId) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: "Conversation ID is required" });
      return;
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Conversation not found" });
      return;
    }

    if (!conversation.participants.includes(senderId)) {
      res.status(HTTP_STATUS.FORBIDDEN).json({
        error: "Not authorized to send messages to this conversation",
      });
      return;
    }

    if (replyTo) {
      const repliedMessage = await Message.findById(replyTo);
      if (
        !repliedMessage ||
        repliedMessage.conversationId.toString() !== conversationId
      ) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: "Invalid replyTo message ID" });
        return;
      }
    }

    const message = new Message({
      content,
      senderId,
      conversationId,
      messageType,
      fileUrl,
      fileName,
      replyTo,
      createdAt: new Date(),
      updatedAt: new Date(),
      isRead: false,
      reactions: [],
      edited: false,
    });

    await message.save();
    await message.populate([
      { path: "senderId", select: "username avatar" },
      {
        path: "replyTo",
        select: "content senderId messageType fileUrl fileName",
        populate: { path: "senderId", select: "username avatar" },
      },
    ]);

      if (messageType === 'post' && postId) {
    const post = await Post.findById(postId);
    if (post) {
      post.shareCount = (post.shareCount || 0) + 1;
      await post.save();
    }
  }

    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessage: message._id,
      updatedAt: new Date(),
    });

    if (req.io && req.io.sockets.adapter.rooms.has(conversationId)) {
      req.io.to(conversationId).emit("new_message", { message });
    }

    const sender = await User.findById(senderId).select("username name");
    for (const participantId of conversation.participants) {
      if (participantId.toString() !== senderId) {
        await NotificationService.createNotification({
          recipientId: participantId.toString(),
          senderId,
          type: "message",
          message: `${
            sender?.username || sender?.name || "Someone"
          } sent a new message`,
          entityType: "message",
          entityId: message._id,
          actionUrl: `/chat/${conversationId}`,
        });
      }
    }

    res.status(HTTP_STATUS.CREATED).json({ success: true, message });
  } catch (error: any) {
    console.error("Send message error:", error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: "Server error",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const updateConversation = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { conversationId } = req.params;
    const { name, participants, description, avatar } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "User not authenticated" });
      return;
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Conversation not found" });
      return;
    }

    if (
      !conversation.participants.includes(userId) ||
      (conversation.type === "group" && !conversation.admins?.includes(userId))
    ) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "Not authorized to update this conversation" });
      return;
    }

    if (name) conversation.name = name;
    if (description) conversation.description = description;
    if (avatar) conversation.avatar = avatar;
    if (participants) {
      conversation.participants = [
        ...new Set([...conversation.participants, ...participants]),
      ];
    }

    await conversation.save();
    await conversation.populate("participants", "username avatar online");

    const io = req.app.get("io");
    if (io) {
      io.to(conversationId).emit("conversation_updated", conversation);
    }

    res.json(conversation);
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: "Server error" });
  }
};

export const deleteConversation = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { conversationId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "User not authenticated" });
      return;
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Conversation not found" });
      return;
    }

    if (!conversation.participants.includes(userId)) {
      res.status(HTTP_STATUS.FORBIDDEN).json({ error: "Not authorized" });
      return;
    }

    if (conversation.type === "group") {
      conversation.participants = conversation.participants.filter(
        (p) => p.toString() !== userId
      );
      if (conversation.admins?.includes(userId)) {
        conversation.admins = conversation.admins.filter(
          (a) => a.toString() !== userId
        );
      }

      if (conversation.participants.length === 0) {
        await Conversation.deleteOne({ _id: conversationId });
      } else {
        await conversation.save();
      }
    } else {
      await Conversation.deleteOne({ _id: conversationId });
    }

    const io = req.app.get("io");
    if (io) {
      io.to(conversationId).emit("conversation_deleted", { conversationId });
    }

    res.json({ message: "Conversation deleted or left successfully" });
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: "Server error" });
  }
};

export const markMessagesAsRead = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { conversationId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "User not authenticated" });
      return;
    }

    await Message.updateMany(
      { conversationId, isRead: false, senderId: { $ne: userId } },
      { isRead: true }
    );

    const io = req.app.get("io");
    if (io) {
      io.to(conversationId).emit("messages_read", { conversationId, userId });
    }

    res.json({ message: "Messages marked as read", conversationId });
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: "Server error" });
  }
};

export const editMessage = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { messageId } = req.params;
    const { content } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "User not authenticated" });
      return;
    }

    const message = await Message.findById(messageId);
    if (!message) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Message not found" });
      return;
    }

    if (message.senderId.toString() !== userId) {
      res.status(HTTP_STATUS.FORBIDDEN).json({ error: "Not authorized to edit this message" });
      return;
    }

    message.content = content;
    message.edited = true;
    message.editedAt = new Date();

    await message.save();
    await message.populate("senderId", "username avatar");

    const io = req.app.get("io");
    if (io) {
      io.to(message.conversationId.toString()).emit("message_edited", {
        message,
      });
    }

    res.json({ message });
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: "Server error" });
  }
};

export const deleteMessage = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { messageId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "User not authenticated" });
      return;
    }

    const message = await Message.findById(messageId);
    if (!message) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Message not found" });
      return;
    }

    if (message.senderId.toString() !== userId) {
      res.status(HTTP_STATUS.FORBIDDEN).json({ error: "Not authorized to delete this message" });
      return;
    }

    await Message.deleteOne({ _id: messageId });

    const io = req.app.get("io");
    if (io) {
      io.to(message.conversationId.toString()).emit("message_deleted", {
        messageId,
      });
    }

    res.json({ message: "Message deleted successfully" });
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: "Server error" });
  }
};

export const addReaction = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "User not authenticated" });
      return;
    }

    const message = await Message.findById(messageId);
    if (!message) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Message not found" });
      return;
    }

    message.reactions =
      message.reactions?.filter((r) => r.userId.toString() !== userId) || [];
    message.reactions.push({ userId, emoji });

    await message.save();
    await message.populate([
      {
        path: "senderId",
        select: "username name avatar",
      },
      {
        path: "reactions",
        populate: {
          path: "userId",
          select: "username name avatar",
        },
      },
    ]);

    const io = req.app.get("io");
    if (io) {
      io.to(message.conversationId.toString()).emit("reaction_added", {
        message,
      });
    }

    res.json({ message });
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: "Server error" });
  }
};

export const removeReaction = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { messageId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "User not authenticated" });
      return;
    }

    const message = await Message.findById(messageId);
    if (!message) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Message not found" });
      return;
    }

    message.reactions =
      message.reactions?.filter((r) => r.userId.toString() !== userId) || [];

    await message.save();
    await message.populate("senderId", "username avatar");

    const io = req.app.get("io");
    if (io) {
      io.to(message.conversationId.toString()).emit("reaction_removed", {
        message,
      });
    }

    res.json({ message });
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: "Server error" });
  }
};

export const fileUploader = async (req: AuthRequest, res: Response) => {
  try {
    const { fileType } = req.body;
    const file = req.file as Express.Multer.File;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "User not authenticated" });
      return;
    }

    if (!file) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: "You must upload a file" });
      return;
    }

    res.status(HTTP_STATUS.CREATED).json({
      fileUrl: file.path,
      fileName: file.originalname,
      fileType: fileType,
    });
  } catch (error: any) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: "Server Error", details: error.message });
  }
};

export const pinMessage = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { conversationId, messageId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "User not authenticated" });
      return;
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Conversation not found" });
      return;
    }

    if (
      !conversation.participants.includes(userId) ||
      (conversation.type === "group" && !conversation.admins?.includes(userId))
    ) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "Not authorized to pin messages in this conversation" });
      return;
    }

    const message = await Message.findById(messageId);
    if (!message || message.conversationId.toString() !== conversationId) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Message not found" });
      return;
    }
    const messageObjectId = new Types.ObjectId(messageId);

    if (!conversation.pinnedMessages.includes(messageObjectId)) {
      conversation.pinnedMessages.push(messageObjectId);
      await conversation.save();
    }

    const io = req.app.get("io");
    if (io) {
      io.to(conversationId).emit("message_pinned", {
        conversationId,
        messageId,
      });
    }

    res.json({ message: "Message pinned successfully", conversation });
  } catch (error: any) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      error: "Server error",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const unpinMessage = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { conversationId, messageId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "User not authenticated" });
      return;
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Conversation not found" });
      return;
    }

    if (
      !conversation.participants.includes(userId) ||
      (conversation.type === "group" && !conversation.admins?.includes(userId))
    ) {
      res.status(HTTP_STATUS.FORBIDDEN).json({
        error: "Not authorized to unpin messages in this conversation",
      });
      return;
    }

    conversation.pinnedMessages = conversation.pinnedMessages.filter(
      (id) => id.toString() !== messageId
    );
    await conversation.save();

    const io = req.app.get("io");
    if (io) {
      io.to(conversationId).emit("message_unpinned", {
        conversationId,
        messageId,
      });
    }

    res.json({ message: "Message unpinned successfully", conversation });
  } catch (error: any) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      error: "Server error",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const forwardMessage = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { messageId, targetConversationId } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "User not authenticated" });
      return;
    }

    const message = await Message.findById(messageId);
    if (!message) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Message not found" });
      return;
    }

    const targetConversation = await Conversation.findById(
      targetConversationId
    );
    if (!targetConversation) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Target conversation not found" });
      return;
    }

    if (!targetConversation.participants.includes(userId)) {
      res.status(HTTP_STATUS.FORBIDDEN).json({
        error: "Not authorized to send messages to the target conversation",
      });
      return;
    }

    const forwardedMessage = new Message({
      content: message.content,
      senderId: userId,
      conversationId: targetConversationId,
      messageType: message.messageType,
      fileUrl: message.fileUrl,
      fileName: message.fileName,
      createdAt: new Date(),
      updatedAt: new Date(),
      isRead: false,
      reactions: [],
      edited: false,
      replyTo: null,
    });

    await forwardedMessage.save();
    await forwardedMessage.populate("senderId", "username avatar");

    await Conversation.findByIdAndUpdate(targetConversationId, {
      lastMessage: forwardedMessage._id,
      updatedAt: new Date(),
    });

    const io = req.app.get("io");
    if (io) {
      io.to(targetConversationId).emit("new_message", {
        message: forwardedMessage,
      });
    }

    const sender = await User.findById(userId).select("username name");
    for (const participantId of targetConversation.participants) {
      if (participantId.toString() !== userId) {
        await NotificationService.createNotification({
          recipientId: participantId.toString(),
          senderId: userId,
          type: "message",
          message: `${
            sender?.username || sender?.name || "Someone"
          } forwarded a message`,
          entityType: "message",
          entityId: forwardedMessage._id,
          actionUrl: `/conversation/${targetConversationId}`,
        });
      }
    }

    res
      .status(HTTP_STATUS.CREATED)
      .json({ message: "Message forwarded successfully", forwardedMessage });
  } catch (error: any) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      error: "Server error",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const starMessage = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { messageId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "User not authenticated" });
      return;
    }

    const message = await Message.findById(messageId);
    if (!message) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Message not found" });
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "User not found" });
      return;
    }

    const messageObjectId = new Types.ObjectId(messageId);
    if (!user.starredMessages.includes(messageObjectId)) {
      user.starredMessages.push(messageObjectId);
      await user.save();
    }

    res.json({ message: "Message starred successfully" });
  } catch (error: any) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      error: "Server error",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const unstarMessage = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { messageId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "User not authenticated" });
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "User not found" });
      return;
    }

    user.starredMessages = user.starredMessages.filter(
      (id) => id.toString() !== messageId
    );
    await user.save();

    res.json({ message: "Message unstarred successfully" });
  } catch (error: any) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      error: "Server error",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const getMessageInfo = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { messageId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: "User not authenticated" });
      return;
    }

    const message = await Message.findById(messageId)
      .populate("senderId", "username avatar")
      .populate("conversationId", "participants");
    if (!message) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Message not found" });
      return;
    }

    const conversation = await Conversation.findById(message.conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      res.status(HTTP_STATUS.FORBIDDEN).json({ error: "Not authorized to view message info" });
      return;
    }

    const readBy = await Message.find({
      conversationId: message.conversationId,
      isRead: true,
    })
      .populate("senderId", "username")
      .select("senderId isRead updatedAt");

    const readInfo = readBy
      .filter((msg) => msg._id.toString() === messageId)
      .map((msg) => ({
        user: msg.senderId,
        readAt: new Date(),
      }));

    res.json({
      messageId: message._id,
      content: message.content,
      sender: message.senderId,
      createdAt: new Date(),
      updatedAt: new Date(),
      isRead: message.isRead,
      readBy,
    });
  } catch (error: any) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      error: "Server error",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const sharePostToChat = async (req: AuthRequest, res: Response) => {
  const { conversationId, content, postId } = req.body;
  const userId = req.user?.userId; 
  if (!userId) {
    res.status(HTTP_STATUS.UNAUTHORIZED);
    throw new Error("User not authenticated");
  }

  if (!conversationId || !content || !postId) {
    res.status(HTTP_STATUS.BAD_REQUEST);
    throw new Error("Conversation ID, content, and post ID are required");
  }

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    res.status(HTTP_STATUS.NOT_FOUND);
    throw new Error("Conversation not found");
  }

  if (!conversation.participants.includes(userId)) {
    res.status(HTTP_STATUS.FORBIDDEN);
    throw new Error("User not part of this conversation");
  }

  const message = new Message({
    conversationId,
    senderId: userId,
    content,
    messageType: "post",
    postId,
    isRead: false,
    edited: false,
    reactions: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await message.save();

  conversation.lastMessage = new mongoose.Types.ObjectId(message._id);
  await conversation.save();

  const populatedMessage = await Message.findById(message._id)
    .populate("senderId", "username avatar")
    .lean();

  const io = req.app.get("io");

  if (io) {
    io.to(conversationId).emit("new_message", { message: populatedMessage });
  }
  res.status(HTTP_STATUS.CREATED).json({ message: populatedMessage });
};
