import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Rank } from '@hackathon26/shared';

interface RankPickerModalProps {
  visible: boolean;
  title: string;
  ranks: Rank[];
  selectedRankId?: string;
  onSelect: (rank: Rank) => void;
  onClose: () => void;
}

/** Bottom sheet for choosing the origin or destination rank. */
export function RankPickerModal({
  visible,
  title,
  ranks,
  selectedRankId,
  onSelect,
  onClose,
}: RankPickerModalProps) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <FlatList
            data={ranks}
            keyExtractor={(rank) => rank.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <Pressable
                style={[styles.row, item.id === selectedRankId && styles.rowSelected]}
                onPress={() => {
                  onSelect(item);
                  onClose();
                }}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.rowArea} numberOfLines={1}>
                    {item.area}
                  </Text>
                </View>
                {item.id === selectedRankId ? <Text style={styles.check}>Selected</Text> : null}
              </Pressable>
            )}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '80%',
    paddingBottom: 16,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '600',
    padding: 16,
  },
  listContent: {
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  rowSelected: {
    backgroundColor: '#e8f1fb',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    fontSize: 15,
    fontWeight: '600',
  },
  rowArea: {
    fontSize: 13,
    color: '#555',
  },
  check: {
    fontSize: 13,
    color: '#0b5cad',
    fontWeight: '600',
  },
});
