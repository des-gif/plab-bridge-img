// Netlify Function (v2) — secure server-side proxy to Claude.
// Generates ONE PLAB 1-style single-best-answer question, grounded in NICE / NICE CKS.
// The API key is read from the ANTHROPIC_API_KEY environment variable set in
// Netlify (Project configuration -> Environment variables). It is NEVER sent to the browser.

const MODEL = "claude-sonnet-4-6";          // update here if the model id changes
const ANTHROPIC_VERSION = "2023-06-01";

const SYSTEM = `You are a medical educator writing ONE PLAB 1-style single-best-answer (SBA) question for International Medical Graduates, grounded in current UK NICE guidance and NICE Clinical Knowledge Summaries (CKS).

Process:
1. Use the web_search tool to find the relevant NICE guideline or NICE CKS topic for the subject on nice.org.uk or cks.nice.org.uk. Base the question and the correct answer on that guidance.
2. Write a short, fictional vignette with no real patient identifiers.
3. Provide 4 or 5 options with exactly one single best answer.
4. Explanation: say what the guidance recommends and why the answer is correct, and briefly why the main distractors are not — IN YOUR OWN WORDS. Do NOT copy guideline text verbatim; summarise.
5. Reference: give the specific guidance you used (name, source, canonical URL).

Safety: only standard, safe, mainstream UK management. Never invent unsafe, fringe or harmful management, and never give specific dangerous dosing. Educational, exam-revision use only.

Output ONLY a single minified JSON object as your final message — no markdown, no commentary, nothing else — matching exactly:
{"topic":string,"stem":string,"options":[{"key":"A","text":string},{"key":"B","text":string},{"key":"C","text":string},{"key":"D","text":string}],"answer":"A","explanation":string,"ukNote":string,"ref":{"label":string,"source":string,"url":string}}
Where "ref.label" is the specific guideline/topic name (e.g. "Community-acquired pneumonia: antimicrobial prescribing"), "ref.source" is one of "NICE guideline" / "NICE CKS" / "NICE BNF", and "ref.url" is the nice.org.uk or cks.nice.org.uk page you used. Output the JSON and nothing else.`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type"
};

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
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
        max_tokens: 1500,
        system: SYSTEM,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
        messages: [{ role: "user", content: `Write one fresh SBA question on: ${topic}. Make the scenario different each time, and base it on current NICE / CKS guidance.` }]
      })
    });

    if (!r.ok) {
      const t = await r.text();
      return json({ error: "The AI service returned an error.", detail: t.slice(0, 200) }, 200);
    }
    const data = await r.json();
    const text = (data.content || []).map(b => (typeof b.text === "string" ? b.text : "")).join("").trim();

    // The model may search first; pull the final JSON object out of the text.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const clean = (start >= 0 && end > start) ? text.slice(start, end + 1) : text;

    let q;
    try { q = JSON.parse(clean); }
    catch (e) { return json({ error: "Couldn't read the generated question. Please try again." }, 200); }

    if (!q || !Array.isArray(q.options) || !q.answer) {
      return json({ error: "The generated question was incomplete. Please try again." }, 200);
    }

    q.id = "ai-" + Date.now();
    q.ai = true;
    return json({ question: q }, 200);
  } catch (e) {
    return json({ error: "Couldn't reach the AI service. Please try again." }, 200);
  }
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...CORS } });
}
