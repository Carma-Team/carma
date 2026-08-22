import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { useTranslation } from './useTranslation';

function Probe() {
  const { t, setLang } = useTranslation();
  return (
    <div>
      <span data-testid="value">{t('common.retry')}</span>
      <span data-testid="missing">{t('nope.does.not.exist')}</span>
      <button onClick={() => setLang('EN')}>english</button>
    </div>
  );
}

describe('useTranslation', () => {
  it('resolves nested dot-notation keys for the current language', () => {
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );

    expect(screen.getByTestId('value')).toHaveTextContent('נסה שוב');
  });

  it('falls back to the key path when a key is missing', () => {
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );

    expect(screen.getByTestId('missing')).toHaveTextContent('nope.does.not.exist');
  });

  it('re-resolves the same key after switching language', () => {
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );

    fireEvent.click(screen.getByText('english'));

    expect(screen.getByTestId('value')).toHaveTextContent('Retry');
  });
});
