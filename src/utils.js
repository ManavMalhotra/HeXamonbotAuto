const chalk = require("chalk");
const ora = require("ora");

const randomDelay = (min, max) =>
  new Promise((resolve) =>
    setTimeout(resolve, Math.random() * (max - min) + min)
  );

const waitWithTimer = async (duration, message = "Waiting") => {
  const totalBlocks = 20;
  const interval = duration / totalBlocks;
  const spinner = ora({
    text: chalk.cyan(`${message}: [${" ".repeat(totalBlocks)}] 0%`),
    spinner: "dots",
  }).start();
  for (let i = 0; i <= totalBlocks; i++) {
    const progress = Math.floor((i / totalBlocks) * 100);
    const blocks = "█".repeat(i) + " ".repeat(totalBlocks - i);
    spinner.text = chalk.cyan(`${message}: [${blocks}] ${progress}%`);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  spinner.succeed(chalk.cyan(`${message} completed.`));
  return true;
};

module.exports = { randomDelay, waitWithTimer };
