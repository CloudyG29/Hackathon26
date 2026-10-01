import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii } from '../lib/theme';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  /** Shows a round back button; the caller decides where it navigates. */
  onBack?: () => void;
  /** Optional right-side element. */
  rightElement?: React.ReactNode;
}

/**
 * In-page header used by every screen. Matches the reference design:
 * bold left-aligned title with optional subtitle and a pill-shaped back
 * button that uses the accent colour family.
 */
export function ScreenHeader({ title, subtitle, onBack, rightElement }: ScreenHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.left}>
        {onBack ? (
          <Pressable
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={8}
          >
            <Text style={styles.backIcon}>‹</Text>
          </Pressable>
        ) : null}
        <View style={styles.titleGroup}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      </View>
      {rightElement ? <View style={styles.right}>{rightElement}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 8,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  titleGroup: { flex: 1 },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#14142B',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  backButtonPressed: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accentBorder,
  },
  backIcon: {
    fontSize: 26,
    color: colors.text,
    lineHeight: 30,
    marginTop: -2,
    fontWeight: '400',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 1,
  },
  right: {
    marginLeft: 8,
  },
});
