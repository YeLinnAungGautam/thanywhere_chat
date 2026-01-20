const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    userType: {
      type: String,
      required: true,
      enum: ["admin", "user"],
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: ["new_message", "new_conversation"],
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    deliveredAt: {
      type: Date,
    },
    readAt: {
      type: Date,
    },
    data: {
      senderName: String,
      message: String,
      conversationName: String,
    },
  },
  {
    timestamps: true,
  },
);

// Compound index for efficient queries
notificationSchema.index({ userId: 1, userType: 1, isRead: 1 });
notificationSchema.index({ conversationId: 1, isRead: 1 });

module.exports = mongoose.model("Notification", notificationSchema);
