// Deliberately narrower than the server's `UserOut` — CAR-217 is authentication
// and session handling, not the business dashboard. Extend as the fields a
// business screen actually needs, rather than mirroring every driver-only
// field (points, level, bluetooth device, …) up front.
export type AuthUser = {
  id: string;
  name: string | null;
  email: string | null;
  role: 'DRIVER' | 'BUSINESS' | 'ADMIN';
  businessId: string | null;
  businessCategory: string | null;
};

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};
