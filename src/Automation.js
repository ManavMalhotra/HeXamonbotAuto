const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input");
const fs = require("fs");
const logger = require("./logger");
const { randomDelay, waitWithTimer } = require("./utils");
const CONFIG = require("./config");

class Automation {
  constructor() {
    this.client = null;
    this.botUserId = null;
    this.state = "IDLE";
    this.lastStateChange = Date.now();
    this.lastMessageId = null;
    this.isRunning = true;
    this.timeouts = {};
    this.retryCount = 0; // For battle retries
    this.consecutiveHuntAttempts = 0; // Fixed: Initialize to 0
    this.stats = {
      huntCount: 0,
      failureCount: 0,
      pdBalance: 0,
      huntsSinceLastPDCheck: 0,
      lastHuntTimestamp: 0,
      lastAttackTimestamp: 0,
      lastBattleUpdateTimestamp: 0,
    };
    this.states = {
      IDLE: "IDLE",
      HUNTING: "HUNTING",
      BATTLING: "BATTLING",
      SWITCHING: "SWITCHING",
      GAME_OVER: "GAME_OVER",
      COOLDOWN: "COOLDOWN",
      MAJOR_COOLDOWN: "MAJOR_COOLDOWN",
      TRAINER_BATTLE_INIT: "TRAINER_BATTLE_INIT",
    };
  }

  async initialize() {
    const apiId = parseInt(
      process.env.API_ID || (await input.text("Enter your API ID: ")),
      10
    );
    const apiHash =
      process.env.API_HASH || (await input.text("Enter your API Hash: "));
    const sessionString = fs.existsSync(CONFIG.SESSION_FILE)
      ? fs.readFileSync(CONFIG.SESSION_FILE, "utf8")
      : "";
    this.client = new TelegramClient(
      new StringSession(sessionString),
      apiId,
      apiHash,
      {
        connectionRetries: 5,
        floodSleepThreshold: 60,
      }
    );

    try {
      await this.client.connect();
      if (!sessionString) {
        await this.client.start({
          phoneNumber: async () =>
            await input.text("Enter your phone number: "),
          password: async () =>
            await input.text("Enter your 2FA password (if any): "),
          phoneCode: async () =>
            await input.text("Enter the code you received: "),
          onError: (err) => logger.error(`Auth Error: ${err.message}`),
        });
        fs.writeFileSync(CONFIG.SESSION_FILE, this.client.session.save());
        logger.info("Session saved to session.txt");
      }
      const botEntity = await this.client.getEntity(CONFIG.BOT_USERNAME);
      this.botUserId = botEntity.id.value;
      logger.info(`Connected to Telegram. Bot ID: ${this.botUserId}`);
      return true;
    } catch (error) {
      logger.error(`Initialization failed: ${error.message}`);
      await waitWithTimer(10000, "Reconnecting");
      return false;
    }
  }

  setState(newState) {
    logger.info(`State: ${this.state} -> ${newState}`);
    this.state = newState;
    this.lastStateChange = Date.now();
  }

  clearTimeouts() {
    Object.values(this.timeouts).forEach(clearTimeout);
    this.timeouts = {};
    logger.debug("Timeouts cleared.");
  }

  logMessage(message) {
    logger.info(`Message ID: ${message.id}, Text: "${message.message}"`);
    if (message.replyMarkup) {
      const buttons = message.replyMarkup.rows.flatMap((row) =>
        row.buttons.map((btn) => btn.text)
      );
      logger.info(`Buttons: ${buttons.join(", ")}`);
    }
  }

  async clickButton(peerId, msgId, buttonData) {
    for (let i = 0; i < CONFIG.MAX_RETRIES; i++) {
      try {
        await randomDelay(CONFIG.DELAYS.MIN, CONFIG.DELAYS.MAX);
        logger.debug(`Click attempt ${i + 1}: ${buttonData.toString()}`);
        await this.client.invoke(
          new Api.messages.GetBotCallbackAnswer({
            peer: peerId,
            msgId,
            data: buttonData,
          })
        );
        logger.debug("Button clicked successfully.");
        return true;
      } catch (error) {
        logger.error(`Click attempt ${i + 1} failed: ${error.message}`);
        if (error.message.includes("FLOOD")) {
          await waitWithTimer(CONFIG.COOLDOWNS.FLOOD, "Flood Cooldown");
        } else if (error.message.includes("TIMEOUT")) {
          await waitWithTimer(CONFIG.COOLDOWNS.TIMEOUT, "Timeout Cooldown");
        }
        if (i === CONFIG.MAX_RETRIES - 1) return false;
        await randomDelay(CONFIG.DELAYS.RETRY, CONFIG.DELAYS.RETRY * 1.5);
      }
    }
    return false;
  }

