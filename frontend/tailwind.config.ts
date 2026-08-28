import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eef4ff',
          100: '#e5edff',
          200: '#c7d8fa',
          300: '#93b4f5',
          400: '#3677e0',
          500: '#0a5edb',
          600: '#0048cc',
          700: '#1429a9',
          800: '#0f2e91',
          900: '#0a2881',
          950: '#071b5c'
        },
        gold: {
          50: '#fdf8e7',
          100: '#faeec6',
          200: '#f7e18d',
          300: '#f7df8a',
          400: '#f0cd5f',
          500: '#e4ba37',
          600: '#b07900',
          700: '#8a5f00',
          800: '#6b4900'
        },
        dark: {
          50: '#ebedf3',
          100: '#ffffff',
          200: '#e2e5ec',
          300: '#c7cbd6',
          400: '#9aa0ae',
          500: '#6b7180',
          600: '#4a4f5c',
          700: '#33373f',
          800: '#1f2228',
          900: '#111315',
          950: '#000000'
        }
      },
      fontFamily: {
        sans: ['Inter', 'Poppins', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
};

export default config;
