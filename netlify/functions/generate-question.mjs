// Netlify Function (v2) — secure server-side proxy to Claude.
// Generates one PLAB 1-style single-best-answer question on demand.
// The API key is read from the ANTHROPIC_API_KEY environment variable set in
// Netlify (Project configuration -> Environment variables). It is NEVER sent to the browser.

const MODEL = "claude-sonnet-4-6";          // update here if the model id changes
const ANTHROPIC_VERSION = "2023-06-01";

const SYSTEM = `You are a medical educator writing ONE PLAB 1-style single-best-answer (SBA) question for International Medical Graduates revising for UK clinical practice.

Rules:
- Clinical content must be standard, safe and aligned with mainstream UK guidance (NICE / BNF / Resuscitation Council) at a general level. Never invent unsafe, fringe or harmful management. Do not give specific dangerous dosing.
- Use a short, fictional vignette with no real patient identifiers.
- Provide 4 or 5 options with exactly one single best answer.
- Keep it educational and appropriate for exam revision only.

Respond with ONLY valid minified JSON (no markdown, no commentary) matching exactly:
{"topic":string,"stem":string,"options":[{"key":"A","text":string},{"key":"B","text":string},{"key":"C","text":string},{"key":"D","text":string}],"answer":"A","explanation":string,"ukNote":string}

"explanation" says why the answer is correct and briefly why the main distractors are not. "ukNote" is one short sentence on UK practice. Output the JSON and nothing else.`;

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return json({ error: "AI generation isn't switched on yet. Add ANTHROPIC_API_KEY in Netlify to enable it." }, 200);
  }

  let topic = "any PLAB 1 topic";
  try {
    const body = await req.json();
    if (body && body.topic && body.topic !== "All topics") topic = body.topic;
  } catch (_) {}

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 900,
        system: SYSTEM,
        messages: [{ role: "user", content: `Write one fresh SBA question on: ${topic}. Make the scenario different each time.` }]
      })
    });

    if (!r.ok) {
      const t = await r.text();
      return json({ error: "The AI service returned an error.", detail: t.slice(0, 200) }, 200);
    }
    const data = await r.json();
    const text = (data.content || []).map(b => b.text || "").join("").trim();
    const clean = text.replace(/^```(?:json)?/i, "").replace(/```$/g, "").trim();

    let q;
    try { q = JSON.parse(clean); }
    catch (e) { return json({ error: "Couldn't read the generated question. Please try again." }, 200); }

    q.id = "ai-" + Date.now();
    q.ai = true;
    return json({ question: q }, 200);
  } catch (e) {
    return json({ error: "Couldn't reach the AI service. Please try again." }, 200);
  }
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
