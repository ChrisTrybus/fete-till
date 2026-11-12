import { Text, View } from 'react-native';
import { s, useTheme } from '@/components/ui';

/** One headline figure, such as the day's takings. */
export function Stat({ label, value, hero }: { label: string; value: string; hero?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexBasis: '47%', flexGrow: 1, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: hero ? t.accent : t.line, backgroundColor: hero ? t.accent : t.surface }}>
      <Text style={{ color: hero ? t.accentInk : t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1 }}>{label.toUpperCase()}</Text>
      <Text style={[s.num, { color: hero ? t.accentInk : t.ink, fontSize: 26, fontWeight: '800', marginTop: 4 }]}>{value}</Text>
    </View>
  );
}

/** A row of a figures table: a name, then right-aligned numbers. */
export function Row({ cells, header }: { cells: string[]; header?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.line, gap: 8 }}>
      {cells.map((c, i) => (
        <Text
          key={i}
          style={[s.num, { flex: i === 0 ? 2 : 1, textAlign: i === 0 ? 'left' : 'right', color: header ? t.muted : t.ink, fontSize: header ? 12 : 15, fontWeight: header ? '700' : '400' }]}
        >
          {c}
        </Text>
      ))}
    </View>
  );
}
