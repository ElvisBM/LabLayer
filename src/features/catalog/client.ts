export async function catalogRequest(
  user: { getIdToken(): Promise<string> },
  path: string,
  body?: unknown,
) {
  const token = await user.getIdToken();
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível concluir.');
  return result;
}
