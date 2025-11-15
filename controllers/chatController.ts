import mongoose, { Types } from "mongoose";
import { Response } from "express";
import { Conversation } from "../Models/Conversation";
import { Message } from "../Models/Message";
import { AuthRequest } from "../types";
import { User } from "../Models/User";
import { NotificationService } from "../services/notificationServices";
import { Post } from "../Models/Post";
import { HTTP_STATUS } from "../utils/constant";
import { UserSettings } from "../Models/userSettings";

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

export const canReceiveMessagesFrom = async (
  recipientId: string,
  senderId: string
): Promise<{ allowed: boolean; reason?: string }> => {
  const recipientSettings = await UserSettings.findOne({ userId: recipientId });
  
  if (!recipientSettings) {
    return { allowed: true };
  }

  const isBlocked = await areUsersBlocked(recipientId, senderId);
  if (isBlocked) {
    return { allowed: false, reason: "User is blocked" };
  }

  const allowMessagesFrom = recipientSettings.privacy.allowMessagesFrom;

  if (allowMessagesFrom === "everyone") {
    return { allowed: true };
  }

  if (allowMessagesFrom === "none") {
    return { allowed: false, reason: "User does not accept messages" };
  }

  if (allowMessagesFrom === "friends") {
    const recipient = await User.findById(recipientId).select("following");
    const sender = await User.findById(senderId).select("following");
    
    const senderIdObj = new mongoose.Types.ObjectId(senderId);
    const recipientIdObj = new mongoose.Types.ObjectId(recipientId);
    
    const areFollowingEachOther =
      recipient?.following.some((id) => id.equals(senderIdObj)) &&
      sender?.following.some((id) => id.equals(recipientIdObj));

    if (!areFollowingEachOther) {
      return { allowed: false, reason: "User only accepts messages from friends" };
    }
  }

  return { allowed: true };
};

export const shouldSendNotification = async (
  recipientId: string,
  notificationType: 'messageReceived'
): Promise<boolean> => {
  const recipientSettings = await UserSettings.findOne({ userId: recipientId });
  return recipientSettings?.notifications.inApp[notificationType] ?? true;
};

export const getConversations = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: "User not authenticated" });
      return;
    }

    const userSettings = await UserSettings.findOne({ userId });
    if (userSettings?.account.isDeactivated) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "Account is deactivated" });
      return;
    }

    const blockedUsers = userSettings?.security.blockedUsers || [];

    const conversations = await Conversation.find({
      participants: userId,
    })
      .populate("participants", "username avatar online email")
      .populate({
        path: "lastMessage",
        populate: { path: "senderId", select: "username avatar" },
      })
      .populate("admins", "username avatar")
      .sort({ updatedAt: -1 });

    const filteredConversations = conversations.filter((conv) => {
      const hasBlockedUser = conv.participants.some((participant: any) =>
        blockedUsers.some((blockedId) => blockedId.equals(participant._id))
      );
      return !hasBlockedUser;
    });

    const conversationsWithUnread = await Promise.all(
      filteredConversations.map(async (conv) => {
        const unreadCount = await Message.countDocuments({
          conversationId: conv._id,
          senderId: { $ne: userId },
          'readBy.userId': { $ne: userId }
        });
        
        return {
          ...conv.toObject(),
          unreadCount
        };
      })
    );

    const chatsWithUnreadCount = conversationsWithUnread.filter(
      conv => conv.unreadCount > 0
    ).length;

    res.status(200).json({ 
      conversations: conversationsWithUnread, 
      chatsWithUnreadCount 
    });
  } catch (error) {
    console.error("Get conversations error:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ error: "Server error" });
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
      res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: "User not authenticated" });
      return;
    }

    const userSettings = await UserSettings.findOne({ userId });
    if (userSettings?.account.isDeactivated) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "Cannot create conversation: Account is deactivated" });
      return;
    }

    if (type === "direct" && participantIds.length !== 1) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: "Direct conversation must have exactly one other participant",
      });
      return;
    }

    if (type === "group" && (!name || name.trim().length === 0)) {
      res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json({ error: "Group conversation must have a name" });
      return;
    }

    if (type === "direct") {
      const otherUserId = participantIds[0];
      const canMessage = await canReceiveMessagesFrom(otherUserId, userId);
      
      if (!canMessage.allowed) {
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: canMessage.reason || "Cannot create conversation with this user" });
        return;
      }
    }

    if (type === "group") {
      for (const participantId of participantIds) {
        const isBlocked = await areUsersBlocked(userId, participantId);
        if (isBlocked) {
          res
            .status(HTTP_STATUS.FORBIDDEN)
            .json({ error: "Cannot create group with blocked users" });
          return;
        }
      }
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

    res.status(HTTP_STATUS.CREATED).json(conversation);
  } catch (error: any) {
    console.error("Conversation creation error:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ error: "Server error", details: error.message });
  }
};

