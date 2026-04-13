import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const USERS = [
  { name: 'דניאל כהן',   email: 'daniel@carma.app',  city: 'תל אביב',    age: 22, licenseYear: 2021 },
  { name: 'מאיה לוי',    email: 'maya@carma.app',    city: 'חיפה',       age: 20, licenseYear: 2022 },
  { name: 'יוסי ישראלי', email: 'yossi@carma.app',   city: 'ירושלים',    age: 24, licenseYear: 2019 },
  { name: 'נועה שפירא',  email: 'noa@carma.app',     city: 'רמת גן',     age: 21, licenseYear: 2021 },
  { name: 'עמית גולן',   email: 'amit@carma.app',    city: 'באר שבע',    age: 23, licenseYear: 2020 },
  { name: 'רותם אברהם',  email: 'rotem@carma.app',   city: 'פתח תקווה',  age: 19, licenseYear: 2023 },
  { name: 'שירה מזרחי',  email: 'shira@carma.app',   city: 'ראשון לציון', age: 25, licenseYear: 2018 },
  { name: 'תומר בן דוד', email: 'tomer@carma.app',   city: 'נתניה',      age: 22, licenseYear: 2021 },
  { name: 'ליאת פרץ',    email: 'liat@carma.app',    city: 'אשדוד',      age: 20, licenseYear: 2022 },
  { name: 'אור כץ',      email: 'or@carma.app',      city: 'הרצליה',     age: 26, licenseYear: 2017 },
]

