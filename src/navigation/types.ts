// Navigation param-list types
export type RootStackParamList = {
  Login:    undefined
  Register: undefined
  Main:     undefined
  TripDetail: { tripId: string }
}

export type MainTabParamList = {
  Dashboard:   undefined
  Trip:        undefined
  Roadmap:     undefined
  Marketplace: undefined
  Leaderboard: undefined
  Profile:     undefined
}
