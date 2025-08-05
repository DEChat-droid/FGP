require('dotenv').config();
const { Bot } = require('grammy');
const { transcribeVoice } = require('./stt');

const bot = new Bot(process.env.BOT_TOKEN);

bot.command('start', ctx => ctx.reply('Hi 👋'));
bot.on('message:text', ctx => ctx.reply('Echo: ' + ctx.message.text));

bot.on('message:voice', async ctx => {
  await ctx.reply('Отримав голос, обробляю…');  
  try {
    const file = await ctx.getFile();
    const text = await transcribeVoice(file.file_url);
    await ctx.reply(text);
  } catch (err) {
    console.error(err);
    await ctx.reply('Щось пішло не так при розпізнаванні 😕');
  }
});

bot.start();
