const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/auth");
const UserCache = require("../models/UserCache");
const logger = require("../utils/logger");

// Verify token
router.post("/verify", authMiddleware, async (req, res) => {
  try {
    // Update or create user cache
    await UserCache.findByIdAndUpdate(
      req.user.id,
      {
        _id: req.user.id,
        type: req.user.type,
        name: req.user.name,
        email: req.user.email,
        firstName: req.user.firstName,
        lastName: req.user.lastName,
        profile: req.user.profile,
        role: req.user.role,
        isActive: req.user.isActive,
        syncedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      user: req.user,
      message: "Token verified successfully",
    });
  } catch (error) {
    logger.error("Verify token error:", error);
    res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
});

// Get current user info
router.get("/me", authMiddleware, async (req, res) => {
  try {
    let userCache = await UserCache.findById(req.user.id);

    if (!userCache) {
      userCache = await UserCache.create({
        _id: req.user.id,
        type: req.user.type,
        name: req.user.name,
        email: req.user.email,
        firstName: req.user.firstName,
        lastName: req.user.lastName,
        profile: req.user.profile,
        role: req.user.role,
        syncedAt: new Date(),
      });
    }

    res.json({
      success: true,
      user: {
        ...req.user,
        isOnline: userCache.isOnline,
        lastSeen: userCache.lastSeen,
      },
    });
  } catch (error) {
    logger.error("Get user info error:", error);
    res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
});

// Get online users
router.get("/online", authMiddleware, async (req, res) => {
  try {
    const { type } = req.query;

    const onlineUsers = await UserCache.getOnlineUsers(type);

    res.json({
      success: true,
      users: onlineUsers,
      count: onlineUsers.length,
    });
  } catch (error) {
    logger.error("Get online users error:", error);
    res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
});

module.exports = router;
