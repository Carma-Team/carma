/**
 * ─── Design Tokens (Centralized Theme) ───────────────────────────────────────
 * שינוי כאן ישפיע על כל האפליקציה: צבעים, ריווחים וטיפוגרפיה.
 */
export const COLORS = {
  dark:       '#0a0f1e', // רקע ראשי
  card:       '#111827', // רקע כרטיסים/אלמנטים
  border:     '#1f2937', // גבולות
  brand:      '#6366f1', // צבע מותג ראשי
  brandLight: '#818cf8', // צבע מותג בהיר (לטקסט דגש)
  text:       '#ffffff', // טקסט ראשי
  textMuted:  '#94a3b8', // טקסט משני/עמום
  success:    '#22c55e',
  warning:    '#f59e0b',
  danger:     '#ef4444',
}

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
}

export const TYPOGRAPHY = {
  h1: { fontSize: 32, fontWeight: '900' as const, color: COLORS.text },
  h2: { fontSize: 24, fontWeight: '800' as const, color: COLORS.text },
  h3: { fontSize: 18, fontWeight: '700' as const, color: COLORS.text },
  body: { fontSize: 16, color: COLORS.text },
  caption: { fontSize: 13, color: COLORS.textMuted },
  label: { fontSize: 14, fontWeight: '600' as const, color: COLORS.textMuted },
}

export const COMMON_STYLES = {
  screen: {
    flex: 1,
    backgroundColor: COLORS.dark,
  },
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: 100,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
  },
  // תבניות פריסה נפוצות לחיסכון בקוד מקומי
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  rowBetween: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  center: {
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center' as const,
    padding: 24,
  },
  section: {
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h3,
    marginBottom: SPACING.sm,
  },
  // סגנון אחיד לכרטיסי סטטיסטיקה (בשימוש ברוב המסכים)
  statGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: SPACING.sm,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    alignItems: 'center' as const,
    padding: SPACING.md,
    minHeight: 110,
    justifyContent: 'center' as const,
  },
  statEmoji: {
    fontSize: 32,
    marginBottom: 6,
  },
  statValue: {
    ...TYPOGRAPHY.h3,
    fontSize: 20,
    color: '#fff',
  },
  statLabel: {
    ...TYPOGRAPHY.caption,
    fontSize: 12,
    marginTop: 2,
    textAlign: 'center' as const,
    opacity: 0.8,
  },
  // סגנון למצבי "אין נתונים"
  emptyState: {
    alignItems: 'center' as const,
    paddingVertical: SPACING.xl,
    gap: SPACING.sm,
  },
  emptyIcon: {
    fontSize: 40,
  },
  emptyText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textMuted,
    fontSize: 14,
    textAlign: 'center' as const,
  },
  // טאבים (Leaderboard, Marketplace, Profile)
  tabsContainer: {
    flexDirection: 'row' as const,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 4,
    gap: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 9,
    alignItems: 'center' as const,
  },
  tabActive: {
    backgroundColor: COLORS.brand,
  },
  tabText: {
    ...TYPOGRAPHY.label,
    fontSize: 13,
  },
  tabTextActive: {
    color: '#fff',
  }
}
