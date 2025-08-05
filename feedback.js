// feedback.js
const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Дає короткий фідбек українською: 
 * 1) Основні помилки 
 * 2) Краще так 
 * 3) Вимова
 */
async function getFeedback(text) {
  const prompt = `
Ти — помічник із викладання німецької. Дай фідбек до цього речення:
"${text}"

Відповідь в форматі Markdown:
1) **Основні помилки**  
- …  
2) **Краще так**  
> виправлене речення  
3) **Вимова**  
- поради щодо звучання
`;
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Ти — досвідчений викладач німецької для українців." },
      { role: "user", content: prompt }
    ]
  });
  return res.choices[0].message.content;
}

module.exports = { getFeedback };
