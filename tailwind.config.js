/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // CSS-var-backed tokens — switch automatically with dark/light
        bg: {
          base:     'rgb(var(--bg-base) / <alpha-value>)',
          surface:  'rgb(var(--bg-surface) / <alpha-value>)',
          elevated: 'rgb(var(--bg-elevated) / <alpha-value>)',
        },
        text: {
          primary:   'rgb(var(--text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--text-secondary) / <alpha-value>)',
          tertiary:  'rgb(var(--text-tertiary) / <alpha-value>)',
        },
        // Static brand colors
        brand: {
          green:        '#1D9E75',
          'green-dim':  '#16785A',
          'green-glow': 'rgba(29,158,117,0.15)',
          blue:         '#38b6ff',
          'blue-dim':   '#2a9de8',
          'blue-glow':  'rgba(56,182,255,0.15)',
        },
        accent: {
          amber:      '#EF9F27',
          'amber-dim': 'rgba(239,159,39,0.15)',
          red:        '#E24B4A',
          'red-dim':  'rgba(226,75,74,0.15)',
          blue:       '#378ADD',
          'blue-dim': 'rgba(55,138,221,0.15)',
        },
      },
      borderColor: {
        subtle: 'var(--border)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      borderRadius: {
        card: '12px',
      },
      spacing: {
        unit: '8px',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.2s ease-in-out',
        'slide-up': 'slideUp 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-surface': 'linear-gradient(135deg, #12121A 0%, #0F0F16 100%)',
      },
    },
  },
  plugins: [],
}
