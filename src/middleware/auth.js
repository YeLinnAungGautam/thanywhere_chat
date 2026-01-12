// const axios = require("axios");
// const logger = require("../utils/logger");

// const authMiddleware = async (req, res, next) => {
//   console.log("=== AUTH MIDDLEWARE START ===");

//   // 1. Get token
//   const authHeader = req.header("Authorization");
//   console.log("Auth header:", authHeader ? "Present" : "Missing");

//   if (!authHeader || !authHeader.startsWith("Bearer ")) {
//     console.log("ERROR: No Bearer token");
//     return res.status(401).json({ error: "No token" });
//   }

//   const token = authHeader.replace("Bearer ", "").trim();
//   console.log("Token length:", token.length);
//   console.log("Token preview:", token.substring(0, 20) + "...");

//   // 2. Try to verify
//   try {
//     console.log("Calling Laravel admin endpoint...");
//     const response = await axios.post(
//       `${process.env.LARAVEL_API_URL}/admin/verify-token`,
//       {},
//       {
//         headers: {
//           Authorization: `Bearer ${token}`,
//           Accept: "application/json",
//         },
//         timeout: 5000,
//       }
//     );

//     console.log("Laravel response status:", response.status);
//     console.log(
//       "Laravel response data:",
//       JSON.stringify(response.data, null, 2)
//     );

//     if (response.data?.success && response.data?.data) {
//       req.user = response.data.data;
//       req.token = token;
//       console.log("SUCCESS: User authenticated");
//       return next();
//     }
//   } catch (error) {
//     logger.error("Error verifying token:", error);
//   }

//   console.log("FAILED: Token invalid");
//   return res.status(401).json({ error: "Invalid token" });
// };

// module.exports = { authMiddleware };

const axios = require("axios");
const logger = require("../utils/logger");
const UserCache = require("../models/UserCache");

