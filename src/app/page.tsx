import { redirect } from 'next/navigation'
import { getAuthUser } from '@/lib/auth'

export default function RootPage() {
  const auth = getAuthUser()
  if (auth) {
    redirect('/dashboard')
  } else {
    redirect('/login')
  }
}
