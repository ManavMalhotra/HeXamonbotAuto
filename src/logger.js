const winston = require("winston");
const chalk = require("chalk");
const { LOG_LEVEL } = require("./config");

const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ level, message, timestamp, stack }) => {
      const colorize =
        {
          info: chalk.green,
          warn: chalk.yellow,
          error: chalk.red,
          debug: chalk.blue,
        }[level] || ((msg) => msg);
      return `${timestamp} [${level.toUpperCase()}] ${colorize(message)}${
        stack ? `\n${stack}` : ""
      }`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "automation.log" }),
  ],
});

module.exports = logger;
