const mongoose = require("mongoose");

const userCacheSchema = new mongoose.Schema(
  {
    _id: String,
    type: {
      type: String,
      enum: ["admin", "user"],
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
    },
    profile: String,
    firstName: String,
    lastName: String,
    phone: String,
    role: String,
    isActive: {
      type: Boolean,
      default: true,
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },
    socketId: String,
    isOnline: {
      type: Boolean,
      default: false,
    },
    syncedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// TTL index - auto delete after 1 hour
userCacheSchema.index({ syncedAt: 1 }, { expireAfterSeconds: 3600 });
userCacheSchema.index({ type: 1 });
userCacheSchema.index({ isOnline: 1 });

// Methods
userCacheSchema.methods.setOnline = function (socketId) {
  this.isOnline = true;
  this.socketId = socketId;
  this.lastSeen = new Date();
};

userCacheSchema.methods.setOffline = function () {
  this.isOnline = false;
  this.socketId = null;
  this.lastSeen = new Date();
};

// Static methods
userCacheSchema.statics.getOnlineUsers = async function (type = null) {
  const query = { isActive: true };
  if (type) {
    query.type = type;
  }
  return await this.find(query).select(
    "_id type name email profile isOnline lastSeen"
  );
};

module.exports = mongoose.model("UserCache", userCacheSchema);
