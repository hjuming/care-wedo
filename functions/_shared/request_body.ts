/**
 * 安全解析 request JSON body。
 * 解析失敗（空 body、非 JSON）回傳 {}，欄位一律視為 optional，
 * 由呼叫端自行驗證必填欄位——與既有 `if (!body.name)` 風格一致。
 */
export async function readJsonBody<T extends object>(request: Request): Promise<Partial<T>> {
  try {
    return (await request.json()) as Partial<T>;
  } catch {
    return {};
  }
}
