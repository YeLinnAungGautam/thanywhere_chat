const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    // Mongoose 6+ မှာ useNewUrlParser နဲ့ useUnifiedTopology မလိုတော့ဘူး
    await mongoose.connect(process.env.MONGODB_URI);

    console.log("✅ MongoDB Connected Successfully");
    console.log(`📦 Database: ${mongoose.connection.name}`);

    // Connection events
    mongoose.connection.on("error", (err) => {
      console.error("❌ MongoDB Error:", err);
    });

    mongoose.connection.on("disconnected", () => {
      console.log("⚠️ MongoDB Disconnected");
    });

    mongoose.connection.on("reconnected", () => {
      console.log("✅ MongoDB Reconnected");
    });

    // Graceful shutdown
    process.on("SIGINT", async () => {
      try {
        await mongoose.connection.close();
        console.log("\n📦 MongoDB connection closed through app termination");
        process.exit(0);
      } catch (error) {
        console.error("Error closing MongoDB connection:", error);
        process.exit(1);
      }
    });

    process.on("SIGTERM", async () => {
      try {
        await mongoose.connection.close();
        console.log("\n📦 MongoDB connection closed through SIGTERM");
        process.exit(0);
      } catch (error) {
        console.error("Error closing MongoDB connection:", error);
        process.exit(1);
      }
    });
  } catch (error) {
    console.error("❌ MongoDB Connection Error:", error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
