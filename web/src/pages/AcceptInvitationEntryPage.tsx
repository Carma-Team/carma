import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, Heading, Text, Input, Button } from '@/components/ui';

// The manual-code fallback (CAR-118) to the link `AcceptInvitationPage`
// serves — a recipient who was read the code aloud, rather than sent the
// link, types it here and is routed to the exact same page: the token
// becomes the URL fragment there, so a manual code and a clicked link both
// end up validated by the same preview/accept flow.
export function AcceptInvitationEntryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // The server's token alphabet (`READABLE_ALPHABET`) is uppercase-only,
    // and the match against it is a case-sensitive keyed hash (see
    // `services/business_invitations.py::_hash`) — a code read aloud is very
    // plausibly typed in lowercase, and without this it would fail with the
    // exact same "invalid" message a genuinely wrong code gets, with no way
    // to tell the two apart. Normalizing here, before the token ever reaches
    // the URL or the API, keeps that comparison itself untouched.
    const normalized = code.trim().toUpperCase();
    if (!normalized) {
      setError(t('invitations.codeRequiredError'));
      return;
    }
    // A fragment, not a path segment — see `AcceptInvitationPage`'s own note
    // on why, and `services/business_invitations.py::_link` for the matching
    // link format a recipient who *was* sent a link ends up at.
    navigate(`/business-invite#${encodeURIComponent(normalized)}`);
  }

  return (
    <main style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-lg)' }}>
      <Card style={{ maxWidth: '24rem', width: '100%' }}>
        <Heading level={1}>{t('invitations.manualEntryTitle')}</Heading>
        <Text variant="body">{t('invitations.manualEntrySubtitle')}</Text>
        <form onSubmit={handleSubmit} noValidate>
          <Input
            label={t('invitations.codeInputLabel')}
            name="code"
            dir="ltr"
            placeholder={t('invitations.codeInputPlaceholder')}
            value={code}
            error={error ?? undefined}
            onChange={(event) => {
              setError(null);
              setCode(event.target.value);
            }}
          />
          <Button type="submit" style={{ marginTop: 'var(--space-md)' }}>
            {t('invitations.continueButton')}
          </Button>
        </form>
      </Card>
    </main>
  );
}
