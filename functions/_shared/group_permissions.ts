import type { Env } from "./auth_identity";
import { getUserMemberships, type UserFamilyGroupRow } from "./supabase";

export function canManageMembership(membership: UserFamilyGroupRow): boolean {
  return membership.role === "admin" || membership.can_manage === true;
}

export function manageableGroupIds(memberships: UserFamilyGroupRow[]): number[] {
  return memberships.filter(canManageMembership).map((membership) => membership.group_id);
}

export function assertGroupWriteAccess(memberships: UserFamilyGroupRow[], groupId: number): void {
  if (!memberships.some((membership) => membership.group_id === groupId && canManageMembership(membership))) {
    throw new Error("您沒有修改權限，此家庭資料目前為唯讀");
  }
}

export async function requireGroupWriteAccess(env: Env, userId: number, groupId: number): Promise<void> {
  assertGroupWriteAccess(await getUserMemberships(env, userId), groupId);
}
