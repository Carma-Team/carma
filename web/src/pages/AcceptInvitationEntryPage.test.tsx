import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useParams } from 'react-router-dom';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AcceptInvitationEntryPage } from './AcceptInvitationEntryPage';

// Echoes the resolved `:token` param verbatim — a bare "accept page" stub
// would still pass even if normalization silently stopped happening, since
// any token value matches the route.
function TokenProbe() {
  const { token } = useParams<{ token: string }>();
  return <div>accept page: {token}</div>;
}

function renderPage() {
  const router = createMemoryRouter(
    [
      { path: '/accept-invite', element: <AcceptInvitationEntryPage /> },
      { path: '/business-invite/:token', element: <TokenProbe /> },
    ],
    { initialEntries: ['/accept-invite'] },
  );
  return render(
    <LanguageProvider>
      <RouterProvider router={router} />
    </LanguageProvider>,
  );
}

describe('AcceptInvitationEntryPage', () => {
  it('routes a manually entered code to the same invitation-acceptance page a link would open', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('קוד ההזמנה'), { target: { value: 'TXQ947ZKPS' } });
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));

    expect(await screen.findByText('accept page: TXQ947ZKPS')).toBeInTheDocument();
  });

  it('normalizes a lowercase code with surrounding whitespace to the exact uppercase token before navigating', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('קוד ההזמנה'), { target: { value: '  txq947zkps  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));

    expect(await screen.findByText('accept page: TXQ947ZKPS')).toBeInTheDocument();
  });

  it('requires a code before continuing', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));

    expect(screen.getByText('הזינו את קוד ההזמנה.')).toBeInTheDocument();
  });
});
