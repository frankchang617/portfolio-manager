import { useTheme } from '../contexts/ThemeContext'

export function useDarkMode() {
  const { dark } = useTheme()
  return dark
}

export function useChartColors() {
  const dark = useDarkMode()
  return {
    grid:          dark ? '#3a3a3c' : '#f0f0f0',
    axis:          dark ? '#6e6e73' : '#9ca3af',
    axisText:      dark ? '#aeaeb2' : '#6b7280',
    tooltip:       dark ? '#2c2c2e' : '#ffffff',
    tooltipBorder: dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
    tooltipText:   dark ? '#f5f5f7' : '#1d1d1f',
  }
}
