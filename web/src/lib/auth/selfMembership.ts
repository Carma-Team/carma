import { attemptRefresh } from './refresh';
import { getSession, setSession } from './session';
import type { AuthUser } from './types';

type MembershipRole = AuthUser['businessMembershipRole'];

// The one place a feature page may change the signed-in user's own
// business-membership fields in the shared session — CAR-117's permissions
// page calls this after its own role-change/revoke request confirms
// server-side, rather than writing `lib/auth/session.ts` directly.
//
// Applies the just-confirmed value synchronously, before any network round
// trip, so `AppShell`'s nav link and `RequireBusinessRole`'s route guard —
// both reading this same store — render consistently with it on the very
// next render. Then reconciles with the server's authoritative profile in
// the background; `session.ts`'s session-lineage check (applied inside
// `attemptRefresh`, see refresh.ts) is what keeps an older, already-in-flight
// refresh response from undoing what this just wrote once it finally
// resolves.
export async function applySelfMembershipChange(userId: string, newRole: MembershipRole): Promise<void> {
  const session = getSession();
  if (!session || session.user.id !== userId) return;

  // A revoke leaves no membership at all — CAR-258's server contract keeps
  // every business-identity field null together in that case, not just the
  // role, so the patch has to match it or the sidebar keeps naming a
  // business this account no longer belongs to.
  const businessContext: Partial<AuthUser> =
    newRole === null
      ? {
          businessMembershipRole: null,
          businessId: null,
          businessCategory: null,
          businessName: null,
          businessNameHe: null,
          businessMembershipAmbiguous: false,
        }
      : { businessMembershipRole: newRole };

  setSession({ ...session, user: { ...session.user, ...businessContext } });
  await attemptRefresh();
}