const REWARDS = [
  // Fuel
  { title: '10% הנחה בדלק', titleEn: '10% Fuel Discount', description: 'הנחה של 10% על מילוי בנזין בתחנות פז', descriptionEn: '10% discount on fuel at Paz stations', business: 'פז דלק', category: 'fuel', pointsCost: 200, imageEmoji: '⛽' },
  { title: 'שוברית 50₪ לדלק', titleEn: '₪50 Fuel Voucher', description: 'שובר בשווי 50 שקל לתחנות דלק סונול', descriptionEn: '₪50 voucher for Sonol fuel stations', business: 'סונול', category: 'fuel', pointsCost: 350, imageEmoji: '⛽' },
  { title: 'מנוי שטיפת רכב חודשי', titleEn: 'Monthly Car Wash', description: 'מנוי לשטיפת רכב אוטומטית למשך חודש', descriptionEn: 'Monthly automatic car wash subscription', business: 'ספארק', category: 'fuel', pointsCost: 500, imageEmoji: '🚗' },

  // Food
  { title: 'קפה גדול חינם', titleEn: 'Free Large Coffee', description: 'כוס קפה גדולה חינם בכל סניפי קפה גרג', descriptionEn: 'Free large coffee at any Cafe Greg branch', business: 'קפה גרג', category: 'food', pointsCost: 100, imageEmoji: '☕' },
  { title: 'ארוחת בוקר ל-2', titleEn: 'Breakfast for 2', description: 'ארוחת בוקר לשניים בשווי עד 120₪', descriptionEn: 'Breakfast for two up to ₪120', business: 'אנדרומדה', category: 'food', pointsCost: 400, imageEmoji: '🍳' },
  { title: '20% הנחה בפיצה', titleEn: '20% Pizza Discount', description: '20% הנחה על הזמנה בדומינוז פיצה', descriptionEn: '20% off at Domino\'s Pizza', business: "דומינו'ס", category: 'food', pointsCost: 150, imageEmoji: '🍕' },

  // Eco
  { title: 'שעה חינם בקורקינט חשמלי', titleEn: '1 Hour Free E-Scooter', description: 'שעה אחת חינם בשירות קורקינטים חשמליים', descriptionEn: 'One free hour on electric scooters', business: 'בירד', category: 'eco', pointsCost: 120, imageEmoji: '🛴' },
  { title: 'נסיעה חינם בחשמלית', titleEn: 'Free Tram Ride', description: 'נסיעה חינם ברכבת הקלה בתל אביב', descriptionEn: 'Free light rail ride in Tel Aviv', business: 'דן', category: 'eco', pointsCost: 80, imageEmoji: '🚊' },
  { title: 'שובר 200₪ לאופניים חשמליים', titleEn: '₪200 E-Bike Voucher', description: 'שובר בשווי 200₪ ברכישת אופניים חשמליים', descriptionEn: '₪200 voucher for electric bike purchase', business: 'אקו-רכב', category: 'eco', pointsCost: 800, imageEmoji: '🚲' },

  // Entertainment
  { title: '2 כרטיסים לקולנוע', titleEn: '2 Cinema Tickets', description: 'שני כרטיסים לכל סרט ברשת Yes Planet', descriptionEn: 'Two tickets to any movie at Yes Planet', business: 'Yes Planet', category: 'entertainment', pointsCost: 300, imageEmoji: '🎬' },
  { title: 'כניסה לפארק מים', titleEn: 'Water Park Entry', description: 'כרטיס כניסה לפארק מים לאאוטדור', descriptionEn: 'Entry ticket to outdoor water park', business: 'לונה פארק', category: 'entertainment', pointsCost: 450, imageEmoji: '🌊' },
  { title: 'מנוי ספוטיפיי חודש', titleEn: '1 Month Spotify', description: 'מנוי פרימיום לספוטיפיי למשך חודש', descriptionEn: 'One month Spotify Premium subscription', business: 'Spotify', category: 'entertainment', pointsCost: 180, imageEmoji: '🎵' },

  // Shopping
  { title: '10% הנחה בדרייב', titleEn: '10% Off at Drive', description: '10% הנחה על כל קנייה בחנויות דרייב', descriptionEn: '10% off all purchases at Drive stores', business: 'דרייב', category: 'shopping', pointsCost: 200, imageEmoji: '🛒' },
  { title: 'שובר 100₪ לאמזון', titleEn: '₪100 Amazon Voucher', description: 'שובר קנייה בשווי 100₪ באמזון ישראל', descriptionEn: '₪100 Amazon Israel gift card', business: 'Amazon', category: 'shopping', pointsCost: 350, imageEmoji: '📦' },
  { title: 'בדיקת רכב חינם', titleEn: 'Free Car Inspection', description: 'בדיקת רכב מקצועית ללא עלות', descriptionEn: 'Professional car inspection at no cost', business: 'מנהיגים', category: 'shopping', pointsCost: 600, imageEmoji: '🔧' },
  { title: '30₪ בקצרין', titleEn: '₪30 at Katzrin', description: '30 שקל לקניה בחנות קצרין', descriptionEn: '₪30 to spend at Katzrin store', business: 'קצרין', category: 'shopping', pointsCost: 120, imageEmoji: '🏪' },
  { title: 'הנחה 15% בMacabi', titleEn: '15% Off Maccabi', description: '15% הנחה על ביגוד ספורט במכבי', descriptionEn: '15% off sportswear at Maccabi', business: 'מכבי ספורט', category: 'shopping', pointsCost: 250, imageEmoji: '👟' },
  { title: 'שובר 75₪ בWolt', titleEn: '₪75 Wolt Voucher', description: 'שובר משלוח אוכל בשווי 75₪', descriptionEn: '₪75 food delivery voucher', business: 'Wolt', category: 'food', pointsCost: 280, imageEmoji: '🛵' },
]

