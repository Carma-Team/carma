import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

export async function GET(request: Request) {
  try {
    const auth = getAuthUser()
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category')

    const where = {
      isActive: true,
      stock: { gt: 0 },
      ...(category && category !== 'all' ? { category } : {}),
    }

    const rewards = await prisma.reward.findMany({
      where,
      orderBy: { pointsCost: 'asc' },
    })

    // Get user's vouchers
    const vouchers = await prisma.voucher.findMany({
      where: { userId: auth.userId },
      include: { reward: true },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ rewards, vouchers })
  } catch (error) {
    console.error('Get rewards error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
