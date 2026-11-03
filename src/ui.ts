import { I18nManager, type TextStyle, type ViewStyle } from 'react-native';
import { theme } from './theme';

/** Hebrew UI: first item on the right regardless of whether the OS already flipped layout. */
export const rowDir: ViewStyle['flexDirection'] = I18nManager.isRTL ? 'row' : 'row-reverse';
export const rtlText: TextStyle = { textAlign: 'right', writingDirection: 'rtl' };
export const text = (size = 15, weight: TextStyle['fontWeight'] = '400', color: string = theme.ink): TextStyle => ({
  ...rtlText, fontSize: size, fontWeight: weight, color,
});
/** Cards: white, hairline border, no shadow. */
export const cardStyle: ViewStyle = { backgroundColor: theme.card, borderRadius: theme.radius, borderWidth: 1, borderColor: theme.line };
