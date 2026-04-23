import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['DM Mono', 'monospace'],
        sans: ['Sora', 'sans-serif'],
      },
      colors: {
        ink: '#0f0f0f',
        paper: '#fafaf8',
        surface: '#f4f3f0',
        strong: { DEFAULT: '#1a6b4a', bg: '#eaf5ef', mid: '#2d9b6f' },
        weak: { DEFAULT: '#8b1e1e', bg: '#fdf0f0', mid: '#c0392b' },
        amber: { DEFAULT: '#7a4e00', bg: '#fdf6e3', mid: '#d4830a' },
      },
    },
  },
  plugins: [],
}
export default config