const ACHIEVEMENTS = [
  { key: 'first_trip',      title: 'נסיעה ראשונה',      titleEn: 'First Trip',         description: 'השלמת את הנסיעה הראשונה שלך',       descriptionEn: 'Completed your first trip',           emoji: '🚗', pointsBonus: 50,  condition: '{"trips":1}' },
  { key: 'perfect_score',   title: 'ציון מושלם',         titleEn: 'Perfect Score',      description: 'קיבלת 100 נקודות בנסיעה אחת',        descriptionEn: 'Got 100 points in a single trip',    emoji: '⭐', pointsBonus: 100, condition: '{"score":100}' },
  { key: 'night_owl',       title: 'ינשוף הלילה',        titleEn: 'Night Owl',          description: 'נסעת ללא אירועים בשעות הסיכון',       descriptionEn: 'Drove safely during risk hours',      emoji: '🦉', pointsBonus: 75,  condition: '{"risk_hour_trip":true}' },
  { key: 'week_streak',     title: 'שבוע רצוף',          titleEn: 'Week Streak',        description: 'נסעת 7 ימים רצופים',                   descriptionEn: 'Drove 7 consecutive days',            emoji: '🔥', pointsBonus: 150, condition: '{"streak_days":7}' },
  { key: 'distance_100',    title: 'מאה קילומטר',        titleEn: '100 Kilometers',     description: 'נסעת 100 ק"מ עם CARMA',                descriptionEn: 'Drove 100 km with CARMA',             emoji: '📍', pointsBonus: 200, condition: '{"total_km":100}' },
  { key: 'no_phone',        title: 'מכשיר מורד',         titleEn: 'Phone Down',         description: '10 נסיעות ללא נגיעה בטלפון',          descriptionEn: '10 trips without touching phone',    emoji: '📵', pointsBonus: 120, condition: '{"phone_free_trips":10}' },
  { key: 'smooth_operator', title: 'נהיגה חלקה',         titleEn: 'Smooth Operator',    description: '5 נסיעות ברצף ללא בלימות חדות',       descriptionEn: '5 trips in a row without hard brakes', emoji: '😎', pointsBonus: 100, condition: '{"no_brake_streak":5}' },
  { key: 'early_bird',      title: 'ציפור מוקדמת',       titleEn: 'Early Bird',         description: '5 נסיעות בשעות הבוקר המוקדמות',       descriptionEn: '5 trips in early morning hours',     emoji: '🌅', pointsBonus: 60,  condition: '{"morning_trips":5}' },
  { key: 'level_5',         title: 'אלוף מחצית',         titleEn: 'Halfway Champion',   description: 'הגעת לרמה 5',                          descriptionEn: 'Reached level 5',                    emoji: '🏆', pointsBonus: 300, condition: '{"level":5}' },
  { key: 'level_10',        title: 'נהג מדגם',           titleEn: 'Model Driver',       description: 'הגעת לרמה המקסימלית - רמה 10',        descriptionEn: 'Reached max level 10',               emoji: '👑', pointsBonus: 1000, condition: '{"level":10}' },
]

