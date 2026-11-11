// Small HTTP helpers shared by the route handlers.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export function conflict(current: {
  version: number;
  updatedAt: string | null;
  deleted?: boolean;
}): HttpError {
  return new HttpError(409, 'version_conflict', 'The stored version differs from If-Match', current);
}

/**
 * The version the client believes is stored. `If-Match: <n>` (optionally quoted, as in an ETag);
 * `If-Match: 0` or `If-None-Match: *` mean "nothing is stored yet".
 */
export function expectedVersion(request: Request): number {
  const ifMatch = request.headers.get('If-Match');
  if (ifMatch === null) {
    if (request.headers.get('If-None-Match')?.trim() === '*') return 0;
    throw new HttpError(428, 'precondition_required', 'If-Match (or If-None-Match: *) is required');
  }
  const match = /^"?(\d{1,15})"?$/.exec(ifMatch.trim());
  if (!match) throw new HttpError(400, 'invalid_if_match', 'If-Match must be a version number');
  return Number(match[1]);
}

/** Reads the request body, refusing (413) as soon as it exceeds `maxBytes`. */
export async function readBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const tooLarge = () => new HttpError(413, 'too_large', `Body exceeds ${maxBytes} bytes`);
  if (Number(request.headers.get('Content-Length') ?? 0) > maxBytes) throw tooLarge();
  if (!request.body) throw new HttpError(400, 'empty_body', 'A request body is required');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  if (total === 0) throw new HttpError(400, 'empty_body', 'A request body is required');
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
