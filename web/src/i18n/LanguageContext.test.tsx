import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LanguageProvider } from './LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

function LanguageProbe() {
  const { lang, setLang } = useTranslation();
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <button onClick={() => setLang('HE')}>hebrew</button>
      <button onClick={() => setLang('EN')}>english</button>
    </div>
  );
}

describe('LanguageProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to Hebrew with RTL direction', () => {
    render(
      <LanguageProvider>
        <LanguageProbe />
      </LanguageProvider>,
    );

    expect(screen.getByTestId('lang')).toHaveTextContent('HE');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('he');
  });

  it('switches to English with LTR direction and persists the choice', () => {
    render(
      <LanguageProvider>
        <LanguageProbe />
      </LanguageProvider>,
    );

    fireEvent.click(screen.getByText('english'));

    expect(screen.getByTestId('lang')).toHaveTextContent('EN');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
    expect(window.localStorage.getItem('carma_lang')).toBe('EN');
  });

  it('switches back to Hebrew with RTL direction', () => {
    render(
      <LanguageProvider>
        <LanguageProbe />
      </LanguageProvider>,
    );

    fireEvent.click(screen.getByText('english'));
    fireEvent.click(screen.getByText('hebrew'));

    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('he');
  });
});
