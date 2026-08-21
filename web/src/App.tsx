import { RouterProvider } from 'react-router-dom';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { router } from '@/routes/router';

export function App() {
  return (
    <LanguageProvider>
      <RouterProvider router={router} />
    </LanguageProvider>
  );
}

export default App;
