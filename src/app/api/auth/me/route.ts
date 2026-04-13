import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getAuthUser, userToPublic, clearAuthCookie } from '@/lib/auth'

export async function GET() {
  try {
    const auth = getAuthUser()
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({ where: { id: auth.userId } })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const unreadCount = await prisma.notification.count({
      where: { userId: user.id, isRead: false },
    })

    return NextResponse.json({
      user: { ...userToPublic(user), unreadNotifications: unreadCount },
    })
  } catch (error) {
    console.error('Me error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE() {
  clearAuthCookie()
  return NextResponse.json({ message: 'Logged out' })
}
