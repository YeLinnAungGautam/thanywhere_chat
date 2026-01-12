const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    senderId: {
      type: String,
      required: true,
    },
    senderType: {
      type: String,
      enum: ["admin", "user"],
      required: true,
    },
    senderName: {
      type: String,
      required: true,
    },
    senderEmail: String,
    senderProfile: String,
    message: {
      type: String,
      required: true,
      trim: true,
    },
    messageType: {
      type: String,
      enum: ["text", "image", "file", "system"],
      default: "text",
    },
    attachments: [
      {
        url: String,
        type: String,
        name: String,
        size: Number,
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    readBy: [
      {
        userId: String,
        userType: String,
        userName: String,
        readAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    replyTo: {
      messageId: mongoose.Schema.Types.ObjectId,
      message: String,
      senderName: String,
    },
    isEdited: {
      type: Boolean,
      default: false,
    },
    editedAt: Date,
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: Date,
  },
  {
    timestamps: true,
  }
);

// Indexes
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1 });
messageSchema.index({ isDeleted: 1 });

// Methods
messageSchema.methods.markAsRead = function (userId, userType, userName) {
  const alreadyRead = this.readBy.some(
    (r) => r.userId === userId && r.userType === userType
  );
  if (!alreadyRead) {
    this.readBy.push({
      userId,
      userType,
      userName,
      readAt: new Date(),
    });
  }
};

// Static methods
messageSchema.statics.getUnreadCount = async function (
  conversationId,
  userId,
  userType
) {
  return await this.countDocuments({
    conversationId,
    senderId: { $ne: userId },
    "readBy.userId": { $ne: userId },
    isDeleted: false,
  });
};

module.exports = mongoose.model("Message", messageSchema);
