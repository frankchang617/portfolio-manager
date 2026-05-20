/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        claude: {
          bg:           'var(--claude-bg)',
          card:         'var(--claude-card)',
          border:       'var(--claude-border)',
          orange:       '#0071e3',
          'orange-dark':'#0062cc',
          'orange-light':'var(--claude-orange-light)',
          text:         'var(--claude-text)',
          muted:        'var(--claude-muted)',
          subtle:       'var(--claude-subtle)',
        },
        profit:       '#1a9e3f',
        'profit-bg':  '#f0fdf4',
        loss:         '#dc2626',
        'loss-bg':    '#fef2f2',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', 'sans-serif'],
      },
      boxShadow: {
        card:       '0 2px 8px rgba(0,0,0,0.06)',
        'card-hover':'0 4px 16px rgba(0,0,0,0.10)',
        modal:      '0 24px 64px rgba(0,0,0,0.18), 0 8px 24px rgba(0,0,0,0.10)',
      },
      borderRadius: {
        xl:   '12px',
        '2xl':'18px',
        '3xl':'24px',
        pill: '980px',
      },
      backdropBlur: {
        apple: '20px',
      },
    },
  },
  plugins: [],
}
