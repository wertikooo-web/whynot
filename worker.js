const MODEL = "@cf/zai-org/glm-4.7-flash";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=UTF-8",
};

const MODES = {
  reason: `СЛУШАЯ РАЗУМ. Смотри на факты, последствия, деньги, вероятность и практические риски. Ответ должен быть здравым, острым и полезным, но не занудным.`,
  universe: `СЛУШАЯ ВСЕЛЕННУЮ. Смотри на интуицию, момент, ощущения, совпадения и желания человека. Тон слегка мистический и игровой. Не выдавай мистику за факт.`,
  human: `ПО-ЧЕЛОВЕЧЕСКИ. Отвечай как умный, теплый и остроумный друг за столом. Используй жизненный опыт, эмпатию и здравый смысл. Можно слегка подколоть, если уместно.`,
  wild: `БЕЗОТВЕТСТВЕННО. Дай дерзкую, импульсивную и провокационную версию ответа. Будь смешным и озорным, но не подталкивай к опасным, незаконным, несогласованным или серьезно вредным действиям.`,
};

const LANGUAGES = {
  ru: "русском",
  en: "английском",
  ro: "румынском",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS,
  });
}

function extractAssistantText(result) {
  if (!result) return "";

  // Current GLM Workers AI response: choices[0].message.content
  const content = result?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return content.trim();

  // Compatibility fallbacks for other Workers AI text models / response shapes
  if (typeof result.response === "string" && result.response.trim()) return result.response.trim();
  if (typeof result.result === "string" && result.result.trim()) return result.result.trim();
  if (typeof result.text === "string" && result.text.trim()) return result.text.trim();
  if (typeof result === "string" && result.trim()) return result.trim();

  return "";
}

function parseAnswer(raw) {
  let text = String(raw || "").trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  // Prefer JSON when the model follows the instruction
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      const verdict = String(parsed.verdict || "").trim();
      const reason = String(parsed.reason || "").trim();
      if (verdict || reason) return { verdict, reason };
    }
  } catch (_) {}

  // Also accept VERDICT: / REASON: output
  const verdictMatch = text.match(/(?:VERDICT|ВЕРДИКТ)\s*:\s*(.+?)(?=\n|(?:REASON|ПРИЧИНА|ПОЧЕМУ)\s*:|$)/is);
  const reasonMatch = text.match(/(?:REASON|ПРИЧИНА|ПОЧЕМУ)\s*:\s*([\s\S]+)/i);

  let verdict = verdictMatch?.[1]?.trim() || "";
  let reason = reasonMatch?.[1]?.trim() || "";

  if (!verdict) {
    const lines = text.split("\n").map((x) => x.trim()).filter(Boolean);
    verdict = (lines.shift() || "WHY NOT?").replace(/^(?:VERDICT|ВЕРДИКТ)\s*:\s*/i, "").trim();
    reason = reason || lines.join(" ").trim();
  }

  verdict = verdict.replace(/\*\*/g, "").replace(/^['\"]|['\"]$/g, "").replace(/[.!]+$/, "").trim();
  reason = reason.replace(/\*\*/g, "").trim();

  return { verdict, reason };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method === "GET") {
      return json({
        ok: true,
        service: "WHY NOT? AI",
        model: MODEL,
        message: "Send a POST request with question, language and mode",
      });
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "POST required" }, 405);
    }

    try {
      const body = await request.json();
      const question = String(body?.question || "").trim();
      const language = Object.hasOwn(LANGUAGES, body?.language) ? body.language : "ru";
      const mode = Object.hasOwn(MODES, body?.mode) ? body.mode : "reason";

      if (!question) return json({ ok: false, error: "Question is required" }, 400);
      if (question.length > 3000) return json({ ok: false, error: "Question is too long" }, 400);

      const systemPrompt = `Ты WHY NOT?, игровой оракул для жизненных дилемм.\n\n${MODES[mode]}\n\nОтвечай только на ${LANGUAGES[language]} языке. Ответ короткий, естественный, умный, с легкой иронией. Не повторяй вопрос. Не говори, что ты ИИ. Используй конкретные детали ситуации пользователя. Для обычных бытовых решений можешь занять позицию. Для медицинских, юридических, финансовых, опасных, незаконных или связанных с самоповреждением ситуаций не выдавай развлекательный вердикт за профессиональный совет.\n\nВерни ТОЛЬКО JSON без markdown и без дополнительного текста в формате:\n{"verdict":"короткий вердикт 2-7 слов без точки в конце","reason":"2-4 коротких предложения, примерно 30-80 слов"}`;

      const result = await env.AI.run(MODEL, {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: question },
        ],
        max_completion_tokens: 350,
        temperature: 0.9,
      });

      const raw = extractAssistantText(result);

      if (!raw) {
        // Keep useful diagnostics without returning the full provider payload publicly.
        return json({
          ok: false,
          error: "AI returned an empty response",
          response_shape: result && typeof result === "object" ? Object.keys(result) : typeof result,
        }, 502);
      }

      const answer = parseAnswer(raw);

      if (!answer.verdict || !answer.reason) {
        return json({
          ok: false,
          error: "AI response could not be parsed",
          raw,
        }, 502);
      }

      return json({
        ok: true,
        verdict: answer.verdict,
        reason: answer.reason,
        mode,
        language,
      });
    } catch (error) {
      return json({
        ok: false,
        error: error?.message || String(error) || "AI request failed",
      }, 500);
    }
  },
};