export const getMessages = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { conversationId } = req.params;
    const userId = req.user?.userId;
    const { page = 1, limit = 50 } = req.query;

    if (!userId) {
      res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: "User not authenticated" });
      return;
    }

    const userSettings = await UserSettings.findOne({ userId });
    if (userSettings?.account.isDeactivated) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "Account is deactivated" });
      return;
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "Not authorized to view these messages" });
      return;
    }

    const blockedUsers = userSettings?.security.blockedUsers || [];

    const messages = await Message.find({ 
      conversationId,
      senderId: { $nin: blockedUsers } 
    })
      .populate([
        { path: "senderId", select: "username avatar" },
        { path: "reactions.userId", select: "username avatar" },
        {
          path: "replyTo",
          select: "content senderId messageType fileUrl fileName",
          populate: { path: "senderId", select: "username avatar" },
        },
        { path: "readBy.userId", select: "username avatar" },
      ])
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

    res.status(200).json(messages.reverse());
  } catch (error) {
    console.error("Get messages error:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ error: "Server error" });
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
      postId,
    } = req.body;
    const senderId = req.user?.userId;

    if (!senderId) {
      res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: "User not authenticated" });
      return;
    }

    const senderSettings = await UserSettings.findOne({ userId: senderId });
    if (senderSettings?.account.isDeactivated) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "Cannot send message: Account is deactivated" });
      return;
    }

    if (!conversationId) {
      res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json({ error: "Conversation ID is required" });
      return;
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      res
        .status(HTTP_STATUS.NOT_FOUND)
        .json({ error: "Conversation not found" });
      return;
    }

    if (!conversation.participants.includes(senderId)) {
      res.status(HTTP_STATUS.FORBIDDEN).json({
        error: "Not authorized to send messages to this conversation",
      });
      return;
    }

    if (conversation.type === "direct") {
      const otherParticipant = conversation.participants.find(
        (p) => p.toString() !== senderId
      );
      
      if (otherParticipant) {
        const canMessage = await canReceiveMessagesFrom(
          otherParticipant.toString(),
          senderId
        );
        
        if (!canMessage.allowed) {
          res
            .status(HTTP_STATUS.FORBIDDEN)
            .json({ error: canMessage.reason || "Cannot send message to this user" });
          return;
        }
      }
    }

    if (replyTo) {
      const repliedMessage = await Message.findById(replyTo);
      if (
        !repliedMessage ||
        repliedMessage.conversationId.toString() !== conversationId
      ) {
        res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json({ error: "Invalid replyTo message ID" });
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
      reactions: [],
      edited: false,
      readBy: [], 
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

    if (messageType === "post" && postId) {
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

    const sender = await User.findById(senderId).select("username avatar");
    
    for (const participantId of conversation.participants) {
      if (participantId.toString() !== senderId) {
        const shouldNotify = await shouldSendNotification(
          participantId.toString(),
          'messageReceived'
        );

        if (shouldNotify) {
          await NotificationService.createNotification({
            recipientId: participantId.toString(),
            senderId,
            type: "message",
            message: `${sender?.username || "Someone"} sent a new message`,
            entityType: "message",
            entityId: message._id,
            actionUrl: `/chat/${conversationId}`,
          });
        }

        if (req.io) {
          req.io.to(participantId.toString()).emit("unread_count_update", {
            conversationId,
            increment: true
          });
        }
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
      res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: "User not authenticated" });
      return;
    }

    const userSettings = await UserSettings.findOne({ userId });
    if (userSettings?.account.isDeactivated) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "Cannot update conversation: Account is deactivated" });
      return;
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      res
        .status(HTTP_STATUS.NOT_FOUND)
        .json({ error: "Conversation not found" });
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

    if (participants && participants.length > 0) {
      for (const newParticipantId of participants) {
        const isBlocked = await areUsersBlocked(userId, newParticipantId);
        if (isBlocked) {
          res
            .status(HTTP_STATUS.FORBIDDEN)
            .json({ error: "Cannot add blocked users to conversation" });
          return;
        }
      }
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

    res.status(200).json(conversation);
  } catch (error) {
    console.error("Update conversation error:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ error: "Server error" });
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
      res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: "User not authenticated" });
      return;
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      res
        .status(HTTP_STATUS.NOT_FOUND)
        .json({ error: "Conversation not found" });
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

    res
      .status(200)
      .json({ message: "Conversation deleted or left successfully" });
  } catch (error) {
    console.error("Delete conversation error:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ error: "Server error" });
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
      res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: "User not authenticated" });
      return;
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "Not authorized" });
      return;
    }

    await Message.updateMany(
      {
        conversationId,
        senderId: { $ne: userId },
        "readBy.userId": { $ne: userId },
      },
      { $push: { readBy: { userId, readAt: new Date() } } }
    );

    const user = await User.findById(userId);
    const io = req.app.get("io");
    if (io) {
      io.to(conversationId).emit("messages_read", {
        conversationId,
        userId: { _id: user._id, avatar: user.avatar, username: user.username },
      });
    }

    res
      .status(200)
      .json({ message: "Messages marked as read", conversationId, userId });
  } catch (error) {
    console.error("Mark messages as read error:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ error: "Server error" });
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
      res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: "User not authenticated" });
      return;
    }

    const userSettings = await UserSettings.findOne({ userId });
    if (userSettings?.account.isDeactivated) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "Cannot edit message: Account is deactivated" });
      return;
    }

    const message = await Message.findById(messageId);
    if (!message) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Message not found" });
      return;
    }

    if (message.senderId.toString() !== userId) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "Not authorized to edit this message" });
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

    res.status(200).json({ message });
  } catch (error) {
    console.error("Edit message error:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ error: "Server error" });
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
      res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: "User not authenticated" });
      return;
    }

    const message = await Message.findById(messageId);
    if (!message) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Message not found" });
      return;
    }

    if (message.senderId.toString() !== userId) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "Not authorized to delete this message" });
      return;
    }

    await Message.deleteOne({ _id: messageId });

    const io = req.app.get("io");
    if (io) {
      io.to(message.conversationId.toString()).emit("message_deleted", {
        messageId,
      });
    }

    res.status(200).json({ message: "Message deleted successfully" });
  } catch (error) {
    console.error("Delete message error:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ error: "Server error" });
  }
};

