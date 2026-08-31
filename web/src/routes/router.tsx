import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppShell } from '@/components/shell/AppShell';
import { RedemptionPage } from '@/pages/RedemptionPage';
import { RewardsPage } from '@/pages/RewardsPage';
import { PermissionsPage } from '@/pages/PermissionsPage';
import { InvitationsPage } from '@/pages/InvitationsPage';
import { AcceptInvitationPage } from '@/pages/AcceptInvitationPage';
import { AcceptInvitationEntryPage } from '@/pages/AcceptInvitationEntryPage';
import { CreateAccountPage } from '@/pages/CreateAccountPage';
import { ComingSoonPage } from '@/pages/ComingSoonPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { SignInPage } from '@/pages/SignInPage';
import { BusinessRegistrationPage } from '@/pages/BusinessRegistrationPage';
import { BusinessRequestStatusPage } from '@/pages/BusinessRequestStatusPage';
import { ProtectedRoute } from './ProtectedRoute';
import { RequireBusinessRole } from './RequireBusinessRole';
import { LandingRoute } from './LandingRoute';

// The shell (CAR-204) wraps every authenticated route, including 404 — an
// unknown path still renders inside the sidebar/header chrome, not a blank
// page. /business-profile renders ComingSoonPage until its own ticket lands;
// /redemption is CAR-68, /rewards is CAR-202. CAR-116 wraps the four real
// business routes in one `RequireBusinessRole` allowing all three roles —
// a null/ambiguous membership (no membership, or more than one — CAR-258
// fails closed rather than guessing) must not reach any of them, while the
// per-role differences within a route (e.g. /rewards' manage actions) are
// each page's own job. 404 sits outside that gate on purpose: an unknown
// path is not a permission question, and stays reachable exactly as before.
// /register and /register/status (CAR-203) sit outside ProtectedRoute like
// /sign-in — the one part of this app that must work with no session at all.
// /permissions (CAR-117) gets its own `RequireBusinessRole`, allowing OWNER
// only — a narrower gate than the four routes above it, which every role in
// the matrix can at least reach.
export const routes: RouteObject[] = [
  { path: '/sign-in', element: <SignInPage /> },
  { path: '/create-account', element: <CreateAccountPage /> },
  { path: '/register', element: <BusinessRegistrationPage /> },
  { path: '/register/status', element: <BusinessRequestStatusPage /> },
  // CAR-118's recipient side sits outside ProtectedRoute like /sign-in and
  // /create-account: an invitation link must work for someone with no
  // session at all, and the page itself decides what an unauthenticated
  // visitor sees (a sign-in/create-account choice) versus an authenticated
  // one (the business/role preview).
  { path: '/business-invite/:token', element: <AcceptInvitationPage /> },
  { path: '/accept-invite', element: <AcceptInvitationEntryPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          {
            element: <RequireBusinessRole allow={['OWNER', 'MANAGER', 'CASHIER']} />,
            children: [
              { path: '/', element: <LandingRoute /> },
              { path: '/redemption', element: <RedemptionPage /> },
              { path: '/rewards', element: <RewardsPage /> },
              { path: '/business-profile', element: <ComingSoonPage /> },
            ],
          },
          {
            element: <RequireBusinessRole allow={['OWNER']} />,
            children: [
              { path: '/permissions', element: <PermissionsPage /> },
              { path: '/permissions/invitations', element: <InvitationsPage /> },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
