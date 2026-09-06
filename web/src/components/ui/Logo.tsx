import logoClean from '@/assets/brand/carma-logo-clean.svg';
import logoWhite from '@/assets/brand/carma-logo-white.svg';
import symbolClean from '@/assets/brand/carma-symbol-clean.svg';
import symbolWhite from '@/assets/brand/carma-symbol-white.svg';

type LogoProps = {
  /** Indigo-on-white (default) or the reversed white mark for dark/photographic backgrounds. */
  tone?: 'clean' | 'white';
  /** Pixel height — auth screens run 28-36px, the sidebar header 20-22px. */
  height?: number;
  className?: string;
};

// The full wordmark. Style guide: one instance per view — the sidebar logo
// *or* a page logo, never both. Never recolored, outlined, rotated or
// stretched; width is intentionally left to scale with height.
export function Logo({ tone = 'clean', height = 22, className }: LogoProps) {
  return <img src={tone === 'white' ? logoWhite : logoClean} alt="CARMA" height={height} className={className} />;
}

type BrandMarkProps = {
  tone?: 'clean' | 'white';
  size?: number;
  className?: string;
  /** Loading state only — see LoadingState's page variant. */
  animated?: boolean;
};

// The standalone "C" symbol — favicon, collapsed sidebar rail, loading
// indicator, empty-state watermark. A signature, not decoration: at most one
// per screen, and never layered over road photography or inside a button,
// badge or table cell (style guide, "Brand assets in the portal").
export function BrandMark({ tone = 'clean', size = 24, className, animated = false }: BrandMarkProps) {
  return (
    <img
      src={tone === 'white' ? symbolWhite : symbolClean}
      alt=""
      width={size}
      height={size}
      className={[className, animated && 'carma-brandmark-pulse'].filter(Boolean).join(' ')}
    />
  );
}
