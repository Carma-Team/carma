/**
 * @fileoverview Curated icon catalog for a reward's `imageIcon`
 * @module lib/rewardIcons
 *
 * @description
 * `imageIcon` (server/app/models/reward.py) is stored as an Ionicons name —
 * `mobile/src/components/marketplace/RewardCard.tsx`'s voucher modal renders
 * it directly via `<Ionicons name={reward.imageIcon}>`. `value` below is
 * always a real Ionicons name for that reason, even though the web picker
 * renders it with lucide-react (there is no Ionicons build for the web, and
 * the business portal has no icon library today — see the root CLAUDE.md's
 * "prefer an icon library already used" note, which this repo has none of).
 * A handful of values repeat across entries where Ionicons has no dedicated
 * glyph for two related concepts (e.g. dessert/ice cream) — harmless, since
 * each entry is still its own labeled, selectable option.
 */
import {
  Coffee,
  Martini,
  Beer,
  Pizza,
  Sandwich,
  Apple,
  UtensilsCrossed,
  IceCreamCone,
  Cake,
  Salad,
  ShoppingBag,
  ShoppingCart,
  Gift,
  Shirt,
  Footprints,
  Smartphone,
  Gem,
  Sparkles,
  BookOpen,
  Car,
  Droplets,
  Fuel,
  BatteryCharging,
  MapPin,
  Gauge,
  Bike,
  Sofa,
  Home,
  Palette,
  ChefHat,
  Flower2,
  Film,
  Music,
  Gamepad2,
  Ticket,
  Goal,
  Dumbbell,
  Plane,
  BedDouble,
  Flower,
  Scissors,
  Sparkle,
  Hand,
  Pill,
  PawPrint,
  Wrench,
  SprayCan,
  Truck,
  GraduationCap,
  Percent,
  Tag,
  Star,
  Heart,
  Medal,
  type LucideIcon,
} from 'lucide-react';

export type RewardIconGroup = 'foodDrink' | 'retail' | 'automotive' | 'home' | 'entertainment' | 'lifestyle' | 'generic';

export const REWARD_ICON_GROUPS: RewardIconGroup[] = [
  'foodDrink',
  'retail',
  'automotive',
  'home',
  'entertainment',
  'lifestyle',
  'generic',
];

export type RewardIconOption = {
  // Persisted verbatim as Reward.imageIcon.
  value: string;
  Icon: LucideIcon;
  group: RewardIconGroup;
  labelHe: string;
  labelEn: string;
};

// Matches the model column default (server/app/models/reward.py) and
// mobile's CATEGORY_CONFIG.other fallback — the one icon a reward with no
// explicit choice, or an unrecognized legacy value, ever falls back to.
export const DEFAULT_REWARD_ICON = 'gift-outline';