  async enterCooldown(duration, reason) {
    logger.info(`Cooldown: ${duration / 1000}s (${reason})`);
    this.setState(this.states.COOLDOWN);
    await randomDelay(duration, duration + 2000); // Cap extra delay at 2s
    this.setState(this.states.IDLE);
    this.consecutiveHuntAttempts = 0; // Fixed: Reset to 0
    await this.startHunt(); // Auto-resume hunting
  }

  async startHunt() {
    if (
      !this.isRunning ||
      [
        this.states.GAME_OVER,
        this.states.COOLDOWN,
        this.states.MAJOR_COOLDOWN,
      ].includes(this.state)
    ) {
      if (this.state === this.states.GAME_OVER)
        logger.error("Game Over: All Pokémon fainted.");
      return;
    }

    try {
      this.stats.huntCount++;
      this.stats.huntsSinceLastPDCheck++;
      logger.info(`Hunt #${this.stats.huntCount}`);
      this.clearTimeouts();
      this.setState(this.states.HUNTING);
      await randomDelay(2000, 3000); // 2-3s delay between hunts
      await this.client.sendMessage(CONFIG.BOT_USERNAME, { message: "/hunt" });
      this.stats.lastHuntTimestamp = Date.now();
      this.consecutiveHuntAttempts++;

      this.timeouts.hunt = setTimeout(async () => {
        if (this.consecutiveHuntAttempts < 3) {
          logger.warn("No Pokémon in 10s. Retrying hunt...");
          await this.startHunt(); // Retry immediately
        } else {
          this.stats.failureCount++;
          logger.warn("No Pokémon after 3 attempts. Entering cooldown...");
          if (this.stats.failureCount >= CONFIG.MAX_FAILURES) {
            this.setState(this.states.MAJOR_COOLDOWN);
            await waitWithTimer(CONFIG.COOLDOWNS.MAJOR, "Major Cooldown");
            this.stats.failureCount = 0;
            this.setState(this.states.IDLE);
            await this.startHunt(); // Resume after major cooldown
          } else {
            await this.enterCooldown(CONFIG.COOLDOWNS.DEFAULT, "No Pokémon");
          }
        }
      }, CONFIG.TIMEOUTS.HUNT);
    } catch (error) {
      logger.error(`Hunt failed: ${error.message}`);
      await this.enterCooldown(CONFIG.COOLDOWNS.DEFAULT, "Hunt failure");
    }
  }

  async checkPD() {
    await this.client.sendMessage(CONFIG.BOT_USERNAME, {
      message: "/myinventory",
    });
    await randomDelay(1000, 2000);
    logger.info("PD check requested.");
  }

  selectAttack(attackButtons) {
    const preferred = attackButtons.find((btn) =>
      CONFIG.ATTACK_PREFERENCES.includes(btn.text)
    );
    return preferred && Math.random() < 0.8
      ? preferred
      : attackButtons[Math.floor(Math.random() * attackButtons.length)];
  }

  async performAttack(message) {
    this.logMessage(message);
    this.stats.lastBattleUpdateTimestamp = Date.now();
    const buttons =
      message.replyMarkup?.rows.flatMap((row) => row.buttons) || [];
    const pokeBallsIndex = buttons.findIndex(
      (btn) => btn.text === "Poke Balls"
    );
    const attackButtons = buttons.slice(
      0,
      pokeBallsIndex !== -1 ? pokeBallsIndex : buttons.length
    );

    if (
      attackButtons.length > 0 &&
      message.message.includes("Current turn: Naruto Uzumaki")
    ) {
      this.clearTimeouts();
      this.timeouts.battleStuck = setTimeout(
        () => this.handleBattleStuck(message),
        CONFIG.TIMEOUTS.BATTLE_STUCK // Use config value (30s)
      );
      const selectedAttack = this.selectAttack(attackButtons);
      logger.info(`Attacking with ${selectedAttack.text}`);
      await randomDelay(1000, 5000);
      if (
        await this.clickButton(message.peerId, message.id, selectedAttack.data)
      ) {
        this.stats.lastAttackTimestamp = Date.now();
        logger.info(`Attack ${selectedAttack.text} executed successfully.`);
        this.retryCount = 0;
      } else {
        logger.warn("Attack failed. Retrying...");
        await this.handleBattleStuck(message);
      }
    } else {
      logger.info("Waiting for bot's turn...");
    }
  }

  async handleBattleStuck(message) {
    if (this.state !== this.states.BATTLING) return;
    if (
      Date.now() - this.stats.lastBattleUpdateTimestamp <
      CONFIG.TIMEOUTS.BATTLE_STUCK
    )
      return;

    logger.warn("Battle stalled. Retrying...");
    const buttons =
      message.replyMarkup?.rows.flatMap((row) => row.buttons) || [];
    const pokeBallsIndex = buttons.findIndex(
      (btn) => btn.text === "Poke Balls"
    );
    const attackButtons = buttons.slice(
      0,
      pokeBallsIndex !== -1 ? pokeBallsIndex : buttons.length
    );

    if (
      attackButtons.length > 0 &&
      message.message.includes("Current turn: Naruto Uzumaki") &&
      this.retryCount < 2
    ) {
      const selectedAttack = this.selectAttack(attackButtons);
      if (
        await this.clickButton(message.peerId, message.id, selectedAttack.data)
      ) {
        this.stats.lastBattleUpdateTimestamp = Date.now();
        this.retryCount++;
        logger.info("Battle continued after retry.");
        return;
      }
    }
    logger.warn("Retry failed or max retries reached. Entering cooldown...");
    await this.enterCooldown(CONFIG.COOLDOWNS.DEFAULT, "Battle stuck");
  }

