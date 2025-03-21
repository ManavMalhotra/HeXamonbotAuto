require("dotenv").config();
const Automation = require("./src/Automation");
const logger = require("./src/logger");
const { waitWithTimer } = require("./src/utils");

async function start() {
  const automation = new Automation();
  while (true) {
    try {
      await automation.run();
    } catch (error) {
      logger.error(
        `Automation crashed: ${error.message}. Restarting in 30s...`
      );
      await waitWithTimer(30000, "Restarting");
    }
  }
}

start();

process.on("uncaughtException", async (error) => {
  logger.error(`Uncaught: ${error.message}`);
  await waitWithTimer(
    error.message.includes("FLOOD") ? 60000 : 30000,
    "Recovering"
  );
});

process.on("unhandledRejection", async (reason) => {
  logger.error(`Unhandled: ${reason}`);
  await waitWithTimer(
    reason?.message?.includes("FLOOD") ? 60000 : 30000,
    "Recovering"
  );
});

process.on("SIGINT", () => {
  logger.info("Shutting down...");
  process.exit(0);
});
