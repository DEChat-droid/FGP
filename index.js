require('dotenv').config();
const { Bot } = require('grammy');

// Ініціалізуємо бота
const bot = new Bot(process.env.BOT_TOKEN);

// Команда /start
bot.command('start', ctx => ctx.reply('Вітаю!'));

// На будь-який текст – ехо
bot.on('message:text', ctx => {
  ctx.reply('Echo: ' + ctx.message.text);
});

// Запускаємо Long Polling
bot.start();
