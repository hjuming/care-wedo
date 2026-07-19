type PublicErrorRule = {
  pattern: RegExp;
  message?: string;
  preserveMessage?: boolean;
  status: number;
};

type ResolvePublicErrorOptions = {
  fallback: string;
  fallbackStatus?: number;
  rules?: PublicErrorRule[];
};

export function resolvePublicApiError(error: unknown, options: ResolvePublicErrorOptions) {
  const rawMessage = error instanceof Error ? error.message : String(error || "");

  if (rawMessage.includes("請先登入")) {
    return { message: "請先登入", status: 401 };
  }

  const matchedRule = options.rules?.find((rule) => rule.pattern.test(rawMessage));
  if (matchedRule) {
    return {
      message: matchedRule.preserveMessage ? rawMessage : (matchedRule.message || options.fallback),
      status: matchedRule.status,
    };
  }

  return {
    message: options.fallback,
    status: options.fallbackStatus || 500,
  };
}
