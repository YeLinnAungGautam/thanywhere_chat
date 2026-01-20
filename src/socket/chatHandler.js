const axios = require("axios");
const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const UserCache = require("../models/UserCache");
const logger = require("../utils/logger");
const Notification = require("../models/Notification");

const connectedUsers = new Map();

const chatHandler = (io) => {
  // Socket authentication middleware
  // socket/chatHandler.js - Update the authentication middleware
  io.use(async (socket, next) => {
    try {
      console.log("\n=== SOCKET AUTH START ===");

      // Log what we receive
      console.log("Auth object:", socket.handshake.auth);
      console.log("Token exists:", !!socket.handshake.auth.token);

      const token = socket.handshake.auth.token;

      if (!token) {
        console.log("❌ No token in socket handshake");
        return next(new Error("Authentication error: No token provided"));
      }

      console.log("Token length:", token.length);
      console.log("Token preview:", token.substring(0, 30) + "...");

      let userInfo = null;

      // Try Admin verification
      try {
        console.log("🔍 Trying admin endpoint...");
        const adminResponse = await axios.post(
          `${process.env.LARAVEL_API_URL}/admin/verify-token`,
          {},
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
            timeout: 5000,
          },
        );

        console.log("Admin response status:", adminResponse.status);
        console.log("Admin response data:", adminResponse.data);

        // ✅ Update to match your Laravel response format
        if (adminResponse.data?.status === 1 && adminResponse.data?.result) {
          userInfo = adminResponse.data.result;
          console.log("✅ Admin verified:", userInfo.name);
        }
      } catch (adminError) {
        console.log(
          "⚠️ Admin verification failed:",
          adminError.response?.status,
          adminError.message,
        );
      }

      // Try User verification
      if (!userInfo) {
        try {
          console.log("🔍 Trying user endpoint...");
          const userResponse = await axios.post(
            `${process.env.LARAVEL_API_URL}/api/v2/verify-token`, // ✅ Fixed endpoint
            {},
            {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json",
              },
              timeout: 5000,
            },
          );

          console.log("User response status:", userResponse.status);
          console.log("User response data:", userResponse.data);

          // ✅ Update to match your Laravel response format
          if (userResponse.data?.status === 1 && userResponse.data?.result) {
            userInfo = userResponse.data.result;
            console.log("✅ User verified:", userInfo.name);
          }
        } catch (userError) {
          console.log(
            "⚠️ User verification failed:",
            userError.response?.status,
            userError.message,
          );
          console.log("Error response:", userError.response?.data);
        }
      }

      if (!userInfo) {
        console.log("❌ Both admin and user verification failed");
        return next(new Error("Authentication failed: Invalid token"));
      }

      socket.user = {
        id: userInfo.id?.toString(),
        type: userInfo.type || "user",
        name:
          userInfo.name ||
          `${userInfo.first_name || ""} ${userInfo.last_name || ""}`.trim(),
        email: userInfo.email,
        role: userInfo.role || null,
        firstName: userInfo.first_name || userInfo.firstName || null,
        lastName: userInfo.last_name || userInfo.lastName || null,
        profile: userInfo.profile || userInfo.profile_picture || null,
      };

      console.log("✅ Socket user authenticated:", socket.user);
      console.log("=== SOCKET AUTH END ===\n");
      next();
    } catch (error) {
      console.error("💥 Socket authentication error:", error.message);
      console.error("Error stack:", error.stack);
      next(new Error("Authentication failed"));
    }
  });

  io.on("connection", async (socket) => {
    const userKey = `${socket.user.id}_${socket.user.type}`;

    logger.socket("connection", {
      socketId: socket.id,
      user: socket.user.name,
      type: socket.user.type,
    });

    connectedUsers.set(userKey, socket.id);

    // ✅ ADD THIS - Join user's personal room for notifications
    const personalRoom = `user_${socket.user.id}_${socket.user.type}`;
    socket.join(personalRoom);

    logger.info(`User joined personal room: ${personalRoom}`);

    // Update online status
    try {
      await UserCache.findByIdAndUpdate(
        socket.user.id,
        {
          _id: socket.user.id,
          type: socket.user.type,
          name: socket.user.name,
          email: socket.user.email,
          firstName: socket.user.firstName,
          lastName: socket.user.lastName,
          profile: socket.user.profile,
          role: socket.user.role,
          isOnline: true,
          socketId: socket.id,
          lastSeen: new Date(),
          syncedAt: new Date(),
        },
        { upsert: true, new: true },
      );

      io.emit("user_status", {
        userId: socket.user.id,
        userType: socket.user.type,
        userName: socket.user.name,
        isOnline: true,
        timestamp: new Date(),
      });

      // ✅ ADD THIS - Send pending notifications
      console.log(
        `📬 Checking pending notifications for ${socket.user.name}...`,
      );

      const pendingNotifications = await Notification.find({
        userId: socket.user.id,
        userType: socket.user.type,
        isRead: false,
      })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

      if (pendingNotifications.length > 0) {
        console.log(
          `📬 Sending ${pendingNotifications.length} pending notifications`,
        );

        socket.emit("pending_notifications", {
          notifications: pendingNotifications,
          count: pendingNotifications.length,
        });

        // Mark as delivered
        await Notification.updateMany(
          {
            userId: socket.user.id,
            userType: socket.user.type,
            isRead: false,
          },
          {
            $set: { deliveredAt: new Date() },
          },
        );

        console.log(`✅ Notifications marked as delivered`);
      } else {
        console.log(`ℹ️ No pending notifications`);
      }
    } catch (error) {
      logger.error("Error updating user status:", error);
    }

    // Join conversations
    socket.on("join_conversations", async () => {
      try {
        const conversations = await Conversation.find({
          "participants.id": socket.user.id,
          "participants.type": socket.user.type,
          isActive: true,
        });

        conversations.forEach((conv) => {
          socket.join(`conversation_${conv._id}`);
        });

        logger.socket("join_conversations", {
          user: socket.user.name,
          count: conversations.length,
        });

        socket.emit("conversations_joined", {
          success: true,
          count: conversations.length,
        });
      } catch (error) {
        logger.error("Join conversations error:", error);
        socket.emit("error", { message: "Failed to join conversations" });
      }
    });

    // Join conversation
    socket.on("join_conversation", async (data) => {
      try {
        const { conversationId } = data;

        if (!conversationId) {
          return socket.emit("error", {
            message: "conversationId is required",
          });
        }

        const conversation = await Conversation.findById(conversationId);

        if (!conversation) {
          return socket.emit("error", { message: "Conversation not found" });
        }

        if (!conversation.isParticipant(socket.user.id, socket.user.type)) {
          return socket.emit("error", { message: "Access denied" });
        }

        socket.join(`conversation_${conversationId}`);

        logger.socket("join_conversation", {
          conversationId,
          user: socket.user.name,
        });

        socket.emit("conversation_joined", {
          success: true,
          conversationId,
        });
      } catch (error) {
        logger.error("Join conversation error:", error);
        socket.emit("error", { message: "Failed to join conversation" });
      }
    });

    // Leave conversation
    socket.on("leave_conversation", (data) => {
      const { conversationId } = data;
      if (conversationId) {
        socket.leave(`conversation_${conversationId}`);
        logger.socket("leave_conversation", {
          conversationId,
          user: socket.user.name,
        });
      }
    });

    // Send message
    socket.on("send_message", async (data) => {
      try {
        const { conversationId, message, messageType = "text", replyTo } = data;

        console.log("📨 Received send_message event");
        console.log("   From:", socket.user.name);
        console.log("   Conversation:", conversationId);
        console.log("   Message:", message?.substring(0, 50));

        if (!conversationId || !message || message.trim().length === 0) {
          console.error("❌ Invalid message data");
          return socket.emit("error", { message: "Invalid message data" });
        }

        const conversation = await Conversation.findById(conversationId);

        if (!conversation) {
          console.error("❌ Conversation not found:", conversationId);
          return socket.emit("error", { message: "Conversation not found" });
        }

        if (!conversation.isParticipant(socket.user.id, socket.user.type)) {
          console.error("❌ User not a participant");
          return socket.emit("error", { message: "Access denied" });
        }

        // ✅ CRITICAL FIX - Ensure user is in room before sending
        const roomName = `conversation_${conversationId}`;
        const isInRoom = socket.rooms.has(roomName);

        if (!isInRoom) {
          console.log(
            `⚠️ User ${socket.user.name} not in room, joining now...`,
          );
          socket.join(roomName);
        }

        console.log(`✅ User in room: ${roomName}`);

        // Save message
        const newMessage = new Message({
          conversationId,
          senderId: socket.user.id,
          senderType: socket.user.type,
          senderName: socket.user.name,
          senderEmail: socket.user.email,
          senderProfile: socket.user.profile,
          message: message.trim(),
          messageType,
          replyTo,
        });

        await newMessage.save();
        console.log("✅ Message saved to database:", newMessage._id);

        // Update conversation
        conversation.lastMessage = {
          message: message.trim(),
          senderId: socket.user.id,
          senderName: socket.user.name,
          timestamp: new Date(),
        };
        conversation.updatedAt = new Date();
        await conversation.save();
        console.log("✅ Conversation updated");

        // Get room info
        const room = io.sockets.adapter.rooms.get(roomName);
        const memberCount = room ? room.size : 0;

        console.log(`📤 Emitting to room: ${roomName}`);
        console.log(`   Members in room: ${memberCount}`);

        logger.socket("send_message", {
          messageId: newMessage._id,
          conversationId,
          sender: socket.user.name,
          roomMembers: memberCount,
        });

        // ✅ ========================================
        // ✅ ADD THIS SECTION - Notification Logic
        // ✅ ========================================
        console.log("\n📊 Checking for offline participants...");

        const onlineSocketIds = room ? Array.from(room) : [];
        console.log(`   Online sockets in room: ${onlineSocketIds.length}`);

        // Loop through all participants
        for (const participant of conversation.participants) {
          // Skip the sender
          if (
            participant.id === socket.user.id &&
            participant.type === socket.user.type
          ) {
            console.log(`   ⏭️  Skipping sender: ${participant.name}`);
            continue;
          }

          // Get participant's socket ID from connectedUsers map
          const participantKey = `${participant.id}_${participant.type}`;
          const participantSocketId = connectedUsers.get(participantKey);

          // Check if participant is online in this conversation room
          const isOnlineInRoom =
            participantSocketId &&
            onlineSocketIds.includes(participantSocketId);

          console.log(`   👤 Participant: ${participant.name}`);
          console.log(`      User Key: ${participantKey}`);
          console.log(`      Socket ID: ${participantSocketId || "none"}`);
          console.log(`      In Room: ${isOnlineInRoom ? "Yes ✅" : "No ❌"}`);

          // If participant is offline or not in room, create notification
          if (!isOnlineInRoom) {
            console.log(
              `   📝 Creating notification for ${participant.name}...`,
            );

            try {
              const notification = await Notification.create({
                userId: participant.id,
                userType: participant.type,
                type: "new_message",
                conversationId: conversationId,
                messageId: newMessage._id,
                data: {
                  senderName: socket.user.name,
                  message: message.trim().substring(0, 100),
                  conversationName:
                    conversation.name || `${socket.user.name}'s conversation`,
                },
              });

              console.log(
                `   ✅ Notification created: ${notification._id} for ${participant.name}`,
              );
            } catch (notifError) {
              console.error(
                `   ❌ Failed to create notification for ${participant.name}:`,
                notifError.message,
              );
            }
          } else {
            console.log(
              `   ✅ ${participant.name} is online in room, no notification needed`,
            );
          }
        }

        console.log("📊 Notification check completed\n");
        // ✅ ========================================
        // ✅ END OF NOTIFICATION SECTION
        // ✅ ========================================

        // ✅ Emit to all users in room (including sender)
        io.to(roomName).emit("new_message", {
          message: newMessage,
          conversation: {
            _id: conversation._id,
            type: conversation.type,
            lastMessage: conversation.lastMessage,
          },
        });

        console.log("✅ new_message event emitted to room");

        // Confirmation to sender
        socket.emit("message_sent", {
          success: true,
          message: newMessage,
        });

        console.log("✅ message_sent confirmation sent to sender");
      } catch (error) {
        logger.error("Send message error:", error);
        socket.emit("error", { message: "Failed to send message" });
      }
    });

    // Typing start
    socket.on("typing_start", (data) => {
      const { conversationId } = data;
      if (conversationId) {
        socket.to(`conversation_${conversationId}`).emit("user_typing", {
          conversationId,
          userId: socket.user.id,
          userType: socket.user.type,
          userName: socket.user.name,
          isTyping: true,
        });
      }
    });

    // Typing stop
    socket.on("typing_stop", (data) => {
      const { conversationId } = data;
      if (conversationId) {
        socket.to(`conversation_${conversationId}`).emit("user_typing", {
          conversationId,
          userId: socket.user.id,
          userType: socket.user.type,
          userName: socket.user.name,
          isTyping: false,
        });
      }
    });

    // Mark as read
    socket.on("mark_read", async (data) => {
      try {
        const { conversationId, messageIds } = data;

        const query = {
          conversationId,
          senderId: { $ne: socket.user.id },
          "readBy.userId": { $ne: socket.user.id },
          isDeleted: false,
        };

        if (messageIds && Array.isArray(messageIds)) {
          query._id = { $in: messageIds };
        }

        await Message.updateMany(query, {
          $push: {
            readBy: {
              userId: socket.user.id,
              userType: socket.user.type,
              userName: socket.user.name,
              readAt: new Date(),
            },
          },
        });

        socket.to(`conversation_${conversationId}`).emit("messages_read", {
          conversationId,
          userId: socket.user.id,
          userType: socket.user.type,
          userName: socket.user.name,
          timestamp: new Date(),
        });

        socket.emit("mark_read_success", {
          success: true,
          conversationId,
        });
      } catch (error) {
        logger.error("Mark read error:", error);
        socket.emit("error", { message: "Failed to mark messages as read" });
      }
    });

    // Disconnect
    socket.on("disconnect", async () => {
      logger.socket("disconnect", {
        socketId: socket.id,
        user: socket.user.name,
      });

      connectedUsers.delete(userKey);

      try {
        await UserCache.findByIdAndUpdate(socket.user.id, {
          isOnline: false,
          socketId: null,
          lastSeen: new Date(),
        });

        io.emit("user_status", {
          userId: socket.user.id,
          userType: socket.user.type,
          userName: socket.user.name,
          isOnline: false,
          lastSeen: new Date(),
        });
      } catch (error) {
        logger.error("Error updating offline status:", error);
      }
    });

    socket.on("error", (error) => {
      logger.error("Socket error:", error);
    });
  });

  logger.success("Socket.io chat handler initialized");
};

module.exports = chatHandler;
