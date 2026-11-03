export const theme = {
  bg: '#FAF6EF', // warm off-white
  card: '#FFFFFF',
  ink: '#2B2622',
  muted: '#8A8178',
  line: '#EAE2D6',
  accent: '#B5651D',
  accentSoft: '#F3E3D0',
  warn: '#B3402A',
  warnSoft: '#FBE9E4',
  ok: '#3E7D5A',
  radius: 20,
};

export const COLORS: Record<string, { label: string; hex: string; neutral: boolean }> = {
  white: { label: 'לבן', hex: '#F4F1EA', neutral: true },
  black: { label: 'שחור', hex: '#2A2A2A', neutral: true },
  gray: { label: 'אפור', hex: '#A5A5A5', neutral: true },
  beige: { label: 'בז׳', hex: '#D8C3A5', neutral: true },
  navy: { label: 'כחול כהה', hex: '#26365E', neutral: true },
  denim: { label: 'ג׳ינס', hex: '#4F6D9A', neutral: true },
  brown: { label: 'חום', hex: '#7A5230', neutral: true },
  blue: { label: 'כחול', hex: '#5B9BD5', neutral: false },
  red: { label: 'אדום', hex: '#C0392B', neutral: false },
  green: { label: 'ירוק', hex: '#6BA368', neutral: false },
  pink: { label: 'ורוד', hex: '#E8A0B4', neutral: false },
  yellow: { label: 'צהוב', hex: '#E8C547', neutral: false },
  purple: { label: 'סגול', hex: '#8E6BBF', neutral: false },
};
