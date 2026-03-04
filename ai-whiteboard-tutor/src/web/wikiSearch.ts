export type WebResult = {
  title: string;
  url: string;
  snippet: string;
  source: "wikipedia" | "duckduckgo";
};

export async function wikiSearch(query: string, limit = 5): Promise<WebResult[]> {
  const q = query.trim();
  if (!q) return [];

  // Wikipedia opensearch API (no key, CORS-friendly)
  const url =
    "https://en.wikipedia.org/w/api.php" +
    `?action=opensearch&search=${encodeURIComponent(q)}` +
    `&limit=${limit}&namespace=0&format=json&origin=*`;

  const res = await fetch(url);
  if (!res.ok) return [];

  const data = await res.json();
  // data: [searchTerm, titles[], descriptions[], urls[]]
  const titles: string[] = data?.[1] ?? [];
  const descs: string[] = data?.[2] ?? [];
  const links: string[] = data?.[3] ?? [];

  return titles.map((t, i) => ({
    title: t,
    url: links[i] || "",
    snippet: descs[i] || "",
    source: "wikipedia" as const,
  })).filter(r => r.url);
}
