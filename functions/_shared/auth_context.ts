import {
  Env,
  VerifiedCareIdentity,
  getBearerToken,
  getOrCreateUserFromIdentity,
  verifyCareIdentity,
} from "./supabase";

export type RequestUser = {
  userId: number;
  identity: VerifiedCareIdentity;
};

type RequestAuthData = {
  identity?: VerifiedCareIdentity;
  userId?: number;
  requestUser?: RequestUser;
};

type RequestUserContext = {
  request: Request;
  env: Env;
  data?: RequestAuthData;
};

export async function getRequestUser(context: RequestUserContext): Promise<RequestUser> {
  if (context.data?.requestUser) return context.data.requestUser;

  let identity = context.data?.identity;
  if (!identity) {
    const token = getBearerToken(context.request);
    if (!token) throw new Error("請先登入");
    identity = await verifyCareIdentity(context.env, token);
  }

  const userId = typeof context.data?.userId === "number"
    ? context.data.userId
    : await getOrCreateUserFromIdentity(context.env, identity);

  const requestUser = { userId, identity };
  context.data = {
    ...(context.data || {}),
    identity,
    userId,
    requestUser,
  };

  return requestUser;
}