export const addReaction = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { messageId } = req.params;
    const { emoji, name } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: "User not authenticated" });
      return;
    }

    const message = await Message.findById(messageId);
    if (!message) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Message not found" });
      return;
    }

    const isBlocked = await areUsersBlocked(userId, message.senderId.toString());
    if (isBlocked) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "Cannot react to this message" });
      return;
    }

    const conversation = await Conversation.findById(message.conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "Not authorized to react to this message" });
      return;
    }

    message.reactions = message.reactions.filter(
      (reaction, index, self) =>
        index ===
        self.findIndex(
          (r) => r.userId.toString() === reaction.userId.toString()
        )
    );
    
    const existingReactionIndex = message.reactions.findIndex(
      (r) => r.userId.toString() === userId
    );

    let isLiked = false;
    let actionType = "";

    if (existingReactionIndex !== -1) {
      const existingReaction = message.reactions[existingReactionIndex];
      if (existingReaction.emoji.category === emoji) {
        message.reactions.splice(existingReactionIndex, 1);
        isLiked = false;
        actionType = "removed";
      } else {
        message.reactions[existingReactionIndex].emoji = {
          category: emoji,
          name,
        };
        isLiked = true;
        actionType = "updated";
      }
    } else {
      message.reactions.push({
        userId: userId,
        emoji: { category: emoji, name },
      });
      isLiked = true;
      actionType = "added";
    }

    await message.save();
    await message.populate([
      {
        path: "senderId",
        select: "username avatar",
      },
      {
        path: "reactions",
        populate: {
          path: "userId",
          select: "username avatar",
        },
      },
    ]);

    const io = req.app.get("io");
    if (io) {
      io.to(message.conversationId.toString()).emit("reaction_added", {
        message,
      });
    }

    res.status(200).json({ message });
  } catch (error) {
    console.error("Add reaction error:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ error: "Server error" });
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
      res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: "User not authenticated" });
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

    res.status(200).json({ message });
  } catch (error) {
    console.error("Remove reaction error:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ error: "Server error" });
  }
};

