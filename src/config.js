module.exports = {
  BOT_USERNAME: "HeXamonbot",
  SESSION_FILE: "session.txt",
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  TIMEOUTS: {
    HUNT: 10000, // 10s for Pokémon to appear
    BATTLE_STUCK: 30000, // 30s for battle stall detection
    ATTACK_WAIT: 10000, // 10s for attack buttons to appear
    INACTIVITY: 300000, // 5min inactivity threshold
  },
  DELAYS: {
    MIN: 500,
    MAX: 2000,
    HUNT_COOLDOWN: 2000,
    RETRY: 2000,
  },
  COOLDOWNS: {
    DEFAULT: 3000, // 10sec
    MAJOR: 600000, // 10min
    FLOOD: 860000, // 1min
  },
  MAX_RETRIES: 4,
  MAX_FAILURES: 5,
  PD_CHECK_INTERVAL: 10, // Check PD every 10 hunts
  ATTACK_PREFERENCES: ["Hydro Pump", "Ember", "Water Gun", "Vine Whip"],
};
