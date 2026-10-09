
const teal = { 50:'#EEF6F6',100:'#E3EFEE',200:'#C3DEDC',300:'#94C3C0',400:'#4E9A9B',500:'#1F7A7F',600:'#0F5E63',700:'#0B4A4E',800:'#093C40',900:'#072E31',950:'#041E20' };
const neutral = { 50:'#FBFAF7',100:'#F6F5F1',200:'#ECE9E2',300:'#DCD8CE',400:'#A8A397',500:'#6B6F76',600:'#4A5568',700:'#3A4256',800:'#232F4D',900:'#14213D',950:'#0C1429' };
const terracotta = { 50:'#FDF4EC',100:'#FBEBDD',200:'#F5D3B8',300:'#F2B872',400:'#D9773F',500:'#B8481A',600:'#9A3412',700:'#7C2D12',800:'#64240F',900:'#4A1B0B',950:'#2E1006' };
const ochre = { 50:'#FFF8EB',100:'#FDEFCE',200:'#F5DDAE',300:'#EBC274',400:'#D9A13C',500:'#BF7F12',600:'#A15C07',700:'#854A06',800:'#6B3B06',900:'#4F2C05',950:'#331D03' };
const green = { 50:'#EAF6F0',100:'#D3ECDF',200:'#A9D8C0',300:'#77BF9C',400:'#43A074',500:'#2C8A62',600:'#1F7A55',700:'#196447',800:'#144F39',900:'#0F3B2B',950:'#09261B' };

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        blue: teal, indigo: teal, violet: teal, purple: teal, sky: teal, cyan: teal, teal, fuchsia: teal,
        slate: neutral, gray: neutral, zinc: neutral, stone: neutral, neutral,
        red: terracotta, rose: terracotta, orange: terracotta, pink: terracotta,
        amber: ochre, yellow: ochre,
        emerald: green, green, lime: green,
        background: '#F6F5F1',
        foreground: '#14213D',
        card: {
          DEFAULT: '#FFFFFF',
          foreground: '#14213D',
        },
        popover: {
          DEFAULT: '#FFFFFF',
          foreground: '#14213D',
        },
        primary: {
          DEFAULT: '#0F5E63',
          hover: '#0B4A4E',
          soft: '#E3EFEE',
          foreground: '#FFFFFF',
        },
        secondary: {
          DEFAULT: '#E3EFEE',
          hover: '#C3DEDC',
          foreground: '#0F5E63',
        },
        accent: {
          DEFAULT: '#0F5E63',
          strong: '#0F5E63',
          soft: '#E3EFEE',
          bright: '#0F5E63',
          foreground: '#FFFFFF',
        },
        muted: {
          DEFAULT: '#4A5568',
          foreground: '#4A5568',
          faint: '#6B6F76',
          soft: '#FBFAF7',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          2: '#FBFAF7',
          alt: '#FBFAF7',
        },
        ink: {
          DEFAULT: '#14213D',
          2: '#4A5568',
        },
        line: {
          DEFAULT: '#DCD8CE',
          soft: '#DCD8CE',
          input: '#DCD8CE',
        },
        nav: {
          bg: '#F6F5F1',
          'bg-2': '#F6F5F1',
          line: '#DCD8CE',
          ink: '#4A5568',
          muted: '#6B6F76',
          strong: '#14213D',
        },
        destructive: {
          DEFAULT: '#9A3412',
          soft: '#FBEBDD',
          border: '#F2B872',
          foreground: '#FFFFFF',
        },
        border: '#DCD8CE',
        input: '#DCD8CE',
        ring: '#0F5E63',
        coach: {
          blue: '#0F5E63',
          blueHover: '#0B4A4E',
          azure: '#0F5E63',
          ice: '#E3EFEE',
          iceHover: '#C3DEDC',
          muted: '#FBFAF7',
          mutedForeground: '#4A5568',
          bg: '#F6F5F1',
          border: '#DCD8CE',
          card: '#FFFFFF',
          text: '#14213D',
        },
      },
      borderRadius: {
        sm: '6px',
        md: '8px',
        lg: '8px',
        xl: '14px',
        '2xl': '14px',
        pill: '999px',
      },
      keyframes: {
        'rise': { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'none' } },
        'fade': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'pop': { '0%': { opacity: '0', transform: 'scale(0.96) translateY(6px)' }, '100%': { opacity: '1', transform: 'none' } },
        'slide-left': { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'none' } },
      },
      animation: {
        rise: 'rise 320ms cubic-bezier(0.22,1,0.36,1) both',
        fade: 'fade 200ms ease-out both',
        pop: 'pop 220ms cubic-bezier(0.22,1,0.36,1) both',
        'slide-left': 'slide-left 240ms cubic-bezier(0.22,1,0.36,1) both',
      },
      fontFamily: {
        sans: ['var(--font-body)', "'IBM Plex Sans'", 'system-ui', '-apple-system', 'sans-serif'],
        body: ['var(--font-body)', "'IBM Plex Sans'", 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['var(--font-display)', "'Source Serif 4'", 'Georgia', 'serif'],
        display: ['var(--font-display)', "'Source Serif 4'", 'Georgia', 'serif'],
        mono: ['var(--font-mono)', "'IBM Plex Mono'", 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
