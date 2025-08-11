require('dotenv').config();
const db = require('./db');
const { Bot } = require('grammy');
const { transcribeVoice } = require('./stt');
const { getFeedback } = require('./feedback');
const { InlineKeyboard } = require('grammy');

const lessons = require('./lessons');
const cron = require('node-cron');

// Екранування Markdown-символів
function md(s = '') {
  return s.replace(/[_*[\]()~`>#+\-=|{}.!]/g, m => '\\' + m);
}

const bot = new Bot(process.env.BOT_TOKEN);

// In-memory sessions for setup, lesson, and SRS
const sessions = {};

// Ensure words table for SRS
db.prepare(`
  CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    word TEXT,
    translation TEXT,
    example TEXT,
    nextReview TEXT,
    interval INTEGER
  )
`).run();

// /start: створення профілю користувача
bot.command('start', async ctx => {
  const uid = String(ctx.from.id);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO users (user_id, first_seen, last_seen) VALUES (?, ?, ?)`
  ).run(uid, now, now);
  db.prepare(
    `UPDATE users SET last_seen = ? WHERE user_id = ?`
  ).run(now, uid);
  db.prepare(
    `INSERT OR IGNORE INTO stats (user_id) VALUES (?)`
  ).run(uid);
  return ctx.reply('Ласкаво просимо! Ваш профіль створено. Введіть /help.');
});

