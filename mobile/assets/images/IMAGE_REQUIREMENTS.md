# CARMA App — Image Asset Requirements

All images go in `mobile/assets/images/`.
Referenced in `app.json`.

---

## `icon.png` — Main App Icon (iOS + fallback)

- **Size:** 1024×1024 px
- **Format:** PNG, no transparency (solid background)
- **Content:** C-Wheel symbol centered, with brand background color
- **Notes:** iOS auto-crops to a circle, but the file itself must be a square. Used as the fallback icon on all platforms.

---

## Android Adaptive Icon

Android composes the icon from separate layers. All three files must be 1024×1024 px PNG.

### `android-icon-foreground.png`
- **Size:** 1024×1024 px
- **Format:** PNG with transparency (alpha channel)
- **Content:** C-Wheel symbol only, centered, occupying ~66% of the canvas — the rest must be transparent
- **Notes:** Android will scale/crop this layer depending on the device launcher

### `android-icon-background.png`
- **Size:** 1024×1024 px
- **Format:** PNG, no transparency
- **Content:** Solid color fill — `#E6F4FE` (light blue, as defined in `app.json`)
- **Notes:** Can also be a pattern or gradient, but a flat color is safest across launchers

### `android-icon-monochrome.png`
- **Size:** 1024×1024 px
- **Format:** PNG with transparency (alpha channel)
- **Content:** Fully **white** C-Wheel symbol on a transparent background
- **Notes:** Used for Android 13+ themed/monochrome icons (follows system accent color)

---

## `splash-icon.png` — Splash Screen

- **Recommended size:** 1284×2778 px (iPhone 14 Pro Max native), minimum 200 px wide
- **Format:** PNG with transparency
- **Content:** Full CARMA logo (C-Wheel + "ARMA" text) or C-Wheel symbol alone, on a transparent background
- **Notes:**
  - The splash background color is set separately in `app.json`: `#ffffff` (light mode) / `#000000` (dark mode)
  - `app.json` sets `imageWidth: 200` and `resizeMode: contain` — the image is scaled down to 200 px wide and centered
  - Recommend using the full logo here since there is more visual space

---

## `favicon.png` — Web Version

- **Size:** 196×196 px (minimum 48×48 px)
- **Format:** PNG
- **Content:** C-Wheel symbol only
- **Notes:** Shown in browser tab when the app runs as a web build (`expo export --platform web`)

---

## Summary Table

| File | Size | Transparency | Content |
|------|------|-------------|---------|
| `icon.png` | 1024×1024 | No | C-Wheel, solid background |
| `android-icon-foreground.png` | 1024×1024 | Yes | C-Wheel centered at ~66% |
| `android-icon-background.png` | 1024×1024 | No | Solid `#E6F4FE` |
| `android-icon-monochrome.png` | 1024×1024 | Yes | White C-Wheel on transparent |
| `splash-icon.png` | 1284×2778 | Yes | Full logo or C-Wheel |
| `favicon.png` | 196×196 | Optional | C-Wheel |

---

## Logo Files Available

Located in `OneDrive > MTA > לוגו > חדש`:

| File | Description | Best used for |
|------|-------------|---------------|
| `Carma Logo C Wheel.png` | C-Wheel symbol only (square-ish) | icon, foreground, monochrome, favicon |
| `CARMA Wheel.png` | Full logo with "ARMA" text | splash screen |
