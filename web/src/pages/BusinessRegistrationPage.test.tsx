import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { BusinessRegistrationPage } from './BusinessRegistrationPage';
import { startPhoneVerification, verifyOtp } from '@/lib/auth/otpApi';
import { geocodeAddress } from '@/lib/api/geocoding';
import { submitJoinRequest } from '@/lib/api/businessRegistration';
import { getSession, setSession } from '@/lib/auth/session';
import type { AuthUser } from '@/lib/auth/types';

vi.mock('@/lib/auth/otpApi', () => ({ startPhoneVerification: vi.fn(), verifyOtp: vi.fn() }));
vi.mock('@/lib/api/geocoding', () => ({ geocodeAddress: vi.fn() }));
vi.mock('@/lib/api/businessRegistration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/businessRegistration')>();
  return { ...actual, submitJoinRequest: vi.fn() };
});

const USER: AuthUser = {
  id: 'u1',
  name: 'Dana Cohen',
  email: null,
  role: 'DRIVER',
  businessId: null,
  businessCategory: null,
  businessName: null,
  businessNameHe: null,
};

function renderPage() {
  return render(
    <LanguageProvider>
      <MemoryRouter>
        <BusinessRegistrationPage />
      </MemoryRouter>
    </LanguageProvider>,
  );
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText('שם העסק (אנגלית)'), { target: { value: 'Aroma' } });
  fireEvent.change(screen.getByLabelText('שם העסק (עברית)'), { target: { value: 'ארומה' } });
  fireEvent.change(screen.getByLabelText('כתובת'), { target: { value: 'רוטשילד 1, תל אביב' } });
  fireEvent.change(screen.getByLabelText('מספר עוסק / ח.פ'), { target: { value: '123456789' } });
  fireEvent.change(screen.getByLabelText('איש קשר'), { target: { value: 'Dana Cohen' } });
  fireEvent.change(screen.getByLabelText('טלפון נייד'), { target: { value: '+972501234567' } });
}

async function fillContinueAndConfirmLocation() {
  fillRequiredFields();
  fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'אישור המיקום' })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'אישור והמשך' }));
  await waitFor(() => expect(screen.getByLabelText('קוד אימות')).toBeInTheDocument());
}

