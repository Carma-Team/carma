/**
 * ─── Design Tokens (Centralized Theme) ───────────────────────────────────────
 * Changes here propagate app-wide: colors, spacing, and typography.
 */
import type { ViewStyle } from 'react-native';

export const COLORS = {
  dark:       '#ffffff', // primary background — white
  card:       '#f1f5f9', // card / element background
  border:     '#e2e8f0', // borders
  brand:      '#6366f1', // primary brand color
  brandLight: '#4338ca', // dark brand (emphasis text on light background)
  text:       '#0f172a', // primary text — near-black blue
  textMuted:  '#64748b', // secondary / muted text
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
  // Common layout helpers shared across screens
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
  // Shared stat card style used across most screens
  statGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: SPACING.sm,
  },
  statCard: {
    flex: 1,
    minWidth: '45%' as ViewStyle['minWidth'],
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
    color: COLORS.text,
  },
  statLabel: {
    ...TYPOGRAPHY.caption,
    fontSize: 12,
    marginTop: 2,
    textAlign: 'center' as const,
    opacity: 0.8,
  },
  // Empty-state style (no data)
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
  // Segmented tab control (Leaderboard, Marketplace, Profile)
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
  },
  // ─── Screen header with back button ─────────────────────────────────────────
  screenHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  screenHeaderTitle: {
    ...TYPOGRAPHY.h2,
    flex: 1,
    textAlign: 'auto' as const,
  },
  screenHeaderBackBtn: {
    marginEnd: 15,
  },
  // ─── Text input field ────────────────────────────────────────────────────────
  input: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: COLORS.text,
    fontSize: 15,
  },
  // ─── Error box ───────────────────────────────────────────────────────────────
  errorBox: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
  },
  errorText: {
    color: COLORS.danger,
    fontSize: 13,
    textAlign: 'center' as const,
  },
  // ─── Notice row (icon + muted line inside a summary) ────────────────────────
  // Every informational strip a trip summary shows. One block, so changing how a
  // notice looks changes all of them — they were separate copies before, and had
  // already started to drift apart.
  noticeRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    alignSelf: 'stretch' as const,
    marginTop: SPACING.md,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  noticeText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    fontSize: 12,
    flex: 1,
  },

  // ─── Category label row (icon + muted text above a Card) ────────────────────
  sectionLabelRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    marginBottom: 8,
    marginStart: 4,
  },
  sectionLabel: {
    ...TYPOGRAPHY.label,
    color: COLORS.textMuted,
  },
}
