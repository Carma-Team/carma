import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList, TextInput, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '@/context/AppContext';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, TYPOGRAPHY, COMMON_STYLES } from '@/theme';
import { Reward } from '@/navigation/types';

export default function BusinessDashboard() {
  const { user, setUser } = useApp();
  const insets = useSafeAreaInsets();

  // נתוני דמו המדמים טבלת Rewards בבסיס הנתונים (מכיל הטבות של עסקים שונים)
  const ALL_REWARDS_DATABASE: Reward[] = [
    { id: '1', business_id: 'b1', title: 'קפה ומאפה', description: 'קפה הפוך ומאפה שמרים לבחירה', cost_points: 150, imageEmoji: '☕' },
    { id: '2', business_id: 'b1', title: '10% הנחה על כל החנות', description: 'לא כולל כפל מבצעים', cost_points: 300, imageEmoji: '🛍️' },
    { id: '3', business_id: 'b2', title: 'שטיפת רכב חינם', description: 'שטיפה חיצונית בלבד', cost_points: 500, imageEmoji: '🚗' },
    { id: '4', business_id: 'b3', title: 'כרטיס קולנוע', description: 'תקף לכל הסרטים', cost_points: 400, imageEmoji: '🎬' },
  ];

  // סינון ההטבות כך שיוצגו רק אלו ששייכות ל-businessId של המשתמש המחובר
  const [rewards, setRewards] = useState<Reward[]>(
    ALL_REWARDS_DATABASE.filter(r => r.business_id === user?.businessId)
  );

  const [isModalVisible, setModalVisible] = useState(false);
  const [editingReward, setEditingReward] = useState<Partial<Reward> | null>(null);

  const handleAddReward = () => {
    setEditingReward({
      title: '',
      description: '',
      cost_points: 0,
      imageEmoji: '🎁',
      business_id: user?.businessId // קישור אוטומטי לעסק הנוכחי
    });
    setModalVisible(true);
  };

  const handleSaveReward = () => {
    if (editingReward?.id) {
      setRewards(prev => prev.map(r => r.id === editingReward.id ? { ...r, ...editingReward } as Reward : r));
    } else {
      const newReward = {
        ...editingReward,
        id: Date.now().toString(),
        business_id: user?.businessId
      } as Reward;
      setRewards(prev => [...prev, newReward]);
    }
    setModalVisible(false);
  };

  const handleDeleteReward = (id: string) => {
    setRewards(prev => prev.filter(r => r.id !== id));
  };

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={TYPOGRAPHY.h1}>שלום, {user?.name}</Text>
          <Text style={TYPOGRAPHY.body}>ניהול הטבות לעסק שלך</Text>
        </View>
        <TouchableOpacity onPress={() => setUser(null)} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>יציאה</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.statsCard}>
          <Text style={styles.statsTitle}>סטטיסטיקות עסק</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{rewards.length}</Text>
              <Text style={styles.statLabel}>הטבות פעילות</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>24</Text>
              <Text style={styles.statLabel}>מימושים החודש</Text>
            </View>
          </View>
        </Card>

        <View style={styles.sectionHeader}>
          <Text style={TYPOGRAPHY.h2}>ההטבות שלך</Text>
          <Button size="sm" onPress={handleAddReward}>+ הוסף הטבה</Button>
        </View>

        {rewards.map(reward => (
          <Card key={reward.id} style={styles.rewardCard}>
            <View style={styles.rewardInfo}>
              <Text style={styles.rewardEmoji}>{reward.imageEmoji}</Text>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={TYPOGRAPHY.h3}>{reward.title}</Text>
                <Text style={[TYPOGRAPHY.caption, { color: COLORS.textMuted }]}>{reward.description}</Text>
                <Text style={[TYPOGRAPHY.label, { color: COLORS.brand, marginTop: 4 }]}>{reward.cost_points} נקודות</Text>
              </View>
            </View>
            <View style={styles.actions}>
              <TouchableOpacity onPress={() => { setEditingReward(reward); setModalVisible(true); }}>
                <Text style={{ color: COLORS.brandLight, marginLeft: 16 }}>עריכה</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleDeleteReward(reward.id)}>
                <Text style={{ color: COLORS.danger }}>מחיקה</Text>
              </TouchableOpacity>
            </View>
          </Card>
        ))}
      </ScrollView>

      {/* מודאל הוספה/עריכה */}
      <Modal visible={isModalVisible} animationType="slide" transparent>
        <View style={COMMON_STYLES.modalOverlay}>
          <Card style={styles.modalCard}>
            <Text style={[TYPOGRAPHY.h2, { marginBottom: 20 }]}>
              {editingReward?.id ? 'עריכת הטבה' : 'הוספת הטבה חדשה'}
            </Text>

            <TextInput
              style={styles.input}
              placeholder="שם ההטבה"
              placeholderTextColor={COLORS.textMuted}
              value={editingReward?.title}
              onChangeText={text => setEditingReward(prev => ({ ...prev, title: text }))}
            />
            <TextInput
              style={[styles.input, { height: 80 }]}
              placeholder="תיאור ההטבה"
              placeholderTextColor={COLORS.textMuted}
              multiline
              value={editingReward?.description}
              onChangeText={text => setEditingReward(prev => ({ ...prev, description: text }))}
            />
            <TextInput
              style={styles.input}
              placeholder="עלות בנקודות"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="numeric"
              value={editingReward?.cost_points?.toString()}
              onChangeText={text => setEditingReward(prev => ({ ...prev, cost_points: parseInt(text) || 0 }))}
            />

            <View style={styles.modalActions}>
              <Button variant="ghost" onPress={() => setModalVisible(false)}>ביטול</Button>
              <Button onPress={handleSaveReward}>שמור</Button>
            </View>
          </Card>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  logoutBtn: { padding: 8 },
  logoutText: { color: COLORS.danger, fontWeight: '600' },
  content: { padding: SPACING.lg },
  statsCard: { marginBottom: 24, padding: 20, backgroundColor: 'rgba(74, 222, 128, 0.05)' },
  statsTitle: { ...TYPOGRAPHY.label, marginBottom: 16, textAlign: 'right' },
  statsGrid: { flexDirection: 'row-reverse', justifyContent: 'space-around' },
  statItem: { alignItems: 'center' },
  statValue: { ...TYPOGRAPHY.h1, color: COLORS.brand },
  statLabel: { ...TYPOGRAPHY.caption },
  sectionHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  rewardCard: {
    marginBottom: 12,
    padding: 16,
    flexDirection: 'row-reverse',
    alignItems: 'center',
  },
  rewardInfo: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center' },
  rewardEmoji: { fontSize: 32, marginLeft: 16 },
  actions: { flexDirection: 'row-reverse', marginTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)', paddingTop: 12 },
  modalCard: { width: '90%', padding: 24 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    marginBottom: 12,
    textAlign: 'right',
  },
  modalActions: { flexDirection: 'row-reverse', justifyContent: 'flex-end', gap: 12, marginTop: 12 },
});