  async handleMessage(message) {
    if (
      !this.isRunning ||
      message.id === this.lastMessageId ||
      [this.states.COOLDOWN, this.states.MAJOR_COOLDOWN].includes(this.state)
    ) {
      if (
        [this.states.COOLDOWN, this.states.MAJOR_COOLDOWN].includes(this.state)
      ) {
        logger.debug("In cooldown, skipping message.");
      }
      return;
    }
    this.lastMessageId = message.id;
    if (message.peerId?.userId?.value !== this.botUserId) return;

    this.logMessage(message);

    if (message.message.includes("Poke Dollars 💵:")) {
      this.stats.pdBalance = parseInt(
        message.message.match(/Poke Dollars 💵: (\d+)/)[1]
      );
      logger.info(`PD: ${this.stats.pdBalance}`);
      this.stats.huntsSinceLastPDCheck = 0;
    }
    if (
      this.stats.huntsSinceLastPDCheck >= CONFIG.PD_CHECK_INTERVAL &&
      this.state === this.states.IDLE
    ) {
      await this.checkPD();
    }

    if (message.message.includes("have left the battle")) {
      this.clearTimeouts();
      logger.info("Trainer battle ended.");
      await this.enterCooldown(
        CONFIG.COOLDOWNS.DEFAULT,
        "Trainer battle ended"
      );
      return;
    }

    if (message.message.includes("Choose your next pokemon")) {
      this.setState(this.states.SWITCHING);
      const buttons = message.replyMarkup.rows.flatMap((row) => row.buttons);
      const switchButtons = buttons.filter(
        (btn) => !/\d/.test(btn.text) && btn.text.trim()
      );
      if (switchButtons.length > 0) {
        const selected =
          switchButtons[Math.floor(Math.random() * switchButtons.length)];
        logger.info(`Switching to ${selected.text}`);
        await randomDelay(1500, 2500);
        if (await this.clickButton(message.peerId, message.id, selected.data)) {
          this.setState(this.states.BATTLING);
        } else {
          await this.enterCooldown(CONFIG.COOLDOWNS.DEFAULT, "Switch failure");
        }
      } else {
        logger.error("No Pokémon left. Game Over.");
        this.setState(this.states.GAME_OVER);
        this.isRunning = false;
      }
      return;
    }

    if (
      (message.message.includes("fainted") &&
        !message.message.includes("Choose your next pokemon")) ||
      message.message.includes("fled")
    ) {
      this.clearTimeouts();
      logger.info("Battle ended (enemy fainted or fled). Hunting...");
      this.setState(this.states.IDLE);
      await randomDelay(1000, 2000);
      await this.startHunt();
      return;
    }

    if (message.message.includes("caught")) {
      this.clearTimeouts();
      logger.info("Pokémon caught.");
      await this.enterCooldown(CONFIG.COOLDOWNS.DEFAULT, "Pokémon caught");
      return;
    }

    if (message.replyMarkup) {
      const buttons = message.replyMarkup.rows.flatMap((row) => row.buttons);
      const battleButton = buttons.find((btn) => btn.text === "Battle");
      if (battleButton && this.state === this.states.HUNTING) {
        logger.info("Starting battle...");
        const isTrainer = battleButton.data.toString("utf8").endsWith(";true");
        if (
          await this.clickButton(message.peerId, message.id, battleButton.data)
        ) {
          this.setState(
            isTrainer ? this.states.TRAINER_BATTLE_INIT : this.states.BATTLING
          );
        } else {
          await this.enterCooldown(
            CONFIG.COOLDOWNS.DEFAULT,
            "Battle start failure"
          );
        }
      } else if (this.state === this.states.BATTLING) {
        await this.performAttack(message);
      }
    }
  }

  async run() {
    if (!(await this.initialize())) return;
    await this.startHunt();

    this.client.addEventHandler((update) => {
      if (update.message) this.handleMessage(update.message);
    });

    setInterval(() => {
      if (Date.now() - this.lastStateChange > CONFIG.TIMEOUTS.INACTIVITY) {
        logger.warn("Inactivity detected. Cooldown...");
        this.setState(this.states.COOLDOWN);
        this.enterCooldown(CONFIG.COOLDOWNS.DEFAULT, "Inactivity");
      }
    }, 60000);

    logger.info("Automation running...");
    await new Promise(() => {});
  }
}

module.exports = Automation;
