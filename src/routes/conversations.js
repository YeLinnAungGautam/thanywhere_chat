const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/auth");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const logger = require("../utils/logger");

// Get all conversations
router.get("/", authMiddleware, async (req, res) => {
  try {
    const { type } = req.query;

    const query = {
      "participants.id": req.user.id,
      "participants.type": req.user.type,
      isActive: true,
    };

    if (type) {
      query.type = type;
    }

    const conversations = await Conversation.find(query)
      .sort({ updatedAt: -1 })
      .lean();

    // Get unread count
    const conversationsWithUnread = await Promise.all(
      conversations.map(async (conv) => {
        const unreadCount = await Message.getUnreadCount(
          conv._id,
          req.user.id,
          req.user.type
        );
        return {
          ...conv,
          unreadCount,
        };
      })
    );

    res.json({
      success: true,
      conversations: conversationsWithUnread,
      count: conversationsWithUnread.length,
    });
  } catch (error) {
    logger.error("Get conversations error:", error);
    res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
});

// Get conversation by ID
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id);

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

    const unreadCount = await Message.getUnreadCount(
      conversation._id,
      req.user.id,
      req.user.type
    );

    res.json({
      success: true,
      conversation: {
        ...conversation.toObject(),
        unreadCount,
      },
    });
  } catch (error) {
    logger.error("Get conversation error:", error);
    res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
});

// Create conversation
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { type, participants, name, description } = req.body;

    if (!type || !participants || !Array.isArray(participants)) {
      return res.status(400).json({
        success: false,
        error: "Invalid data: type and participants are required",
      });
    }

    if (participants.length === 0) {
      return res.status(400).json({
        success: false,
        error: "At least one participant is required",
      });
    }

    // Add current user to participants
    const currentUserIncluded = participants.some(
      (p) => p.id === req.user.id && p.type === req.user.type
    );

    const allParticipants = currentUserIncluded
      ? participants
      : [
          {
            id: req.user.id,
            type: req.user.type,
            name: req.user.name,
            email: req.user.email,
            firstName: req.user.firstName,
            lastName: req.user.lastName,
            profile: req.user.profile,
          },
          ...participants,
        ];

    // Validate one-on-one
    if (type === "admin-to-admin" || type === "admin-to-user") {
      if (allParticipants.length !== 2) {
        return res.status(400).json({
          success: false,
          error: "One-on-one chat requires exactly 2 participants",
        });
      }

      // Check existing
      const participantIds = allParticipants.map((p) => p.id).sort();

      const existing = await Conversation.findOne({
        type,
        isActive: true,
        $expr: {
          $and: [
            { $eq: [{ $size: "$participants" }, 2] },
            {
              $setEquals: [
                { $map: { input: "$participants", as: "p", in: "$$p.id" } },
                participantIds,
              ],
            },
          ],
        },
      });

      if (existing) {
        return res.json({
          success: true,
          conversation: existing,
          message: "Conversation already exists",
          isNew: false,
        });
      }
    }

    // Group validation
    if (type === "admin-group") {
      if (!name) {
        return res.status(400).json({
          success: false,
          error: "Group name is required",
        });
      }

      if (allParticipants.length < 3) {
        return res.status(400).json({
          success: false,
          error: "Group chat requires at least 3 participants",
        });
      }
    }

    // Create
    const conversation = new Conversation({
      type,
      name,
      description,
      participants: allParticipants,
      createdBy: {
        id: req.user.id,
        type: req.user.type,
        name: req.user.name,
      },
    });

    await conversation.save();

    logger.success("Conversation created:", {
      id: conversation._id,
      type: conversation.type,
    });

    res.status(201).json({
      success: true,
      conversation,
      message: "Conversation created successfully",
      isNew: true,
    });
  } catch (error) {
    logger.error("Create conversation error:", error);
    res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
});

// Add participant
router.post("/:id/participants", authMiddleware, async (req, res) => {
  try {
    const { participant } = req.body;

    if (!participant || !participant.id || !participant.type) {
      return res.status(400).json({
        success: false,
        error: "Invalid participant data",
      });
    }

    const conversation = await Conversation.findById(req.params.id);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Conversation not found",
      });
    }

    if (conversation.type !== "admin-group") {
      return res.status(400).json({
        success: false,
        error: "Can only add participants to group conversations",
      });
    }

    if (
      conversation.createdBy.id !== req.user.id &&
      req.user.type !== "admin"
    ) {
      return res.status(403).json({
        success: false,
        error: "Only creator can add participants",
      });
    }

    conversation.addParticipant(participant);
    await conversation.save();

    res.json({
      success: true,
      conversation,
      message: "Participant added successfully",
    });
  } catch (error) {
    logger.error("Add participant error:", error);
    res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
});

// Remove participant
router.delete(
  "/:id/participants/:userId/:userType",
  authMiddleware,
  async (req, res) => {
    try {
      const { userId, userType } = req.params;

      const conversation = await Conversation.findById(req.params.id);

      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: "Conversation not found",
        });
      }

      if (conversation.type !== "admin-group") {
        return res.status(400).json({
          success: false,
          error: "Can only remove participants from group conversations",
        });
      }

      const isSelf = userId === req.user.id && userType === req.user.type;
      const isCreator = conversation.createdBy.id === req.user.id;

      if (!isSelf && !isCreator) {
        return res.status(403).json({
          success: false,
          error: "Access denied",
        });
      }

      conversation.removeParticipant(userId, userType);
      await conversation.save();

      res.json({
        success: true,
        conversation,
        message: "Participant removed successfully",
      });
    } catch (error) {
      logger.error("Remove participant error:", error);
      res.status(500).json({
        success: false,
        error: "Server error",
      });
    }
  }
);

// Delete conversation
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Conversation not found",
      });
    }

    if (conversation.createdBy.id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: "Only creator can delete conversation",
      });
    }

    conversation.isActive = false;
    await conversation.save();

    logger.info("Conversation archived:", conversation._id);

    res.json({
      success: true,
      message: "Conversation deleted successfully",
    });
  } catch (error) {
    logger.error("Delete conversation error:", error);
    res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
});

module.exports = router;