export const fileUploader = async (req: AuthRequest, res: Response) => {
  try {
    const { fileType } = req.body;
    const file = req.file as Express.Multer.File;
    const userId = req.user?.userId;

    if (!userId) {
      res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: "User not authenticated" });
      return;
    }

    const userSettings = await UserSettings.findOne({ userId });
    if (userSettings?.account.isDeactivated) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "Cannot upload file: Account is deactivated" });
      return;
    }

    if (!file) {
      res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json({ error: "You must upload a file" });
      return;
    }

    res.status(HTTP_STATUS.CREATED).json({
      fileUrl: file.path,
      fileName: file.originalname,
      fileType: fileType,
    });
  } catch (error: any) {
    console.error("File upload error:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ error: "Server Error", details: error.message });
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
      res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: "User not authenticated" });
      return;
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      res
        .status(HTTP_STATUS.NOT_FOUND)
        .json({ error: "Conversation not found" });
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

    const isBlocked = await areUsersBlocked(userId, message.senderId.toString());
    if (isBlocked) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "Cannot pin message from blocked user" });
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

    res
      .status(200)
      .json({ message: "Message pinned successfully", conversation });
  } catch (error: any) {
    console.error("Pin message error:", error);
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
      res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: "User not authenticated" });
      return;
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      res
        .status(HTTP_STATUS.NOT_FOUND)
        .json({ error: "Conversation not found" });
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

    res
      .status(200)
      .json({ message: "Message unpinned successfully", conversation });
  } catch (error: any) {
    console.error("Unpin message error:", error);
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
      res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: "User not authenticated" });
      return;
    }

    const userSettings = await UserSettings.findOne({ userId });
    if (userSettings?.account.isDeactivated) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "Cannot forward message: Account is deactivated" });
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
      res
        .status(HTTP_STATUS.NOT_FOUND)
        .json({ error: "Target conversation not found" });
      return;
    }

    if (!targetConversation.participants.includes(userId)) {
      res.status(HTTP_STATUS.FORBIDDEN).json({
        error: "Not authorized to send messages to the target conversation",
      });
      return;
    }

    if (targetConversation.type === "direct") {
      const otherParticipant = targetConversation.participants.find(
        (p) => p.toString() !== userId
      );
      
      if (otherParticipant) {
        const canMessage = await canReceiveMessagesFrom(
          otherParticipant.toString(),
          userId
        );
        
        if (!canMessage.allowed) {
          res
            .status(HTTP_STATUS.FORBIDDEN)
            .json({ error: canMessage.reason || "Cannot forward message to this user" });
          return;
        }
      }
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

    const sender = await User.findById(userId).select("username");
    for (const participantId of targetConversation.participants) {
      if (participantId.toString() !== userId) {
        const shouldNotify = await shouldSendNotification(
          participantId.toString(),
          'messageReceived'
        );

        if (shouldNotify) {
          await NotificationService.createNotification({
            recipientId: participantId.toString(),
            senderId: userId,
            type: "message",
            message: `${sender?.username || "Someone"} forwarded a message`,
            entityType: "message",
            entityId: forwardedMessage._id,
            actionUrl: `/conversation/${targetConversationId}`,
          });
        }
      }
    }

    res
      .status(HTTP_STATUS.CREATED)
      .json({ message: "Message forwarded successfully", forwardedMessage });
  } catch (error: any) {
    console.error("Forward message error:", error);
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
      res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: "User not authenticated" });
      return;
    }

    const message = await Message.findById(messageId);
    if (!message) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Message not found" });
      return;
    }

    const conversation = await Conversation.findById(message.conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "Not authorized to star this message" });
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

    res.status(200).json({ message: "Message starred successfully" });
  } catch (error: any) {
    console.error("Star message error:", error);
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
      res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: "User not authenticated" });
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

    res.status(200).json({ message: "Message unstarred successfully" });
  } catch (error: any) {
    console.error("Unstar message error:", error);
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
      res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: "User not authenticated" });
      return;
    }

    const message = await Message.findById(messageId)
      .populate("senderId", "username avatar")
      .populate("readBy.userId", "username avatar");

    if (!message) {
      res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Message not found" });
      return;
    }

    const conversation = await Conversation.findById(message.conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "Not authorized to view message info" });
      return;
    }

    res.status(200).json({
      messageId: message._id,
      content: message.content,
      sender: message.senderId,
      readBy: message.readBy.map((rb) => ({
        userId: rb.userId,
        readAt: rb.readAt,
      })),
      timestamp: message.timestamp
    });
  } catch (error: any) {
    console.error("Get message info error:", error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      error: "Server error",
      details: error.message,
    });
  }
};

