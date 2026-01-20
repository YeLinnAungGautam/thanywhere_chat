require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const connectDB = require("./config/database");
const logger = require("./utils/logger");
const mongoose = require("mongoose");

// Routes
const authRoutes = require("./routes/auth");
const conversationRoutes = require("./routes/conversations");
const messageRoutes = require("./routes/messages");
const notificationRoutes = require("./routes/notifications");

// Socket handler
const chatHandler = require("./socket/chatHandler");

// Initialize
const app = express();
const server = http.createServer(app);

// Socket.io
const io = new Server(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS.split(","),
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Middleware
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS.split(","),
    credentials: true,
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ ADD THIS - Make io available to all routes
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Chat server is running",
    timestamp: new Date(),
    uptime: process.uptime(),
    port: PORT,
  });
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/notifications", notificationRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Route not found",
  });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error("Server error:", err);
  res.status(500).json({
    success: false,
    error: "Internal server error",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// Initialize Socket.io
chatHandler(io);

// Start server
const PORT = process.env.PORT || 5001;

connectDB()
  .then(() => {
    server
      .listen(PORT, () => {
        console.log("\n" + "=".repeat(60));
        logger.success(`🚀 Chat server running on port ${PORT}`);
        logger.info(`🌍 Environment: ${process.env.NODE_ENV}`);
        logger.info(`🔌 Socket.io enabled`);
        logger.info(`🔗 Laravel API: ${process.env.LARAVEL_API_URL}`);
        logger.info(`📦 MongoDB: ${mongoose.connection.name}`);
        console.log("=".repeat(60) + "\n");
        console.log(`✨ Server is ready at http://localhost:${PORT}`);
        console.log(`💚 Health check: http://localhost:${PORT}/health\n`);
      })
      .on("error", (err) => {
        if (err.code === "EADDRINUSE") {
          logger.error(`Port ${PORT} is already in use!`);
          console.log(`\n🔴 Solutions:`);
          console.log(`   1. Kill the process using port ${PORT}:`);
          console.log(`      macOS/Linux: lsof -ti:${PORT} | xargs kill -9`);
          console.log(`      Windows: netstat -ano | findstr :${PORT}\n`);
          console.log(`   2. Change PORT in .env file to a different port\n`);
          process.exit(1);
        } else {
          logger.error("Server error:", err);
          process.exit(1);
        }
      });
  })
  .catch((error) => {
    logger.error("Failed to start server:", error);
    process.exit(1);
  });

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully...");
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  logger.info("\nSIGINT received, shutting down gracefully...");
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
});
