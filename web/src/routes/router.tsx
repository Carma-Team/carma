import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppShell } from '@/components/shell/AppShell';
import { HomePage } from '@/pages/HomePage';
import { RedemptionPage } from '@/pages/RedemptionPage';
import { ComingSoonPage } from '@/pages/ComingSoonPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { SignInPage } from '@/pages/SignInPage';
import { ProtectedRoute } from './ProtectedRoute';

// The shell (CAR-204) wraps every authenticated route, including 404 — an
// unknown path still renders inside the sidebar/header chrome, not a blank
// page. /rewards and /business-profile render ComingSoonPage until their own
// tickets (CAR-202, business profile) land; /redemption is CAR-68.
export const routes: RouteObject[] = [
  { path: '/sign-in', element: <SignInPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <HomePage /> },
          { path: '/redemption', element: <RedemptionPage /> },
          { path: '/rewards', element: <ComingSoonPage /> },
          { path: '/business-profile', element: <ComingSoonPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
