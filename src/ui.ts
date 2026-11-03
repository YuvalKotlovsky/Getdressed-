import { I18nManager, type TextStyle, type ViewStyle } from 'react-native';
import { theme } from './theme';

/** Hebrew UI: first item on the right regardless of whether the OS already flipped layout. */
export const rowDir: ViewStyle['flexDirection'] = I18nManager.isRTL ? 'row' : 'row-reverse';
export const rtlText: TextStyle = { textAlign: 'right', writingDirection: 'rtl' };
export const text = (size = 16, weight: TextStyle['fontWeight'] = '400', color: string = theme.ink): TextStyle => ({
  ...rtlText, fontSize: size, fontWeight: weight, color,
});
export const shadow: ViewStyle = {
  shadowColor: '#5b4630', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 2,
};
