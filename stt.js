const fs = require("fs");
const path = require("path");
const axios = require("axios");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const { OpenAI } = require("openai");

ffmpeg.setFfmpegPath(ffmpegPath);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Завантажує з fileUrl, конвертує в WAV і віддає розпізнаний текст.
 */
async function transcribeVoice(fileUrl) {
  // тимчасові шляхи
  const oggPath = path.resolve(__dirname, "voice.ogg");
  const wavPath = path.resolve(__dirname, "voice.wav");

  // 1) Завантажуємо .ogg від Telegram
  const resp = await axios.get(fileUrl, { responseType: "arraybuffer" });
  fs.writeFileSync(oggPath, Buffer.from(resp.data));

  // 2) Конвертуємо в WAV
  await new Promise((resolve, reject) => {
    ffmpeg(oggPath)
      .toFormat("wav")
      .save(wavPath)
      .on("end", resolve)
      .on("error", reject);
  });

  // 3) Посилаємо в Whisper
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(wavPath),
    model: "whisper-1"
  });

  // 4) Повертаємо текст
  return transcription.text;
}

module.exports = { transcribeVoice };
