import { wikiSearch, type WebResult } from "./wikiSearch";

export async function duckDuckGoSearch(query: string, limit = 5): Promise<WebResult[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `/.netlify/functions/search?q=${encodeURIComponent(q)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const data = await res.json();
  const results = (data?.results ?? []) as Array<{ title: string; url: string; snippet: string }>;

  return results
    .map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      source: "duckduckgo" as const,
    }))
    .filter((r) => r.url && r.title);
}

export async function webSearchPool(query: string): Promise<WebResult[]> {
  const [wiki, ddg] = await Promise.all([
    wikiSearch(query, 5),
    duckDuckGoSearch(query, 5),
  ]);

  // Deduplicate by URL
  const seen = new Set<string>();
  const merged: WebResult[] = [];
  for (const r of [...wiki, ...ddg]) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    merged.push(r);
  }
  return merged.slice(0, 10);
}
