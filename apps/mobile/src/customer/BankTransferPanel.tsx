import { formatLkr, type OrderDetail } from '@oyo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import { customerApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { Alert, Button, Card, Icon, IconButton, Text, TextField } from '@/components';
import { colors, fonts } from '@/theme/tokens';
import { useCountdown } from '@/hooks/useCountdown';
import { keys } from './queries';

function CopyRow({ label, value, green }: { label: string; value: string; green?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <View style={styles.copyRow}>
      <View style={{ flex: 1 }}>
        <Text variant="small">{label}</Text>
        <Text variant="strong" style={green ? { color: colors.brandSoft } : undefined} selectable>
          {value}
        </Text>
      </View>
      <IconButton
        icon={copied ? 'check' : 'copy'}
        label={`Copy ${label.toLowerCase()}`}
        onPress={async () => {
          await Clipboard.setStringAsync(value);
          setCopied(true);
        }}
      />
    </View>
  );
}

/** C08: where to pay, how much, by when; then upload the slip (CUS-09). */
export function BankTransferPanel({ order }: { order: OrderDetail }) {
  const bt = order.bankTransfer!;
  const queryClient = useQueryClient();
  const seconds = useCountdown(bt.expiresAt);
  const [image, setImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [bankReference, setBankReference] = useState('');
  const [pickError, setPickError] = useState<string>();

  const pick = async (camera: boolean) => {
    setPickError(undefined);
    const permission = camera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setPickError(
        camera ? 'Camera access is off for Oyo Eats.' : 'Photo access is off for Oyo Eats.',
      );
      return;
    }
    // Quality below 1 makes the picker hand back a JPEG (iPhone HEIC photos included).
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8 };
    const result = camera
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
    if (!result.canceled && result.assets[0]) setImage(result.assets[0]);
  };

  const submit = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      if (bankReference.trim()) form.append('bankReference', bankReference.trim());
      if (Platform.OS === 'web') {
        form.append('slip', await (await fetch(image!.uri)).blob(), 'slip.jpg');
      } else {
        // React Native's FormData takes a file descriptor object.
        form.append('slip', {
          uri: image!.uri,
          name: 'slip.jpg',
          type: image!.mimeType ?? 'image/jpeg',
        } as unknown as Blob);
      }
      await customerApi.uploadSlip(order.id, form);
    },
    onSuccess: async () => {
      setImage(null);
      await queryClient.invalidateQueries({ queryKey: keys.order(order.id) });
    },
  });

  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, '0');
  const pending = bt.slip?.status === 'pending';
  const asked =
    bt.slip && (bt.slip.status === 'resubmit_requested' || bt.slip.status === 'rejected');

  return (
    <View style={{ gap: 12 }}>
      {pending ? (
        <Alert
          tone="info"
          message="We're checking your slip, usually in under 5 minutes. The restaurant gets your order as soon as it's approved."
        />
      ) : bt.canUpload ? (
        <Alert message={`Upload your slip within ${mm}:${ss} or the order is cancelled.`} />
      ) : null}
      {asked ? (
        <Alert
          tone="danger"
          message={`We couldn't accept your slip: ${bt.slip!.reviewReason}. Please upload a new one.`}
        />
      ) : null}

      <View style={styles.amount}>
        <Text variant="label">Transfer exactly</Text>
        <Text style={styles.big}>{formatLkr(bt.amountCents)}</Text>
      </View>

      {bt.bankDetails ? (
        <Card style={{ gap: 0, paddingVertical: 6 }}>
          <CopyRow label="Bank" value={`${bt.bankDetails.bankName} · ${bt.bankDetails.branch}`} />
          <CopyRow label="Account name" value={bt.bankDetails.accountName} />
          <CopyRow label="Account number" value={bt.bankDetails.accountNumber} />
          <CopyRow label="Reference (put this in the remark)" value={bt.reference} green />
        </Card>
      ) : (
        <Alert
          tone="danger"
          message="Bank transfer details aren't set up yet. Please cancel and pay cash on delivery."
        />
      )}

      {bt.canUpload ? (
        <>
          {image ? (
            <Card style={{ alignItems: 'center' }}>
              <Image
                source={{ uri: image.uri }}
                style={styles.preview}
                resizeMode="contain"
                accessibilityLabel="Slip photo preview"
              />
              <Button
                variant="ghost"
                label="Choose a Different Photo"
                onPress={() => setImage(null)}
              />
            </Card>
          ) : (
            <View style={styles.upload}>
              <Icon name="image" size={28} />
              <Text variant="strong">Upload Slip Photo</Text>
              <Text variant="small">Camera or gallery · JPG or PNG</Text>
              <View style={styles.uploadButtons}>
                <Button
                  small
                  variant="secondary"
                  label="Take Photo"
                  onPress={() => void pick(true)}
                />
                <Button
                  small
                  variant="secondary"
                  label="From Gallery"
                  onPress={() => void pick(false)}
                />
              </View>
            </View>
          )}
          {pickError ? <Alert message={pickError} /> : null}
          <TextField
            label="Bank reference (optional)"
            value={bankReference}
            onChangeText={setBankReference}
            hint="The transaction number on your slip, if it has one."
          />
          {submit.error ? <Alert tone="danger" message={errorMessage(submit.error)} /> : null}
          <Button
            label="Submit Slip"
            onPress={() => submit.mutate()}
            loading={submit.isPending}
            disabled={!image}
          />
        </>
      ) : null}

      <View style={{ gap: 6 }}>
        <Text variant="label">What happens next</Text>
        <Text variant="muted">
          1. We check the slip (usually under 5 min). 2. The restaurant gets your order. 3. Tracking
          starts. Wrong amount? We'll ask you to upload again.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  amount: { alignItems: 'center', gap: 2, paddingVertical: 6 },
  big: { fontFamily: fonts.display600, fontSize: 30, lineHeight: 36, color: colors.strong },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  upload: {
    alignItems: 'center',
    gap: 6,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.control,
    backgroundColor: colors.card,
  },
  uploadButtons: { flexDirection: 'row', gap: 10, marginTop: 8 },
  preview: { width: '100%', height: 220, borderRadius: 12, backgroundColor: colors.photo },
});
