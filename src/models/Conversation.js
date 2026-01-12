const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["admin-to-admin", "admin-group", "admin-to-user"],
      required: true,
    },
    name: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    participants: [
      {
        id: {
          type: String,
          required: true,
        },
        type: {
          type: String,
          enum: ["admin", "user"],
          required: true,
        },
        name: {
          type: String,
          required: true,
        },
        email: String,
        profile: String,
        firstName: String,
        lastName: String,
        joinedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    lastMessage: {
      message: String,
      senderId: String,
      senderName: String,
      timestamp: Date,
    },
    createdBy: {
      id: {
        type: String,
        required: true,
      },
      type: {
        type: String,
        required: true,
      },
      name: {
        type: String,
        required: true,
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
conversationSchema.index({ "participants.id": 1 });
conversationSchema.index({ "participants.type": 1 });
conversationSchema.index({ type: 1 });
conversationSchema.index({ updatedAt: -1 });

// Methods
conversationSchema.methods.isParticipant = function (userId, userType) {
  return this.participants.some((p) => p.id === userId && p.type === userType);
};

conversationSchema.methods.addParticipant = function (participant) {
  if (!this.isParticipant(participant.id, participant.type)) {
    this.participants.push({
      ...participant,
      joinedAt: new Date(),
    });
  }
};

conversationSchema.methods.removeParticipant = function (userId, userType) {
  this.participants = this.participants.filter(
    (p) => !(p.id === userId && p.type === userType)
  );
};

module.exports = mongoose.model("Conversation", conversationSchema);
