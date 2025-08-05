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

// Ловимо голосові
bot.on('message:voice', async ctx => {
  // отримуємо метадані файлу
  const file = await ctx.getFile();

  // просто відповідаємо, що ми його «спіймали»
  await ctx.reply('Я отримав voice, зараз ще не обробляю 🙂');
});


// Запускаємо Long Polling
bot.start();
