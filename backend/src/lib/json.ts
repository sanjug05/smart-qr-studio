export function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders }
  })
}

export function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status)
}

/** Parses a JSON request body, returning null for anything malformed rather than throwing. */
export async function readJsonBody(request: Request): Promise<unknown | null> {
  try {
    return await request.json()
  } catch {
    return null
  }
}
