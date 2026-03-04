// netlify/functions/search.ts
// A tiny proxy to avoid CORS for DuckDuckGo.
// Returns title/url/snippet. No key. Free.

export default async (req: Request) => {
  try {
    const urlObj = new URL(req.url);
    const q = (urlObj.searchParams.get("q") || "").trim();
    const limit = Math.min(Number(urlObj.searchParams.get("limit") || 5), 10);

    if (!q) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }

    // DuckDuckGo HTML results (lite) – parse roughly
    const ddgUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    const r = await fetch(ddgUrl, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; NetlifyFunction/1.0; +https://www.netlify.com/)",
      },
    });

    const html = await r.text();

    // crude parsing (good enough for demo)
    const results: Array<{ title: string; url: string; snippet: string }> = [];

    // Match result blocks
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;

    while ((m = re.exec(html)) && results.length < limit) {
      const href = decodeHtml(m[1] || "");
      const title = stripTags(decodeHtml(m[2] || ""));
      const snippet = stripTags(decodeHtml(m[3] || "")).replace(/\s+/g, " ").trim();

      // DDG uses redirect links sometimes; keep as-is for demo
      if (href && title) results.push({ title, url: href, snippet });
    }

    return new Response(JSON.stringify({ results }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ results: [], error: String(e?.message ?? e) }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }
};

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
