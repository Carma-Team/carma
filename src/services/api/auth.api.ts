import { request } from './client';

export const authApi = {
  login: (email: string, password: string) =>
    request<any>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    }),

  register: (userData: any) =>
    request<any>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData)
    }),

  me: () => request<any>('/api/auth/me'),
};
