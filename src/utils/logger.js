const logger = {
  info: (message, data = null) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ℹ️  INFO:`, message);
    if (data) console.log(data);
  },

  error: (message, error = null) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ❌ ERROR:`, message);
    if (error) console.error(error);
  },

  success: (message, data = null) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ✅ SUCCESS:`, message);
    if (data) console.log(data);
  },

  warn: (message, data = null) => {
    const timestamp = new Date().toISOString();
    console.warn(`[${timestamp}] ⚠️  WARNING:`, message);
    if (data) console.warn(data);
  },

  socket: (event, data = null) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 🔌 SOCKET [${event}]`);
    if (data) console.log(data);
  },
};

module.exports = logger;
