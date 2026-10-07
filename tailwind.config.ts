import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#FAF8F3',
        card: '#ECE6DB',
        'card-dark': '#DDD5C6',
        accent: '#A3E635',
        momentum: '#E8892A',
        'text-primary': '#3B2F2F',
      },
      fontFamily: {
        sans: ['Instrument Sans', 'sans-serif'],
        serif: ['Young Serif', 'serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
