import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { PlaceholderPage } from '@/pages/PlaceholderPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

// Deliberately flat — no layout/shell route. The real business shell and its
// nested feature routes belong to CAR-204, not this bootstrap.
export const routes: RouteObject[] = [
  { path: '/', element: <PlaceholderPage /> },
  { path: '*', element: <NotFoundPage /> },
];

export const router = createBrowserRouter(routes);
