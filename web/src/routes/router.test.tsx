import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { routes } from './router';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <LanguageProvider>
      <RouterProvider router={router} />
    </LanguageProvider>,
  );
}

describe('routes', () => {
  it('renders the placeholder page at / (default language: Hebrew)', () => {
    renderAt('/');

    expect(screen.getByText('תשתית האתר פעילה')).toBeInTheDocument();
  });

  it('renders the not-found page at an unknown path (default language: Hebrew)', () => {
    renderAt('/does-not-exist');

    expect(screen.getByText('הדף לא נמצא')).toBeInTheDocument();
  });
});
