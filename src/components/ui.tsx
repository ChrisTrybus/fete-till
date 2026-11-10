import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, useColorScheme, useWindowDimensions, View, type TextInputProps, type ViewStyle } from 'react-native';

const light = {
  bg: '#f3f6f1',
  surface: '#ffffff',
  ink: '#18261d',
  muted: '#5d6b61',
  line: '#d8e0d6',
  accent: '#1f6b45',
  accentInk: '#ffffff',
  sun: '#f5c542',
  sunInk: '#2a2100',
  danger: '#b3362b',
  bunting: ['#e2574c', '#f5c542', '#3d8fd1', '#1f6b45', '#e98ab0'],
};
const dark: typeof light = {
  ...light,
  bg: '#111813',
  surface: '#1a241d',
  ink: '#e8efe9',
  muted: '#9aa89e',
  line: '#2c3a30',
  accent: '#4cbb7f',
  accentInk: '#08140d',
  danger: '#ff7a6e',
};
export type Theme = typeof light;

export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light);

export function Button({
  title,
  onPress,
  kind = 'plain',
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: 'plain' | 'primary' | 'danger';
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.accent : t.surface;
  const fg = kind === 'primary' ? t.accentInk : kind === 'danger' ? t.danger : t.ink;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        { backgroundColor: bg, borderColor: kind === 'primary' ? t.accent : t.line, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
        style,
      ]}
    >
      <Text style={[s.buttonText, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[s.card, { backgroundColor: t.surface, borderColor: t.line }, style]}>{children}</View>;
}

export function Label({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <Text style={[s.label, { color: t.muted }]}>{children}</Text>;
}

export function Heading({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <Text style={[s.heading, { color: t.ink }]}>{children}</Text>;
}

export function Field(props: TextInputProps) {
  const t = useTheme();
  return (
    <TextInput
      placeholderTextColor={t.muted}
      {...props}
      style={[s.field, { color: t.ink, backgroundColor: t.bg, borderColor: t.line }, props.style]}
    />
  );
}

export function Body({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  const t = useTheme();
  return <Text style={{ color: muted ? t.muted : t.ink, fontSize: 15, lineHeight: 21 }}>{children}</Text>;
}

/** Row of bunting triangles: the app's one decorative flourish. */
export function Bunting() {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const flags = Math.ceil(width / FLAG_WIDTH) + 1; // enough to span tablets too
  return (
    <View style={s.bunting} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: flags }, (_, i) => (
        <View key={i} style={[s.flag, { borderTopColor: t.bunting[Math.floor(i / 2) % t.bunting.length] }]} />
      ))}
    </View>
  );
}

const FLAG_WIDTH = 14;

export const s = StyleSheet.create({
  button: { borderWidth: 1, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  heading: { fontSize: 22, fontWeight: '800' },
  field: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16 },
  bunting: { flexDirection: 'row', overflow: 'hidden', height: 8 },
  flag: { width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 8, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  num: { fontVariant: ['tabular-nums'] },
});
