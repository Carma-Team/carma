import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { PlaceholderPage } from '@/pages/PlaceholderPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { SignInPage } from '@/pages/SignInPage';
import { ProtectedRoute } from './ProtectedRoute';

// Still deliberately flat beyond the auth split below — no layout/shell
// route. The real business shell and its nested feature routes belong to
// CAR-204, not this bootstrap.
export const routes: RouteObject[] = [
  { path: '/sign-in', element: <SignInPage /> },
  {
    element: <ProtectedRoute />,
    children: [{ path: '/', element: <PlaceholderPage /> }],
  },
  { path: '*', element: <NotFoundPage /> },
];

export const router = createBrowserRouter(routes);
