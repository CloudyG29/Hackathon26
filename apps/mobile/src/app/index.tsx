import { StyleSheet, Text, View } from 'react-native';
import type { RoutePriority } from '@hackathon26/shared';

/**
 * Placeholder home screen. It exists to prove the router, the workspace types
 * and the bundler are all wired up — replace it with the journey search form.
 */
const ROUTE_PRIORITIES: RoutePriority[] = ['cheapest', 'fastest', 'easiest', 'safest'];

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Where are you travelling?</Text>
      <Text style={styles.subtitle}>
        Journey search and route options will render here.
      </Text>

      <View style={styles.tags}>
        {ROUTE_PRIORITIES.map((priority) => (
          <Text key={priority} style={styles.tag}>
            {priority}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: '#555',
    textAlign: 'center',
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  tag: {
    fontSize: 13,
    color: '#0b5cad',
    backgroundColor: '#e8f1fb',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
});
