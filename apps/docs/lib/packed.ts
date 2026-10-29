/**
 * Reads a value `scripts/gen-route-data.mjs` packed: JSON, gzipped, in base64.
 *
 * The generated modules are Worker upload as well as text the route handlers
 * read, so they are stored compressed (#393). `atob`, `Blob` and
 * `DecompressionStream` are in both Node and the Workers runtime.
 */
export async function unpack<T>(packed: string): Promise<T> {
  const bytes = Uint8Array.from(atob(packed), (c) => c.charCodeAt(0));
  const json = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(json).text());
}