// Simple token cache
const tokenCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const authMiddleware = async (req, res, next) => {
  const requestId = Date.now().toString(36);
  console.log(`[${requestId}] === AUTH MIDDLEWARE START ===`);

  try {
    // 1. Get token from Authorization header
    const authHeader = req.header("Authorization");
    console.log(
      `[${requestId}] Auth header:`,
      authHeader ? "Present" : "Missing"
    );

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log(`[${requestId}] ERROR: No Bearer token`);
      return res.status(401).json({
        success: false,
        error: "No token provided. Expected: Bearer <token>",
        code: "NO_TOKEN",
      });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    console.log(`[${requestId}] Token length:`, token.length);
    console.log(
      `[${requestId}] Token preview:`,
      token.substring(0, 20) + "..."
    );

    // 2. Check cache first (optional optimization)
    const cachedData = tokenCache.get(token);
    if (cachedData && Date.now() - cachedData.timestamp < CACHE_DURATION) {
      console.log(`[${requestId}] Token found in cache`);
      req.user = cachedData.user;
      req.token = token;
      req.requestId = requestId;

      console.log(
        `[${requestId}] ✅ Authenticated (from cache): ${cachedData.user.name}`
      );
      return next();
    }

    // 3. Verify with Laravel API
    console.log(`[${requestId}] Calling Laravel admin endpoint...`);
    let userData = null;
    let source = null;

    // Try admin endpoint first
    try {
      const adminResponse = await axios.post(
        `${process.env.LARAVEL_API_URL}/admin/verify-token`,
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          timeout: 3000,
        }
      );

      console.log(
        `[${requestId}] Admin response status:`,
        adminResponse.status
      );

      // Your Laravel returns: { status: 1, message: "...", result: {...} }
      if (adminResponse.data?.status === 1 && adminResponse.data?.result) {
        userData = adminResponse.data.result;
        source = "admin";
        console.log(`[${requestId}] ✅ Admin token verified: ${userData.name}`);
      } else {
        console.log(
          `[${requestId}] Admin verification failed, trying user endpoint...`
        );
      }
    } catch (adminError) {
      if (adminError.response?.status === 401) {
        console.log(
          `[${requestId}] Admin token invalid (401), trying user endpoint...`
        );
      } else {
        console.log(`[${requestId}] Admin endpoint error:`, adminError.message);
      }
    }

    // If not admin, try user endpoint
    if (!userData) {
      try {
        console.log(`[${requestId}] Calling Laravel user endpoint...`);
        const userResponse = await axios.post(
          `${process.env.LARAVEL_API_URL}/api/v2/verify-token`,
          {},
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
            timeout: 3000,
          }
        );

        console.log(
          `[${requestId}] User response status:`,
          userResponse.status
        );

        if (userResponse.data?.status === 1 && userResponse.data?.result) {
          userData = userResponse.data.result;
          source = "user";
          console.log(
            `[${requestId}] ✅ User token verified: ${userData.name}`
          );
        } else {
          console.log(`[${requestId}] User verification failed`);
        }
      } catch (userError) {
        console.log(`[${requestId}] User endpoint error:`, userError.message);
      }
    }

    // 4. Check if user was found
    if (!userData) {
      console.log(`[${requestId}] ❌ Token verification failed`);
      return res.status(401).json({
        success: false,
        error: "Invalid or expired token",
        code: "INVALID_TOKEN",
      });
    }

    // 5. Prepare user object for your application
    const user = {
      id: userData.id?.toString(),
      type: userData.type || source || "user",
      name:
        userData.name ||
        `${userData.first_name || ""} ${userData.last_name || ""}`.trim(),
      email: userData.email,
      role: userData.role,
      firstName: userData.first_name || userData.firstName || userData.name,
      lastName: userData.last_name || userData.lastName || "",
      profile:
        userData.profile || userData.profile_picture || userData.avatar || null,
      isActive: userData.is_active !== undefined ? userData.is_active : true,
      permissions: userData.permissions || [],
      _authSource: source,
      _verifiedAt: new Date().toISOString(),
    };

    // 6. Validate required fields
    if (!user.id || !user.email) {
      console.log(`[${requestId}] ❌ Invalid user data from Laravel`);
      return res.status(401).json({
        success: false,
        error: "Invalid user data received",
        code: "INVALID_USER_DATA",
      });
    }

    // 7. Cache the token (optional)
    tokenCache.set(token, {
      user: user,
      timestamp: Date.now(),
    });

    // 7.1. Cache the token (optional)
    await UserCache.findByIdAndUpdate(
      user.id,
      {
        _id: user.id,
        type: user.type,
        name: user.name,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profile: user.profile,
        role: user.role,
        isActive: user.isActive,
        syncedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    // 8. Attach user to request
    req.user = user;
    req.token = token;
    req.requestId = requestId;

    console.log(
      `[${requestId}] ✅ Authentication successful: ${user.name} (${user.role})`
    );

    // 9. Call next() to continue to the route handler
    return next();
  } catch (error) {
    console.log(
      `[${requestId}] 💥 Unexpected error in auth middleware:`,
      error.message
    );

    if (error.code === "ECONNABORTED") {
      return res.status(503).json({
        success: false,
        error: "Authentication service timeout",
        code: "AUTH_TIMEOUT",
      });
    }

    if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
      return res.status(503).json({
        success: false,
        error: "Authentication service unavailable",
        code: "AUTH_SERVICE_DOWN",
      });
    }

    return res.status(500).json({
      success: false,
      error: "Internal authentication error",
      code: "INTERNAL_ERROR",
    });
  }
};

// Clean cache periodically
setInterval(() => {
  const now = Date.now();
  let cleared = 0;

  for (const [token, data] of tokenCache.entries()) {
    if (now - data.timestamp > CACHE_DURATION) {
      tokenCache.delete(token);
      cleared++;
    }
  }

  if (cleared > 0) {
    console.log(`🧹 Cleared ${cleared} expired tokens from cache`);
  }
}, 60000);

module.exports = { authMiddleware };
