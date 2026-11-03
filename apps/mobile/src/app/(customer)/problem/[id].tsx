import { CASE_LABELS, CUSTOMER_PROBLEMS } from '@oyo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, View } from 'react-native';
import { customerApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { Alert, BottomBar, Button, Chip, IconButton, Screen, Text, TextField } from '@/components';
import { colors } from '@/theme/tokens';

type Problem = (typeof CUSTOMER_PROBLEMS)[number];

/** C19 (CUS-19): what went wrong, in a few words, with up to 3 photos. */
export default function ReportProblem() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [type, setType] = useState<Problem>('missing_item');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [problem, setProblem] = useState<string>();

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setProblem('Allow access to your photos to attach one.');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: 3 - photos.length,
    });
    if (!result.canceled) setPhotos([...photos, ...result.assets].slice(0, 3));
  };

  const send = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append('type', type);
      form.append('description', description.trim());
      for (const [i, p] of photos.entries()) {
        if (Platform.OS === 'web')
          form.append('photos', await (await fetch(p.uri)).blob(), `photo${i}.jpg`);
        else
          form.append('photos', {
            uri: p.uri,
            name: `photo${i}.jpg`,
            type: p.mimeType ?? 'image/jpeg',
          } as unknown as Blob);
      }
      return customerApi.reportProblem(id, form);
    },
    onSuccess: (cases) => {
      queryClient.setQueryData(['order-cases', id], cases);
      router.back();
    },
  });

  return (
    <Screen
      top={
        <>
          <IconButton icon="back" label="Back" onPress={() => router.back()} />
          <Text variant="h2" accessibilityRole="header" style={{ flex: 1 }}>
            Report a Problem
          </Text>
        </>
      }
      footer={
        <BottomBar>
          <Button
            label="Send to Oyo Eats"
            disabled={description.trim().length < 3}
            loading={send.isPending}
            onPress={() => send.mutate()}
          />
        </BottomBar>
      }
      bodyStyle={{ gap: 14 }}
    >
      <Text variant="label">What went wrong?</Text>
      <View style={styles.chips}>
        {CUSTOMER_PROBLEMS.map((p) => (
          <Pressable
            key={p}
            accessibilityRole="radio"
            accessibilityState={{ checked: p === type }}
            onPress={() => setType(p)}
          >
            <Chip label={CASE_LABELS[p]} tone={p === type ? 'on' : 'neutral'} />
          </Pressable>
        ))}
      </View>
      <TextField
        label="Tell us more"
        hint="Which item, what was wrong. The office reads every report."
        value={description}
        onChangeText={setDescription}
        multiline
      />
      <Text variant="label">Photos (optional, up to 3)</Text>
      <View style={styles.photos}>
        {photos.map((p, i) => (
          <Pressable
            key={p.uri}
            accessibilityRole="button"
            accessibilityLabel={`Remove photo ${i + 1}`}
            onPress={() => setPhotos(photos.filter((x) => x !== p))}
          >
            <Image source={{ uri: p.uri }} style={styles.thumb} />
          </Pressable>
        ))}
        {photos.length < 3 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a photo"
            onPress={() => void pick()}
            style={[styles.thumb, styles.add]}
          >
            <Text variant="h2">+</Text>
          </Pressable>
        ) : null}
      </View>
      {problem || send.error ? (
        <Alert tone="danger" message={problem ?? errorMessage(send.error)} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photos: { flexDirection: 'row', gap: 10 },
  thumb: { width: 84, height: 84, borderRadius: 12, backgroundColor: colors.photo },
  add: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.control,
  },
});
