const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/auth");
const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const logger = require("../utils/logger");

// Get messages
router.get("/:conversationId", authMiddleware, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50, before } = req.query;

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Conversation not found",
      });
    }

    if (!conversation.isParticipant(req.user.id, req.user.type)) {
      return res.status(403).json({
        success: false,
        error: "Access denied",
      });
    }

    const query = {
      conversationId,
      isDeleted: false,
    };

    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    const total = await Message.countDocuments({
      conversationId,
      isDeleted: false,
    });

    const hasMore = messages.length === parseInt(limit);

    res.json({
      success: true,
      messages: messages.reverse(),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        hasMore,
        oldest: messages.length > 0 ? messages[0].createdAt : null,
      },
    });
  } catch (error) {
    logger.error("Get messages error:", error);
    res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
});

// Send message
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { conversationId, message, messageType = "text", replyTo } = req.body;

    if (!conversationId || !message || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "conversationId and message are required",
      });
    }

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Conversation not found",
      });
    }

    if (!conversation.isParticipant(req.user.id, req.user.type)) {
      return res.status(403).json({
        success: false,
        error: "Access denied",
      });
    }

    const newMessage = new Message({
      conversationId,
      senderId: req.user.id,
      senderType: req.user.type,
      senderName: req.user.name,
      senderEmail: req.user.email,
      senderProfile: req.user.profile,
      message: message.trim(),
      messageType,
      replyTo,
    });

    await newMessage.save();

    conversation.lastMessage = {
      message: message.trim(),
      senderId: req.user.id,
      senderName: req.user.name,
      timestamp: new Date(),
    };
    conversation.updatedAt = new Date();
    await conversation.save();

    logger.success("Message sent:", {
      id: newMessage._id,
      conversation: conversationId,
    });

    res.status(201).json({
      success: true,
      message: newMessage,
    });
  } catch (error) {
    logger.error("Send message error:", error);
    res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
});

// Mark as read
router.post("/:conversationId/read", authMiddleware, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { messageIds } = req.body;

    const query = {
      conversationId,
      senderId: { $ne: req.user.id },
      "readBy.userId": { $ne: req.user.id },
      isDeleted: false,
    };

    if (messageIds && Array.isArray(messageIds)) {
      query._id = { $in: messageIds };
    }

    const result = await Message.updateMany(query, {
      $push: {
        readBy: {
          userId: req.user.id,
          userType: req.user.type,
          userName: req.user.name,
          readAt: new Date(),
        },
      },
    });

    logger.info("Messages marked as read:", {
      conversation: conversationId,
      count: result.modifiedCount,
    });

    res.json({
      success: true,
      markedCount: result.modifiedCount,
      message: `${result.modifiedCount} messages marked as read`,
    });
  } catch (error) {
    logger.error("Mark read error:", error);
    res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
});

// Get unread count
router.get(
  "/:conversationId/unread-count",
  authMiddleware,
  async (req, res) => {
    try {
      const { conversationId } = req.params;

      const count = await Message.getUnreadCount(
        conversationId,
        req.user.id,
        req.user.type
      );

      res.json({
        success: true,
        conversationId,
        unreadCount: count,
      });
    } catch (error) {
      logger.error("Get unread count error:", error);
      res.status(500).json({
        success: false,
        error: "Server error",
      });
    }
  }
);

// Edit message
router.put("/:messageId", authMiddleware, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Message cannot be empty",
      });
    }

    const msg = await Message.findById(messageId);

    if (!msg) {
      return res.status(404).json({
        success: false,
        error: "Message not found",
      });
    }

    if (msg.senderId !== req.user.id || msg.senderType !== req.user.type) {
      return res.status(403).json({
        success: false,
        error: "You can only edit your own messages",
      });
    }

    if (msg.messageType === "system") {
      return res.status(400).json({
        success: false,
        error: "Cannot edit system messages",
      });
    }

    msg.message = message.trim();
    msg.isEdited = true;
    msg.editedAt = new Date();
    await msg.save();

    res.json({
      success: true,
      message: msg,
    });
  } catch (error) {
    logger.error("Edit message error:", error);
    res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
});

// Delete message
router.delete("/:messageId", authMiddleware, async (req, res) => {
  try {
    const { messageId } = req.params;

    const msg = await Message.findById(messageId);

    if (!msg) {
      return res.status(404).json({
        success: false,
        error: "Message not found",
      });
    }

    if (msg.senderId !== req.user.id || msg.senderType !== req.user.type) {
      return res.status(403).json({
        success: false,
        error: "You can only delete your own messages",
      });
    }

    msg.isDeleted = true;
    msg.deletedAt = new Date();
    await msg.save();

    res.json({
      success: true,
      message: "Message deleted successfully",
    });
  } catch (error) {
    logger.error("Delete message error:", error);
    res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
});

module.exports = router;
