import type { Handler } from "@netlify/functions";

type DdgResult = { title: string; url: string; snippet: string };

function stripTags(s: string) {
  return s.replace(/<[^>]*>/g, "");
}

function decodeHtml(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseDuckDuckGoHtml(html: string, limit: number): DdgResult[] {
  const results: DdgResult[] = [];

  const linkRe =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

  const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/;

  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) && results.length < limit) {
    const href = decodeHtml(m[1] || "").trim();
    const title = stripTags(decodeHtml(m[2] || "")).replace(/\s+/g, " ").trim();

    const after = html.slice(linkRe.lastIndex, linkRe.lastIndex + 2500);
    const sm = snippetRe.exec(after);
    const snippet = sm
      ? stripTags(decodeHtml(sm[1] || "")).replace(/\s+/g, " ").trim()
      : "";

    if (href && title) results.push({ title, url: href, snippet });
  }

  return results;
}

export const handler: Handler = async (event) => {
  const corsHeaders = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-allow-headers": "content-type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  try {
    const q = (event.queryStringParameters?.q || "").trim();
    const limit = Math.min(Number(event.queryStringParameters?.limit || 5), 10);

    if (!q) {
      return {
        statusCode: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
        body: JSON.stringify({ results: [] }),
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    const ddgUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    const r = await fetch(ddgUrl, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; NetlifyFunction/1.0; +https://www.netlify.com/)",
        "accept-language": "en-US,en;q=0.9",
      },
    }).finally(() => clearTimeout(timeout));

    const html = await r.text();

    const looksBlocked =
      r.status >= 400 ||
      /captcha|verify you are a human|unusual traffic/i.test(html);

    if (looksBlocked) {
      return {
        statusCode: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          results: [],
          error: `DuckDuckGo blocked or returned status ${r.status}`,
        }),
      };
    }

    const results = parseDuckDuckGoHtml(html, limit);

    return {
      statusCode: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
      body: JSON.stringify({ results }),
    };
  } catch (e: any) {
    return {
      statusCode: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
      body: JSON.stringify({ results: [], error: String(e?.message ?? e) }),
    };
  }
};
