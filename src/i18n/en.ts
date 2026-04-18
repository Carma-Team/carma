const en = {
  app:   { name: 'CARMA', tagline: 'Drive smart. Earn rewards.' },
  nav: {
    dashboard: 'Home', trip: 'Trip', roadmap: 'Roadmap',
    marketplace: 'Store', leaderboard: 'Rank', profile: 'Profile',
  },
  auth: {
    login: 'Login', register: 'Register', logout: 'Logout',
    email: 'Email', password: 'Password', name: 'Full Name',
    phone: 'Phone', city: 'City', age: 'Age', licenseYear: 'License Year',
    noAccount: "Don't have an account?", hasAccount: 'Already have an account?',
    loginBtn: 'Sign In', registerBtn: 'Create Account', guestLoginBtn: 'Guest Login (Dev)',
    emailPlaceholder: 'your@email.com', passwordPlaceholder: '••••••••',
    namePlaceholder: 'John Doe',
    errors: {
      emailRequired: 'Please enter your email', passwordRequired: 'Please enter your password',
      nameRequired: 'Please enter your name', invalidEmail: 'Invalid email address',
      passwordTooShort: 'Password too short (min 6 characters)',
      emailExists: 'Email already registered', invalidCredentials: 'Invalid email or password',
    },
  },
  dashboard: {
    welcome: 'Hello', yourScore: 'Your Score', startTrip: 'Start Trip',
    noTrips: 'No trips yet', noTripsDesc: 'Start your first trip!',
    recentTrips: 'Recent Trips', viewAll: 'View All',
    totalDistance: 'Total Distance', totalTrips: 'Trips',
    avgScore: 'Avg Score', pointsToNextLevel: 'Points to next level',
  },
  trip: {
    active: 'Active Trip', start: 'Start Trip', end: 'End Trip',
    duration: 'Duration', distance: 'Distance', score: 'Score', events: 'Events',
    hardBrakes: 'Hard Brakes', aggressiveAccels: 'Aggressive Accels',
    sharpTurns: 'Sharp Turns', phoneTouches: 'Phone Touches',
    status: { excellent: 'Excellent!', good: 'Good', fair: 'Fair', poor: 'Improve' },
    trafficLight: { green: 'Great driving!', yellow: 'Pay attention', red: 'Dangerous driving' },
    riskHourBonus: 'Risk Hour Bonus', riskMultiplier: 'Risk Multiplier',
    aiInsight: 'AI Insight', summary: 'Trip Summary',
    pointsEarned: 'Points Earned', simulationNote: 'Simulation mode active',
  },
  roadmap: {
    title: 'Progress Roadmap', subtitle: 'Your path to Model Driver',
    currentLevel: 'Current Level', nextLevel: 'Next Level', progress: 'Progress',
    perks: 'Perks', locked: 'Locked', unlocked: 'Unlocked',
    pointsNeeded: 'Points needed', completed: 'Completed',
  },
  marketplace: {
    title: 'Rewards Store', subtitle: 'Redeem your points',
    myVouchers: 'My Vouchers', allRewards: 'All Rewards', points: 'points',
    redeem: 'Redeem', redeemSuccess: 'Reward redeemed successfully!',
    notEnoughPoints: 'Not enough points', outOfStock: 'Out of stock', expires: 'Expires',
    categories: { all: 'All', fuel: 'Fuel', food: 'Food', eco: 'Eco', entertainment: 'Entertainment', shopping: 'Shopping' },
    voucher: { title: 'Your Voucher', code: 'Code', scanQR: 'Scan QR', expiry: 'Expires', used: 'Used', active: 'Active' },
    bonusDilemma: {
      title: 'Choose your reward!', invest: 'Save points', investDesc: 'Save for a bigger reward',
      redeem: 'Redeem now', redeemDesc: 'Get an instant reward', cancel: 'Cancel',
    },
  },
  leaderboard: {
    title: 'Leaderboard', friends: 'Friends', city: 'City', national: 'National',
    rank: 'Rank', player: 'Player', score: 'Score', you: 'You',
    noFriends: 'No friends yet',
  },
  profile: {
    title: 'My Profile', stats: 'Stats', achievements: 'Achievements',
    tripHistory: 'Trip History', settings: 'Settings', language: 'Language',
    totalDistance: 'km', avgScore: 'Avg Score', safeTrips: 'Safe Trips',
    level: 'Level', joined: 'Joined', phone: 'Phone', city: 'City', age: 'Age',
    licenseYear: 'Licensed', noTrips: 'No trips yet', totalDistance2: 'Total Distance',
  },
  stats: {
    scoreHistory: 'Score History', totalDistance: 'Total Distance',
    totalTrips: 'Total Trips', avgScore: 'Avg Score', safeTrips: 'Safe Trips',
    totalPoints: 'Points Earned', totalDuration: 'Drive Time', noData: 'No data yet',
  },
  common: {
    loading: 'Loading...', error: 'Error', retry: 'Retry', cancel: 'Cancel',
    confirm: 'Confirm', close: 'Close', save: 'Save', back: 'Back', next: 'Next',
    done: 'Done', points: 'points', level: 'Level', score: 'Score', noData: 'No data',
    seeAll: 'See All',
  },
} as const

export default en