async function main() {
  console.log('🌱 Seeding database...')

  // Clear existing data
  await prisma.leaderboardEntry.deleteMany()
  await prisma.userAchievement.deleteMany()
  await prisma.notification.deleteMany()
  await prisma.friendship.deleteMany()
  await prisma.voucher.deleteMany()
  await prisma.tripEvent.deleteMany()
  await prisma.trip.deleteMany()
  await prisma.reward.deleteMany()
  await prisma.achievement.deleteMany()
  await prisma.user.deleteMany()

  // Create achievements
  const achievements = await Promise.all(
    ACHIEVEMENTS.map(a => prisma.achievement.create({ data: a }))
  )
  console.log(`✅ Created ${achievements.length} achievements`)

  // Create rewards
  const rewards = await Promise.all(
    REWARDS.map(r => prisma.reward.create({ data: r }))
  )
  console.log(`✅ Created ${rewards.length} rewards`)

  // Create users with password hash
  const passwordHash = await bcrypt.hash('password123', 10)
  const users = await Promise.all(
    USERS.map((u, i) =>
      prisma.user.create({
        data: {
          ...u,
          passwordHash,
          totalPoints: Math.floor(Math.random() * 2000) + 200,
          totalDistance: Math.round((Math.random() * 500 + 50) * 10) / 10,
          level: Math.floor(Math.random() * 5) + 1,
        },
      })
    )
  )
  console.log(`✅ Created ${users.length} users`)

  // Create friendships (first user friends with everyone)
  const mainUser = users[0]
  await Promise.all(
    users.slice(1, 5).map(friend =>
      prisma.friendship.createMany({
        data: [
          { userId: mainUser.id, friendId: friend.id },
          { userId: friend.id, friendId: mainUser.id },
        ],
      })
    )
  )
  console.log('✅ Created friendships')

  // Create trips for each user
  const now = new Date()
  const tripData: Array<{ userId: string; tripIndex: number }> = []
  users.forEach(user => {
    for (let i = 0; i < 6; i++) {
      tripData.push({ userId: user.id, tripIndex: i })
    }
  })

  for (const { userId, tripIndex } of tripData) {
    const daysAgo = tripIndex * 3 + Math.floor(Math.random() * 3)
    const startTime = new Date(now.getTime() - daysAgo * 24 * 3600 * 1000)
    const durationSeconds = Math.floor(Math.random() * 2400) + 600 // 10-50 min
    const endTime = new Date(startTime.getTime() + durationSeconds * 1000)
    const distanceKm = Math.round((durationSeconds / 60) * 0.5 * 10) / 10

    const hardBrakes = Math.floor(Math.random() * 5)
    const aggressiveAccels = Math.floor(Math.random() * 4)
    const sharpTurns = Math.floor(Math.random() * 6)
    const phoneSeconds = Math.floor(Math.random() * 60)

    const penalties = hardBrakes * 5 + aggressiveAccels * 3 + sharpTurns * 2 + (phoneSeconds / durationSeconds) * 40
    const score = Math.max(0, Math.min(100, 100 - penalties))
    const distanceFactor = Math.log(distanceKm + 1) / Math.log(11)
    const points = score * distanceFactor

    const isRiskHour = startTime.getHours() >= 23 || startTime.getHours() < 4
    const isWeekend = startTime.getDay() === 4 || startTime.getDay() === 5
    const riskMultiplier = isWeekend && isRiskHour ? 2.0 : isRiskHour ? 1.5 : 1.0

    const locations = ['תל אביב', 'ירושלים', 'חיפה', 'רמת גן', 'פתח תקווה', 'הרצליה', 'נתניה', 'אשדוד']
    const startLocation = locations[Math.floor(Math.random() * locations.length)]
    const endLocation = locations[Math.floor(Math.random() * locations.length)]

    const insights = [
      'נסיעה מצוינת! המשך כך.',
      'שים לב לבלימות - נסה להשאיר מרווח גדול יותר.',
      'נסיעה חלקה ובטוחה. כל הכבוד!',
      'הפחתת השימוש בטלפון ישפר את הציון שלך.',
      'נסיעת לילה בטוחה - מדהים!',
      'האצה חדה מורידה ציון - נסה להגביר בהדרגה.',
    ]

    await prisma.trip.create({
      data: {
        userId,
        startTime,
        endTime,
        distanceKm,
        durationSeconds,
        score: Math.round(score * 10) / 10,
        points: Math.round(points * riskMultiplier * 10) / 10,
        hardBrakes,
        aggressiveAccels,
        sharpTurns,
        phoneSeconds,
        riskMultiplier,
        startLocation,
        endLocation,
        aiInsight: insights[Math.floor(Math.random() * insights.length)],
        status: 'completed',
      },
    })
  }
  console.log(`✅ Created ${tripData.length} trips`)

  // Give some achievements to users
  const achievementKeys = ['first_trip', 'no_phone', 'early_bird']
  for (const user of users.slice(0, 5)) {
    for (const key of achievementKeys.slice(0, Math.floor(Math.random() * 3) + 1)) {
      const ach = achievements.find(a => a.key === key)
      if (ach) {
        await prisma.userAchievement.create({
          data: { userId: user.id, achievementId: ach.id },
        }).catch(() => {}) // ignore duplicates
      }
    }
  }
  console.log('✅ Created user achievements')

  // Create leaderboard entries
  const sortedByPoints = [...users].sort((a, b) => b.totalPoints - a.totalPoints)
  for (let i = 0; i < sortedByPoints.length; i++) {
    await prisma.leaderboardEntry.create({
      data: {
        userId: sortedByPoints[i].id,
        type: 'national',
        rank: i + 1,
        score: sortedByPoints[i].totalPoints,
        period: 'alltime',
      },
    })
    await prisma.leaderboardEntry.create({
      data: {
        userId: sortedByPoints[i].id,
        type: 'city',
        rank: i + 1,
        score: sortedByPoints[i].totalPoints,
        period: 'alltime',
      },
    })
  }
  console.log('✅ Created leaderboard entries')

  // Create notifications for first user
  const notifData = [
    { type: 'trip_complete', titleHe: 'נסיעה הושלמה!', titleEn: 'Trip Complete!', bodyHe: 'קיבלת 87 נקודות על נסיעת הלילה שלך.', bodyEn: 'You earned 87 points for your night drive.' },
    { type: 'achievement',   titleHe: 'הישג חדש!',      titleEn: 'New Achievement!', bodyHe: 'קיבלת את תג "נסיעה ראשונה" 🚗',        bodyEn: 'You earned the "First Trip" badge 🚗' },
    { type: 'reward',        titleHe: 'מבצע מיוחד',     titleEn: 'Special Offer',    bodyHe: 'שובר קפה גרג חדש זמין עבורך!',          bodyEn: 'New Cafe Greg voucher available for you!' },
  ]
  for (const notif of notifData) {
    await prisma.notification.create({ data: { userId: mainUser.id, ...notif } })
  }
  console.log('✅ Created notifications')

  console.log('\n🎉 Seeding complete!')
  console.log('📧 Test login: daniel@carma.app / password123')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
