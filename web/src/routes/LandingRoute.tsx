import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBusinessRole } from '@/lib/auth/businessRole';
import { HomePage } from '@/pages/HomePage';

// CAR-116: a CASHIER's landing page is redemption, not the dashboard they
// have no other use for. OWNER and MANAGER keep the real HomePage.
export function LandingRoute() {
  const { user } = useAuth();
  const role = normalizeBusinessRole(user?.businessMembershipRole);
  if (role === 'CASHIER') return <Navigate to="/redemption" replace />;
  return <HomePage />;
}