export const sharePostToChat = async (req: AuthRequest, res: Response) => {
  try {
    const { conversationId, content, postId } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: "User not authenticated" });
      return;
    }

    const userSettings = await UserSettings.findOne({ userId });
    if (userSettings?.account.isDeactivated) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "Cannot share post: Account is deactivated" });
      return;
    }

    if (!conversationId || !content || !postId) {
      res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json({ error: "Conversation ID, content, and post ID are required" });
      return;
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      res
        .status(HTTP_STATUS.NOT_FOUND)
        .json({ error: "Conversation not found" });
      return;
    }

    if (!conversation.participants.includes(userId)) {
      res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: "User not part of this conversation" });
      return;
    }

    if (conversation.type === "direct") {
      const otherParticipant = conversation.participants.find(
        (p) => p.toString() !== userId
      );
      
      if (otherParticipant) {
        const canMessage = await canReceiveMessagesFrom(
          otherParticipant.toString(),
          userId
        );
        
        if (!canMessage.allowed) {
          res
            .status(HTTP_STATUS.FORBIDDEN)
            .json({ error: canMessage.reason || "Cannot share post to this user" });
          return;
        }
      }
    }

    const post = await Post.findById(postId);
    if (post) {
      const isBlocked = await areUsersBlocked(userId, post.authorId.toString());
      if (isBlocked) {
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: "Cannot share post from blocked user" });
        return;
      }
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

    const sender = await User.findById(userId).select("username");
    for (const participantId of conversation.participants) {
      if (participantId.toString() !== userId) {
        const shouldNotify = await shouldSendNotification(
          participantId.toString(),
          'messageReceived'
        );

        if (shouldNotify) {
          await NotificationService.createNotification({
            recipientId: participantId.toString(),
            senderId: userId,
            type: "message",
            message: `${sender?.username || "Someone"} shared a post`,
            entityType: "message",
            entityId: message._id,
            actionUrl: `/chat/${conversationId}`,
          });
        }
      }
    }

    res.status(HTTP_STATUS.CREATED).json({ message: populatedMessage });
  } catch (error: any) {
    console.error("Share post to chat error:", error);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ error: "Server error", details: error.message });
  }
};