export const REWARD_ICON_OPTIONS: RewardIconOption[] = [
  // ── Food & drink ─────────────────────────────────────────────────────────
  { value: 'cafe-outline', Icon: Coffee, group: 'foodDrink', labelHe: 'קפה', labelEn: 'Coffee' },
  { value: 'wine-outline', Icon: Martini, group: 'foodDrink', labelHe: 'קוקטייל', labelEn: 'Cocktail' },
  { value: 'beer-outline', Icon: Beer, group: 'foodDrink', labelHe: 'שתייה', labelEn: 'Drink' },
  { value: 'pizza-outline', Icon: Pizza, group: 'foodDrink', labelHe: 'פיצה', labelEn: 'Pizza' },
  { value: 'fast-food-outline', Icon: Sandwich, group: 'foodDrink', labelHe: 'המבורגר', labelEn: 'Burger' },
  { value: 'nutrition-outline', Icon: Apple, group: 'foodDrink', labelHe: 'אוכל', labelEn: 'Food' },
  { value: 'restaurant-outline', Icon: UtensilsCrossed, group: 'foodDrink', labelHe: 'מסעדה', labelEn: 'Restaurant' },
  { value: 'ice-cream-outline', Icon: IceCreamCone, group: 'foodDrink', labelHe: 'קינוח', labelEn: 'Dessert' },
  { value: 'ice-cream-outline', Icon: IceCreamCone, group: 'foodDrink', labelHe: 'גלידה', labelEn: 'Ice cream' },
  { value: 'basket-outline', Icon: Cake, group: 'foodDrink', labelHe: 'מאפייה', labelEn: 'Bakery' },
  { value: 'leaf-outline', Icon: Salad, group: 'foodDrink', labelHe: 'אוכל בריא', labelEn: 'Healthy food' },

  // ── Retail ───────────────────────────────────────────────────────────────
  { value: 'bag-outline', Icon: ShoppingBag, group: 'retail', labelHe: 'שקית קניות', labelEn: 'Shopping bag' },
  { value: 'cart-outline', Icon: ShoppingCart, group: 'retail', labelHe: 'עגלת קניות', labelEn: 'Shopping cart' },
  { value: 'gift-outline', Icon: Gift, group: 'retail', labelHe: 'מתנה', labelEn: 'Gift' },
  { value: 'shirt-outline', Icon: Shirt, group: 'retail', labelHe: 'ביגוד', labelEn: 'Clothing' },
  { value: 'footsteps-outline', Icon: Footprints, group: 'retail', labelHe: 'נעליים', labelEn: 'Shoes' },
  { value: 'phone-portrait-outline', Icon: Smartphone, group: 'retail', labelHe: 'אלקטרוניקה', labelEn: 'Electronics' },
  { value: 'diamond-outline', Icon: Gem, group: 'retail', labelHe: 'תכשיטים', labelEn: 'Jewelry' },
  { value: 'sparkles-outline', Icon: Sparkles, group: 'retail', labelHe: 'קוסמטיקה', labelEn: 'Cosmetics' },
  { value: 'book-outline', Icon: BookOpen, group: 'retail', labelHe: 'ספרים', labelEn: 'Books' },

  // ── Automotive ───────────────────────────────────────────────────────────
  { value: 'car-outline', Icon: Car, group: 'automotive', labelHe: 'רכב', labelEn: 'Car' },
  { value: 'water-outline', Icon: Droplets, group: 'automotive', labelHe: 'שטיפת רכב', labelEn: 'Car wash' },
  { value: 'flame-outline', Icon: Fuel, group: 'automotive', labelHe: 'דלק', labelEn: 'Fuel' },
  { value: 'battery-charging-outline', Icon: BatteryCharging, group: 'automotive', labelHe: 'טעינת רכב חשמלי', labelEn: 'EV charging' },
  { value: 'location-outline', Icon: MapPin, group: 'automotive', labelHe: 'חניה', labelEn: 'Parking' },
  { value: 'speedometer-outline', Icon: Gauge, group: 'automotive', labelHe: 'אופנוע', labelEn: 'Motorcycle' },
  { value: 'bicycle-outline', Icon: Bike, group: 'automotive', labelHe: 'אופניים', labelEn: 'Bicycle' },

  // ── Home ─────────────────────────────────────────────────────────────────
  { value: 'cube-outline', Icon: Sofa, group: 'home', labelHe: 'ריהוט', labelEn: 'Furniture' },
  { value: 'home-outline', Icon: Home, group: 'home', labelHe: 'בית', labelEn: 'Home' },
  { value: 'color-palette-outline', Icon: Palette, group: 'home', labelHe: 'עיצוב הבית', labelEn: 'Home decor' },
  { value: 'restaurant-outline', Icon: ChefHat, group: 'home', labelHe: 'מטבח', labelEn: 'Kitchen' },
  { value: 'leaf-outline', Icon: Flower2, group: 'home', labelHe: 'גינה', labelEn: 'Garden' },

  // ── Entertainment ────────────────────────────────────────────────────────
  { value: 'film-outline', Icon: Film, group: 'entertainment', labelHe: 'קולנוע', labelEn: 'Cinema' },
  { value: 'musical-notes-outline', Icon: Music, group: 'entertainment', labelHe: 'מוזיקה', labelEn: 'Music' },
  { value: 'game-controller-outline', Icon: Gamepad2, group: 'entertainment', labelHe: 'גיימינג', labelEn: 'Gaming' },
  { value: 'ticket-outline', Icon: Ticket, group: 'entertainment', labelHe: 'כרטיס לאירוע', labelEn: 'Event ticket' },
  { value: 'football-outline', Icon: Goal, group: 'entertainment', labelHe: 'ספורט', labelEn: 'Sports' },
  { value: 'barbell-outline', Icon: Dumbbell, group: 'entertainment', labelHe: 'חדר כושר', labelEn: 'Gym' },
  { value: 'airplane-outline', Icon: Plane, group: 'entertainment', labelHe: 'טיולים', labelEn: 'Travel' },
  { value: 'bed-outline', Icon: BedDouble, group: 'entertainment', labelHe: 'מלון', labelEn: 'Hotel' },

  // ── Lifestyle & services ─────────────────────────────────────────────────
  { value: 'flower-outline', Icon: Flower, group: 'lifestyle', labelHe: 'ספא', labelEn: 'Spa' },
  { value: 'cut-outline', Icon: Scissors, group: 'lifestyle', labelHe: 'מספרה', labelEn: 'Barber' },
  { value: 'sparkles-outline', Icon: Sparkle, group: 'lifestyle', labelHe: 'יופי', labelEn: 'Beauty' },
  { value: 'hand-left-outline', Icon: Hand, group: 'lifestyle', labelHe: 'עיסוי', labelEn: 'Massage' },
  { value: 'medkit-outline', Icon: Pill, group: 'lifestyle', labelHe: 'בית מרקחת', labelEn: 'Pharmacy' },
  { value: 'paw-outline', Icon: PawPrint, group: 'lifestyle', labelHe: 'חיות מחמד', labelEn: 'Pet' },
  { value: 'construct-outline', Icon: Wrench, group: 'lifestyle', labelHe: 'תיקונים', labelEn: 'Repair' },
  { value: 'water-outline', Icon: SprayCan, group: 'lifestyle', labelHe: 'ניקיון', labelEn: 'Cleaning' },
  { value: 'cube-outline', Icon: Truck, group: 'lifestyle', labelHe: 'משלוחים', labelEn: 'Delivery' },
  { value: 'school-outline', Icon: GraduationCap, group: 'lifestyle', labelHe: 'חינוך', labelEn: 'Education' },

  // ── Generic ──────────────────────────────────────────────────────────────
  { value: 'pricetag-outline', Icon: Percent, group: 'generic', labelHe: 'הנחה', labelEn: 'Discount' },
  { value: 'pricetags-outline', Icon: Tag, group: 'generic', labelHe: 'קופון', labelEn: 'Coupon' },
  { value: 'star-outline', Icon: Star, group: 'generic', labelHe: 'כוכב', labelEn: 'Star' },
  { value: 'heart-outline', Icon: Heart, group: 'generic', labelHe: 'לב', labelEn: 'Heart' },
  { value: 'ribbon-outline', Icon: Medal, group: 'generic', labelHe: 'מדליה', labelEn: 'Medal' },
  { value: DEFAULT_REWARD_ICON, Icon: Gift, group: 'generic', labelHe: 'הטבה כללית', labelEn: 'General reward' },
];

const FALLBACK_OPTION = REWARD_ICON_OPTIONS[REWARD_ICON_OPTIONS.length - 1];

// Never returns undefined — an unrecognized or legacy `imageIcon` value (a
// reward created before this picker existed, or a hand-edited row) falls
// back to the same generic gift icon the model column itself defaults to,
// never a blank icon or the reward's name/initial. `findLast`, not `find`:
// a couple of values are shared by two labeled options (e.g. 'gift-outline'
// is both retail's "Gift" and generic's "General reward") — searching from
// the end means the deliberately-last "generic" catch-all entries win the
// lookup for their own value, rather than whichever more specific option
// happens to appear first in the catalog.
export function rewardIconOption(value: string): RewardIconOption {
  return REWARD_ICON_OPTIONS.findLast((option) => option.value === value) ?? FALLBACK_OPTION;
}

export function rewardIconLabel(option: RewardIconOption, lang: 'HE' | 'EN'): string {
  return lang === 'HE' ? option.labelHe : option.labelEn;
}
