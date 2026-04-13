import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'
import { nanoid } from 'nanoid'
import QRCode from 'qrcode'

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const auth = getAuthUser()
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const reward = await prisma.reward.findUnique({ where: { id: params.id } })
    if (!reward || !reward.isActive) {
      return NextResponse.json({ error: 'Reward not found or inactive' }, { status: 404 })
    }
    if (reward.stock <= 0) {
      return NextResponse.json({ error: 'Out of stock' }, { status: 409 })
    }

    const user = await prisma.user.findUnique({ where: { id: auth.userId } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    if (user.totalPoints < reward.pointsCost) {
      return NextResponse.json({ error: 'Not enough points' }, { status: 402 })
    }

    // Generate voucher
    const code = nanoid(12).toUpperCase()
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) // 90 days

    const qrPayload = JSON.stringify({
      code,
      business: reward.business,
      title: reward.title,
      expiresAt: expiresAt.toISOString(),
    })
    const qrData = await QRCode.toDataURL(qrPayload, { width: 256, margin: 1 })

    const [voucher] = await prisma.$transaction([
      prisma.voucher.create({
        data: {
          userId: auth.userId,
          rewardId: reward.id,
          code,
          qrData,
          expiresAt,
        },
        include: { reward: true },
      }),
      prisma.user.update({
        where: { id: auth.userId },
        data: { totalPoints: { decrement: reward.pointsCost } },
      }),
      prisma.reward.update({
        where: { id: reward.id },
        data: { stock: { decrement: 1 } },
      }),
    ])

    // Notification
    await prisma.notification.create({
      data: {
        userId: auth.userId,
        type: 'reward',
        titleHe: 'פרס מומש!',
        titleEn: 'Reward Redeemed!',
        bodyHe: `מימשת את "${reward.title}" בהצלחה.`,
        bodyEn: `You redeemed "${reward.titleEn || reward.title}" successfully.`,
        data: JSON.stringify({ voucherId: voucher.id }),
      },
    })

    return NextResponse.json({ voucher }, { status: 201 })
  } catch (error) {
    console.error('Redeem error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
