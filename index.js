require('dotenv').config();
const { Bot } = require('grammy');
const { transcribeVoice } = require('./stt');
const { getFeedback } = require("./feedback");

const bot = new Bot(process.env.BOT_TOKEN);

bot.command('start', ctx => ctx.reply('Hi 👋'));
bot.on('message:text', ctx => ctx.reply('Echo: ' + ctx.message.text));

bot.on('message:voice', async ctx => {
  await ctx.reply('Обробив голос, отримали текст…');
  try {
    const file = await ctx.getFile();
    const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
    const text = await transcribeVoice(url);
    await ctx.reply(`📝 Розпізнаний текст:\n${text}`);

    // робимо фідбек
    const fb = await getFeedback(text);
    await ctx.reply(fb, { parse_mode: "Markdown" });
  } catch (e) {
    console.error(e);
    await ctx.reply("Сталася помилка 😕");
  }
});




bot.start();
