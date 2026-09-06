import { attemptRefresh } from './refresh';
import { getSession, setSession } from './session';

// The one place a feature page may change the signed-in user's own display
// name in the shared session — CAR-342's Account Settings page calls this
// after its own `PATCH /api/users/me` confirms server-side, rather than
// writing `lib/auth/session.ts` directly. Same shape as
// `selfMembership.ts::applySelfMembershipChange`: apply the just-confirmed
// value synchronously so AppShell's header re-renders with it immediately,
// then reconcile with the server in the background.
export async function applySelfNameChange(userId: string, name: string | null): Promise<void> {
  const session = getSession();
  if (!session || session.user.id !== userId) return;

  setSession({ ...session, user: { ...session.user, name } });
  await attemptRefresh();
}