describe('BusinessRegistrationPage', () => {
  beforeEach(() => {
    setSession(null);
    vi.mocked(startPhoneVerification).mockReset();
    vi.mocked(verifyOtp).mockReset();
    vi.mocked(submitJoinRequest).mockReset();
    vi.mocked(geocodeAddress).mockReset();
  });

  it('does not show a map or coordinate field on the initial form — address text is the only way in', () => {
    renderPage();

    expect(screen.queryByLabelText(/קו רוחב|קו אורך|Latitude|Longitude/)).not.toBeInTheDocument();
    expect(document.querySelector('.leaflet-container')).not.toBeInTheDocument();
  });

  it('derives coordinates automatically from the address via geocoding, and submits the expected payload', async () => {
    vi.mocked(geocodeAddress).mockResolvedValue({ outcome: 'found', lat: 32.0648, lng: 34.7748 });
    vi.mocked(startPhoneVerification).mockResolvedValue({ outcome: 'ok', expiresInSeconds: 300 });
    vi.mocked(verifyOtp).mockResolvedValue({ outcome: 'ok', accessToken: 'jwt-1', user: USER });
    vi.mocked(submitJoinRequest).mockResolvedValue({ outcome: 'ok', id: 'r1', createdAt: '2026-08-27T00:00:00Z' });

    renderPage();
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));

    expect(geocodeAddress).toHaveBeenCalledWith('רוטשילד 1, תל אביב');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'אישור המיקום' })).toBeInTheDocument());
    // A successful geocode is confirmable immediately — no forced pin move.
    expect(screen.getByRole('button', { name: 'אישור והמשך' })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'אישור והמשך' }));
    await waitFor(() => expect(screen.getByLabelText('קוד אימות')).toBeInTheDocument());
    expect(submitJoinRequest).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('קוד אימות'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'אימות ושליחת הבקשה' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'הבקשה התקבלה' })).toBeInTheDocument());
    expect(submitJoinRequest).toHaveBeenCalledTimes(1);
    expect(submitJoinRequest).toHaveBeenCalledWith(
      {
        name: 'Aroma',
        nameHe: 'ארומה',
        category: 'other',
        address: 'רוטשילד 1, תל אביב',
        locationLat: 32.0648,
        locationLng: 34.7748,
        registrationNumber: '123456789',
        contactPerson: 'Dana Cohen',
      },
      'jwt-1',
    );
  });

  it('requires the applicant to place a pin before continuing when the address cannot be geocoded — never a silent default', async () => {
    vi.mocked(geocodeAddress).mockResolvedValue({ outcome: 'not_found' });

    renderPage();
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'אישור המיקום' })).toBeInTheDocument());
    expect(screen.getByText("לא הצלחנו לאתר את הכתובת הזו אוטומטית. סמנו מיקום על המפה.")).toBeInTheDocument();
    // No pin shown at the fallback center — it must never look chosen.
    expect(document.querySelector('.leaflet-marker-icon')).not.toBeInTheDocument();
    expect(screen.getByLabelText('קו רוחב')).toHaveValue(null);
    expect(screen.getByLabelText('קו אורך')).toHaveValue(null);
    expect(screen.getByRole('button', { name: 'אישור והמשך' })).toBeDisabled();

    // Only one of the two coordinates typed — still incomplete, still blocked.
    fireEvent.change(screen.getByLabelText('קו רוחב'), { target: { value: '32.1' } });
    expect(screen.getByRole('button', { name: 'אישור והמשך' })).toBeDisabled();

    // An out-of-range longitude must not unblock it either.
    fireEvent.change(screen.getByLabelText('קו אורך'), { target: { value: '999' } });
    expect(screen.getByRole('button', { name: 'אישור והמשך' })).toBeDisabled();

    // A complete, in-range pair is what finally unblocks continuing.
    fireEvent.change(screen.getByLabelText('קו אורך'), { target: { value: '34.78' } });
    expect(screen.getByRole('button', { name: 'אישור והמשך' })).not.toBeDisabled();
    expect(document.querySelector('.leaflet-marker-icon')).toBeInTheDocument();
  });

  it('shows OpenStreetMap attribution wherever the map or geocoded location is displayed', async () => {
    vi.mocked(geocodeAddress).mockResolvedValue({ outcome: 'found', lat: 32.0648, lng: 34.7748 });

    renderPage();
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'אישור המיקום' })).toBeInTheDocument());

    // The explicit caption, present regardless of whether the map tiles
    // themselves have finished loading (asserted separately from Leaflet's
    // own attribution control, which only renders once the tile layer
    // mounts).
    expect(screen.getByText('נתוני המיקום © תורמי OpenStreetMap')).toBeInTheDocument();
  });

  it('triggers geocoding only by clicking Continue, never while typing the address', async () => {
    vi.mocked(geocodeAddress).mockResolvedValue({ outcome: 'found', lat: 32.0648, lng: 34.7748 });

    renderPage();
    const addressInput = screen.getByLabelText('כתובת');
    fireEvent.change(addressInput, { target: { value: 'ר' } });
    fireEvent.change(addressInput, { target: { value: 'רו' } });
    fireEvent.change(addressInput, { target: { value: 'רוט' } });
    fireEvent.change(addressInput, { target: { value: 'רוטשילד 1' } });

    expect(geocodeAddress).not.toHaveBeenCalled();
  });

  it('shows a distinct message for a 429 rate limit, keeps the completed form, and lets the applicant retry', async () => {
    vi.mocked(geocodeAddress)
      .mockResolvedValueOnce({ outcome: 'rate_limited' })
      .mockResolvedValueOnce({ outcome: 'found', lat: 32.0648, lng: 34.7748 });
    vi.mocked(startPhoneVerification).mockResolvedValue({ outcome: 'ok', expiresInSeconds: 300 });

    renderPage();
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'יותר מדי בקשות איתור מיקום' })).toBeInTheDocument());
    // Distinct from "address not found" — never implies the address itself is bad.
    expect(screen.queryByText('לא הצלחנו לאתר את הכתובת הזו אוטומטית. סמנו מיקום על המפה.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'ניסיון נוסף' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'אישור המיקום' })).toBeInTheDocument());
    expect(geocodeAddress).toHaveBeenCalledTimes(2);

    // The retry re-ran geocoding for the same, still-intact form — going
    // all the way to a real submission proves nothing was lost.
    fireEvent.click(screen.getByRole('button', { name: 'אישור והמשך' }));
    await waitFor(() => expect(screen.getByLabelText('קוד אימות')).toBeInTheDocument());
  });

  it('shows a distinct message when the provider is unreachable, and offers a manual-location escape hatch that keeps the form', async () => {
    vi.mocked(geocodeAddress).mockResolvedValue({ outcome: 'unavailable' });

    renderPage();
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'לא הצלחנו להתחבר לשירות איתור המיקום' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'סימון מיקום ידני' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'אישור המיקום' })).toBeInTheDocument());
    // Manual path — same "place a pin before continuing" guard as a plain no-match.
    expect(screen.getByRole('button', { name: 'אישור והמשך' })).toBeDisabled();

    // Going back to the form proves the fields typed before the outage
    // survived it — a provider failure never reset any of `form`'s state.
    fireEvent.click(screen.getByRole('button', { name: 'עריכת הכתובת' }));
    expect(screen.getByLabelText('שם העסק (אנגלית)')).toHaveValue('Aroma');
    expect(screen.getByLabelText('כתובת')).toHaveValue('רוטשילד 1, תל אביב');
  });

  it('never calls the device geolocation API anywhere in the flow', async () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    vi.mocked(geocodeAddress).mockResolvedValue({ outcome: 'found', lat: 32.0648, lng: 34.7748 });

    renderPage();
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'אישור המיקום' })).toBeInTheDocument());

    expect(getCurrentPosition).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('lets the applicant go back and edit the address instead of only offering the map', async () => {
    vi.mocked(geocodeAddress).mockResolvedValue({ outcome: 'not_found' });

    renderPage();
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'אישור המיקום' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'עריכת הכתובת' }));

    expect(screen.getByLabelText('כתובת')).toBeInTheDocument();
  });

  it('never writes the OTP-verified token to the shared session store — no global authenticated session is created', async () => {
    vi.mocked(geocodeAddress).mockResolvedValue({ outcome: 'found', lat: 32.0648, lng: 34.7748 });
    vi.mocked(startPhoneVerification).mockResolvedValue({ outcome: 'ok', expiresInSeconds: 300 });
    vi.mocked(verifyOtp).mockResolvedValue({ outcome: 'ok', accessToken: 'jwt-1', user: USER });
    vi.mocked(submitJoinRequest).mockResolvedValue({ outcome: 'ok', id: 'r1', createdAt: '2026-08-27T00:00:00Z' });

    renderPage();
    await fillContinueAndConfirmLocation();
    expect(getSession()).toBeNull();

    fireEvent.change(screen.getByLabelText('קוד אימות'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'אימות ושליחת הבקשה' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'הבקשה התקבלה' })).toBeInTheDocument());
    expect(getSession()).toBeNull();
  });

  it('is blocked until OTP verification passes', async () => {
    vi.mocked(geocodeAddress).mockResolvedValue({ outcome: 'found', lat: 32.0648, lng: 34.7748 });
    vi.mocked(startPhoneVerification).mockResolvedValue({ outcome: 'ok', expiresInSeconds: 300 });
    vi.mocked(verifyOtp).mockResolvedValue({ outcome: 'invalid_code' });

    renderPage();
    await fillContinueAndConfirmLocation();
    fireEvent.change(screen.getByLabelText('קוד אימות'), { target: { value: '0000' } });
    fireEvent.click(screen.getByRole('button', { name: 'אימות ושליחת הבקשה' }));

    await waitFor(() => expect(screen.getByText('הקוד שגוי או שפג תוקפו. נסו שוב או בקשו קוד חדש.')).toBeInTheDocument());
    expect(submitJoinRequest).not.toHaveBeenCalled();
  });

  it('attaches to an existing account instead of creating a second one — a single OTP round trip either way', async () => {
    vi.mocked(geocodeAddress).mockResolvedValue({ outcome: 'found', lat: 32.0648, lng: 34.7748 });
    vi.mocked(startPhoneVerification).mockResolvedValue({ outcome: 'ok', expiresInSeconds: 300 });
    vi.mocked(verifyOtp).mockResolvedValue({ outcome: 'ok', accessToken: 'jwt-1', user: USER });
    vi.mocked(submitJoinRequest).mockResolvedValue({ outcome: 'ok', id: 'r1', createdAt: '2026-08-27T00:00:00Z' });

    renderPage();
    await fillContinueAndConfirmLocation();
    fireEvent.change(screen.getByLabelText('קוד אימות'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'אימות ושליחת הבקשה' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'הבקשה התקבלה' })).toBeInTheDocument());
    expect(startPhoneVerification).toHaveBeenCalledTimes(1);
    expect(verifyOtp).toHaveBeenCalledTimes(1);
  });

  it('does not block on a merely unvalidated registration number — any non-empty value is accepted', async () => {
    vi.mocked(geocodeAddress).mockResolvedValue({ outcome: 'found', lat: 32.0648, lng: 34.7748 });

    renderPage();
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText('מספר עוסק / ח.פ'), { target: { value: 'not-a-real-number' } });
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'אישור המיקום' })).toBeInTheDocument());
  });

  it('blocks submission when a required field is left empty', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));

    expect(geocodeAddress).not.toHaveBeenCalled();
    expect(screen.getByLabelText('שם העסק (אנגלית)')).toBeInTheDocument();
  });

  it('blocks submission when the address field is left empty', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('שם העסק (אנגלית)'), { target: { value: 'Aroma' } });
    fireEvent.change(screen.getByLabelText('מספר עוסק / ח.פ'), { target: { value: '123456789' } });
    fireEvent.change(screen.getByLabelText('איש קשר'), { target: { value: 'Dana Cohen' } });
    fireEvent.change(screen.getByLabelText('טלפון נייד'), { target: { value: '+972501234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));

    expect(geocodeAddress).not.toHaveBeenCalled();
  });

  it('shows an honest, generic conflict message on a 409 — never claims it is specifically the applicant\'s own pending request', async () => {
    vi.mocked(geocodeAddress).mockResolvedValue({ outcome: 'found', lat: 32.0648, lng: 34.7748 });
    vi.mocked(startPhoneVerification).mockResolvedValue({ outcome: 'ok', expiresInSeconds: 300 });
    vi.mocked(verifyOtp).mockResolvedValue({ outcome: 'ok', accessToken: 'jwt-1', user: USER });
    vi.mocked(submitJoinRequest).mockResolvedValue({ outcome: 'conflict' });

    renderPage();
    await fillContinueAndConfirmLocation();
    fireEvent.change(screen.getByLabelText('קוד אימות'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'אימות ושליחת הבקשה' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'לא הצלחנו לשלוח את הבקשה' })).toBeInTheDocument());
    // The server cannot say which of its three 409 reasons this was — the
    // page must not fabricate certainty it doesn't have (see the CAR-203
    // backend contract note in lib/api/businessRegistration.ts).
    expect(screen.queryByText(/כבר יש (לכם )?בקשה/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'בדיקת סטטוס הבקשה' })).toBeInTheDocument();
  });

  it('does not claim the phone number is also the sign-in number — the web sign-in only accepts email + password', () => {
    renderPage();

    expect(screen.queryByText(/מספר ההתחברות|sign-in number/)).not.toBeInTheDocument();
  });

  it('renders in Hebrew RTL by default', () => {
    renderPage();

    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('heading', { name: 'רישום העסק שלכם' })).toBeInTheDocument();
  });

  it('renders in English LTR when the language is switched', () => {
    window.localStorage.setItem('carma_lang', 'EN');

    renderPage();

    expect(document.documentElement.dir).toBe('ltr');
    expect(screen.getByRole('heading', { name: 'Register your business' })).toBeInTheDocument();
    expect(screen.getByLabelText('Business name (English)')).toBeInTheDocument();
  });
});