// /stats: показ статистики користувача
bot.command('stats', async ctx => {
  try {
    const uid = String(ctx.from.id);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO users (user_id, first_seen, last_seen) VALUES (?, ?, ?)`
    ).run(uid, now, now);
    db.prepare(
      `UPDATE users SET last_seen = ? WHERE user_id = ?`
    ).run(now, uid);
    db.prepare(
      `INSERT OR IGNORE INTO stats (user_id) VALUES (?)`
    ).run(uid);

const userRow = db.prepare(
  `SELECT first_seen FROM users WHERE user_id = ?`
).get(uid);

const statRow = db.prepare(
  `SELECT lessons_done, voice_count, streak_days FROM stats WHERE user_id = ?`
).get(uid);

const firstSeen = userRow?.first_seen ? new Date(userRow.first_seen) : new Date();
const joined = firstSeen.toLocaleDateString('uk-UA', {
  day: 'numeric', month: 'long', year: 'numeric'
});

    const statsMessage =
      `👤 *Ваш профіль*\n` +
      `– 📅 Зареєстровані: *${joined}*\n` +
      `– 🎧 Голосових розпізнань: *${statRow.voice_count || 0}*\n` +
      `– 📝 Уроків пройдено: *${statRow.lessons_done || 0}*\n` +
      `– 🔥 Стрік: *${statRow.streak_days || 0}* днів`;
    await ctx.reply(statsMessage, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error(e);
    await ctx.reply('Помилка при отриманні статистики.');
  }
});

// /setup: проведення анкети користувача
bot.command('setup', ctx => {
  const uid = String(ctx.from.id);
  sessions[uid] = { action: 'setup', step: 1, data: {} };
  return ctx.reply('Привіт! Як тебе звати? 😊');
});

// /lesson: персоналізований урок
bot.command('lesson', async ctx => {
  const uid = String(ctx.from.id);
  const prefs = db.prepare(
    `SELECT name, level, goals FROM preferences WHERE user_id = ?`
  ).get(uid);
  if (!prefs) return ctx.reply('Спочатку заповни профіль командою /setup');
  const list = lessons[prefs.level] || [];
  if (!list.length) return ctx.reply(`На рівні ${prefs.level} ще немає готових уроків.`);
  const lesson = list[Math.floor(Math.random() * list.length)];

  // Надсилаємо матеріал уроку
await ctx.reply(
    `Привіт, ${md(prefs.name)}! Сьогодні тема: *${md(lesson.topic)}*`,
    { parse_mode: 'Markdown' }
);

  const vocabList = lesson.vocab
  .map(v => `– *${md(v.word)}* — ${md(v.translation)}\n  _${md(v.example)}_`)
  .join('\n\n');
  await ctx.reply(`📚 *Словник:*\n\n${vocabList}`, { parse_mode: 'Markdown' });
  const dialogue = lesson.scenario
  .map(s => `${md(s.speaker)}: ${md(s.text)}`)
  .join('\n');
  await ctx.reply(`💬 *Сценарій:*\n\n${dialogue}`, { parse_mode: 'Markdown' });

  // Починаємо сесію уроку
  sessions[uid] = { action: 'lesson', inLesson: true };
});

// /addword: додавання слова до SRS
bot.command('addword', ctx => {
  const uid = String(ctx.from.id);
  sessions[uid] = { action: 'addword', step: 1, data: {} };
  return ctx.reply('Яке слово ви хочете додати?');
});

bot.command('cancel', ctx => {
  const uid = String(ctx.from.id);
  delete sessions[uid];
  return ctx.reply('Сесію скинуто. Можеш почати заново ✨');
});

bot.command('help', ctx => {
  return ctx.reply(
    `Доступні команди:\n` +
    `/start – створити профіль\n` +
    `/setup – налаштувати профіль\n` +
    `/stats – переглянути статистику\n` +
    `/lesson – почати урок\n` +
    `/addword – додати слово в словник\n` +
    `/review – повторити слова (SRS)\n` +
    `/allwords – показати всі слова\n` +
    `/getremind – показати час нагадування\n` +
    `/setremind HH:MM – встановити час нагадування\n` +
    `/cancel – скинути поточну сесію`,
    { parse_mode: 'Markdown' }
  );
});



bot.catch(err => {
  console.error('Bot error:', err);
});


// /review: показуємо слова до повторення
// /review: показуємо слова до повторення
bot.command('review', async ctx => {
  const uid = String(ctx.from.id);
  const nowIso = new Date().toISOString();

  const rows = db.prepare(
  `SELECT * FROM words
   WHERE user_id = ? AND nextReview <= ?
   ORDER BY nextReview ASC
   LIMIT 1`
).all(uid, nowIso);

// const rows = db.prepare(
//   `SELECT * FROM words WHERE user_id = ? ORDER BY nextReview ASC LIMIT 1`
// ).all(uid);


  if (!rows.length) {
    return ctx.reply('Слів для повторення більше немає ✅');
  }

  const row = rows[0];
  const keyboard = new InlineKeyboard()
    .text("🔁 Again", `rate:${row.id}:1`)
    .text("😓 Hard", `rate:${row.id}:2`).row()
    .text("🙂 Good", `rate:${row.id}:3`)
    .text("🚀 Easy", `rate:${row.id}:4`);

  await ctx.reply(
    `– *${md(row.word)}* — ${md(row.translation)}\n  _${md(row.example)}_`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );

});

// /allwords: показ усіх слів користувача
bot.command('allwords', ctx => {
  const uid = String(ctx.from.id);

  const rows = db.prepare(
    `SELECT word, translation, example FROM words WHERE user_id = ? ORDER BY word COLLATE NOCASE ASC`
  ).all(uid);

  if (!rows.length) {
    return ctx.reply('📭 У тебе ще немає доданих слів.');
  }

  let message = '📚 *Твій словник:*\n\n';
  for (const r of rows) {
    message += `– *${md(r.word)}* — ${md(r.translation)}\n  _${md(r.example)}_\n\n`;
  }

  return ctx.reply(message.trim(), { parse_mode: 'Markdown' });
});

// /getremind: подивитись час нагадування
bot.command('getremind', ctx => {
  const uid = String(ctx.from.id);
  const row = db.prepare(`SELECT time FROM reminders WHERE user_id = ?`).get(uid);
  const t = row?.time || '10:00';
  return ctx.reply(`⏰ Час нагадування: ${t} (змінити: /setremind HH:MM)`);
});

// /setremind HH:MM: встановити час нагадування
bot.command('setremind', ctx => {
  const uid = String(ctx.from.id);
  const text = ctx.message?.text || '';
  const hhmm = text.split(/\s+/)[1]; // беремо друге слово після команди

  if (!/^\d{2}:\d{2}$/.test(hhmm)) {
    return ctx.reply('Вкажи час у форматі HH:MM, напр. /setremind 10:00');
  }
  const [hh, mm] = hhmm.split(':').map(Number);
  if (hh > 23 || mm > 59) {
    return ctx.reply('Некоректний час. Приклад: /setremind 09:30');
  }

  db.prepare(`
    INSERT INTO reminders (user_id, time)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET time=excluded.time
  `).run(uid, hhmm);

  return ctx.reply(`Готово! ⏰ Нагадуватиму о ${hhmm}.`);
});


// Обробка текстових повідомлень
bot.on('message:text', async ctx => {
  const text = ctx.message.text.trim();
  const uid = String(ctx.from.id);
  if (text.startsWith('/')) return;
  const session = sessions[uid];
  if (session) {
    if (session.action === 'setup') {
      // Анкета
      switch (session.step) {
        case 1:
          session.data.name = text;
          session.step = 2;
          return ctx.reply(`Приємно познайомитись, ${text}! Який твій рівень німецької? (A1, A2, B1, B2)`);
        case 2: {
        const lvl = text.toUpperCase().trim();
        const allowed = new Set(["A1", "A2", "B1", "B2"]);
        if (!allowed.has(lvl)) {
            return ctx.reply('Вкажи рівень з варіантів: A1, A2, B1, B2 🙂');
        }
        session.data.level = lvl;
        session.step = 3;
        return ctx.reply('Що хочете покращити? (розмовна, лексика, граматика, вимова)');
        }


case 3:
  session.data.goals = text.trim().toLowerCase();

  // Перевірка рівня (щоб точно не зберегти сміття, навіть якщо step 2 був зламаний)
  const allowedLevels = new Set(["A1", "A2", "B1", "B2"]);
  if (!allowedLevels.has(session.data.level)) {
    session.step = 2;
    return ctx.reply('Вкажи рівень з варіантів: A1, A2, B1, B2 🙂');
  }

  // Перевірка цілей
  const allowedGoals = new Set(["розмовна", "лексика", "граматика", "вимова"]);
  if (!allowedGoals.has(session.data.goals)) {
    return ctx.reply('Вкажи ціль з варіантів: розмовна, лексика, граматика, вимова 🙂');
  }

  // Збереження профілю
  db.prepare(
    `INSERT INTO preferences (user_id, name, level, goals)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       name=excluded.name,
       level=excluded.level,
       goals=excluded.goals`
  ).run(
    uid,
    session.data.name,
    session.data.level,
    session.data.goals
  );

  delete sessions[uid];
  return ctx.reply(
    `Профіль збережено:\n– Ім’я: ${session.data.name}\n– Рівень: ${session.data.level}\n– Цілі: ${session.data.goals}`
  );

      }
    }
    if (session.action === 'lesson' && session.inLesson) {
      // Відповідь на урок
      const answer = text;
      const fb = await getFeedback(answer);
      await ctx.reply(`Ваша відповідь: ${answer}`);
      await ctx.reply(fb, { parse_mode: 'Markdown' });
      db.prepare(
        `UPDATE stats SET lessons_done = lessons_done + 1 WHERE user_id = ?`
      ).run(uid);
      delete sessions[uid];
      return;
    }
    if (session.action === 'addword') {
      // Додавання слова
      if (session.step === 1) {
        session.data.word = text;
        session.step = 2;
        return ctx.reply('Введіть переклад слова:');
      }
      if (session.step === 2) {
        session.data.translation = text;
        session.step = 3;
        return ctx.reply('Надішліть приклад речення:');
      }
      if (session.step === 3) {
        session.data.example = text;
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO words (user_id, word, translation, example, nextReview, interval) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(uid, session.data.word, session.data.translation, session.data.example, now, 1);
        delete sessions[uid];
        return ctx.reply(
          `Слово *${session.data.word}* додано! Використайте /review для повторення.`,
          { parse_mode:'Markdown' }
        );
      }
    }
  }
// // if (session?.action === "rateWord") {
// //   const rate = Number(text.trim());
// //   const cur = session.data.interval || 1;
// //   let nextDays = 1;

// //   if (rate === 1) nextDays = 1;                                  // Again
// //   else if (rate === 2) nextDays = Math.max(1, Math.round(cur * 1.4)); // Hard
// //   else if (rate === 3) nextDays = Math.max(1, cur * 2);          // Good
// //   else if (rate === 4) nextDays = Math.max(2, Math.round(cur * 2.8)); // Easy
// //   else return ctx.reply('Введи 1/2/3/4 🙂');

// //   const next = new Date(Date.now() + nextDays * 86400000).toISOString();
// //   db.prepare(`UPDATE words SET interval = ?, nextReview = ? WHERE id = ?`)
// //     .run(nextDays, next, session.data.wordId);

// //   delete sessions[uid];
// //   await ctx.reply('Збережено ✅');

// //   // Виклик логіки review безпосередньо
// //   const nowIso = new Date().toISOString();
// // const rows = db.prepare(
// //   `SELECT * FROM words WHERE user_id = ? ORDER BY nextReview ASC LIMIT 1`
// // ).all(uid);


// //   if (!rows.length) {
// //     return ctx.reply('Слів для повторення більше немає ✅');
// //   }

// //   const row = rows[0];
// //   await ctx.reply(
// //     `– *${md(row.word)}* — ${md(row.translation)}\n  _${md(row.example)}_`,
// //     { parse_mode: 'Markdown' }
// //   );
// //   await ctx.reply(
// //     `Оціни, як згадав слово "${md(row.word)}":\n` +
// //     `1) Again  2) Hard  3) Good  4) Easy\n` +
// //     `Напиши просто 1/2/3/4`
// //   );
// //   sessions[uid] = { action: "rateWord", data: { wordId: row.id, interval: row.interval || 1 } };
// //   return;
// }
//   await ctx.reply('Echo: ' + text);
});

bot.on('callback_query:data', async ctx => {
  const data = ctx.callbackQuery.data;

  // 4.1) Кнопка "Почати повторення"
  if (data === 'start_review') {
    await ctx.answerCallbackQuery(); // закриває "годинник" на кнопці
    const uid = String(ctx.from.id);
    const nowIso = new Date().toISOString();

    const rows = db.prepare(
      `SELECT * FROM words
       WHERE user_id = ? AND nextReview <= ?
       ORDER BY nextReview ASC
       LIMIT 1`
    ).all(uid, nowIso);

    if (!rows.length) {
      return ctx.editMessageText('Слів для повторення зараз немає ✅');
    }

    const row = rows[0];
    const keyboard = new InlineKeyboard()
      .text("🔁 Again", `rate:${row.id}:1`)
      .text("😓 Hard", `rate:${row.id}:2`).row()
      .text("🙂 Good", `rate:${row.id}:3`)
      .text("🚀 Easy", `rate:${row.id}:4`);

    return ctx.editMessageText(
      `– *${md(row.word)}* — ${md(row.translation)}\n  _${md(row.example)}_`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  }

  // 4.2) Оцінки (rate:wordId:score)
  const [action, wordId, rateStr] = data.split(':');
  if (action !== 'rate') return;

  const rate = Number(rateStr);
  const word = db.prepare(`SELECT * FROM words WHERE id = ?`).get(wordId);
  if (!word) {
    return ctx.answerCallbackQuery({ text: "Слово не знайдено ❌", show_alert: true });
  }

  const cur = word.interval || 1;
  let nextDays = 1;
  if (rate === 1) nextDays = 1;
  else if (rate === 2) nextDays = Math.max(1, Math.round(cur * 1.4));
  else if (rate === 3) nextDays = Math.max(1, cur * 2);
  else if (rate === 4) nextDays = Math.max(2, Math.round(cur * 2.8));

  const next = new Date(Date.now() + nextDays * 86400000).toISOString();
  db.prepare(`UPDATE words SET interval = ?, nextReview = ? WHERE id = ?`)
    .run(nextDays, next, wordId);

  await ctx.answerCallbackQuery({ text: "Збережено ✅" });

  // Показуємо наступне прострочене слово
  const uid = String(ctx.from.id);
  const nowIso2 = new Date().toISOString();
  const nextRows = db.prepare(
    `SELECT * FROM words
     WHERE user_id = ? AND nextReview <= ?
     ORDER BY nextReview ASC
     LIMIT 1`
  ).all(uid, nowIso2);

  if (!nextRows.length) {
    return ctx.editMessageText('Слів для повторення більше немає ✅');
  }

  const row2 = nextRows[0];
  const keyboard2 = new InlineKeyboard()
    .text("🔁 Again", `rate:${row2.id}:1`)
    .text("😓 Hard", `rate:${row2.id}:2`).row()
    .text("🙂 Good", `rate:${row2.id}:3`)
    .text("🚀 Easy", `rate:${row2.id}:4`);

  return ctx.editMessageText(
    `– *${md(row2.word)}* — ${md(row2.translation)}\n  _${md(row2.example)}_`,
    { parse_mode: 'Markdown', reply_markup: keyboard2 }
  );
});





// Обробка голосових повідомлень
bot.on('message:voice', async ctx => {
  const uid = String(ctx.from.id);
  const session = sessions[uid];
  if (session?.action === 'lesson' && session.inLesson) {
    // Обробка відповіді уроку голосом
    await ctx.reply('Отримав голос, обробляю…');
    try {
      const file = await ctx.getFile();
      const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
      const text = await transcribeVoice(url);
      await ctx.reply(`📝 Розпізнаний текст:\n${text}`);
      const fb = await getFeedback(text);
      await ctx.reply(fb, { parse_mode:'Markdown' });
      db.prepare(
        `UPDATE stats SET lessons_done = lessons_done + 1 WHERE user_id = ?`
      ).run(uid);
    } catch (e) {
      console.error(e);
      await ctx.reply('Не вдалося обробити голос.');
    } finally {
      delete sessions[uid];
    }
    return;
  }
  // Стандартна обробка голосу
  await ctx.reply('Обробив голос, отримали текст…');
  try {
    const file = await ctx.getFile();
    const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
    const text = await transcribeVoice(url);
    db.prepare(
      `UPDATE stats SET voice_count = voice_count + 1 WHERE user_id = ?`
    ).run(uid);
    await ctx.reply(`📝 Розпізнаний текст:\n${text}`);
    const fb = await getFeedback(text);
    await ctx.reply(fb, { parse_mode:'Markdown' });
  } catch (e) {
    console.error(e);
    await ctx.reply('Сталася помилка при обробці голосу.');
  }
});


// Щохвилинна перевірка: кому зараз час нагадати
cron.schedule('* * * * *', async () => {
  try {
    // Беремо локальний час сервера у форматі HH:MM
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const hhmm = `${hh}:${mm}`;

    // Кому нагадувати прямо зараз
    const dueUsers = db.prepare(`SELECT user_id FROM reminders WHERE time = ?`).all(hhmm);
    if (!dueUsers.length) return;

    for (const u of dueUsers) {
      const uid = String(u.user_id);
      const nowIso = new Date().toISOString();
      // чи є що повторювати
      const cnt = db.prepare(
        `SELECT COUNT(*) as c FROM words WHERE user_id = ? AND nextReview <= ?`
      ).get(uid, nowIso).c;

      if (cnt > 0) {
        const kb = new InlineKeyboard().text('▶️ Почати повторення', 'start_review');
        await bot.api.sendMessage(
          uid,
          `Сьогодні є слова до повторення: ${cnt}.`,
          { reply_markup: kb }
        );
      }
    }
  } catch (e) {
    console.error('cron error:', e);
  }
});


bot.start();