export async function request<T>(
  path: string,
  token?: string,
  body?: unknown,
  extra?: Record<string, string>,
): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as { detail?: unknown };
    throw new Error(
      typeof problem.detail === 'string' ? problem.detail : 'The request could not be completed.',
    );
  }
  return response.json() as Promise<T>;
}
