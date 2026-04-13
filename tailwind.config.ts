import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        heebo: ['Heebo', 'sans-serif'],
        sans: ['Heebo', 'sans-serif'],
      },
      colors: {
        brand: {
          50:  '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
        },
        carma: {
          green:  '#22c55e',
          teal:   '#0d9488',
          blue:   '#3b82f6',
          amber:  '#f59e0b',
          red:    '#ef4444',
          dark:   '#0f172a',
          card:   '#1e293b',
          border: '#334155',
        },
        score: {
          excellent: '#22c55e',
          good:      '#84cc16',
          fair:      '#f59e0b',
          poor:      '#ef4444',
        },
      },
      backgroundImage: {
        'gradient-radial':  'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':   'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
        'carma-gradient':   'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f2027 100%)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      animation: {
        'pulse-slow':    'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'score-reveal':  'scoreReveal 0.8s ease-out forwards',
        'slide-up':      'slideUp 0.3s ease-out',
      },
      keyframes: {
        scoreReveal: {
          '0%':   { transform: 'scale(0.5)', opacity: '0' },
          '60%':  { transform: 'scale(1.1)' },
          '100%': { transform: 'scale(1)',   opacity: '1' },
        },
        slideUp: {
          '0%':   { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)',    opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}

export default config
