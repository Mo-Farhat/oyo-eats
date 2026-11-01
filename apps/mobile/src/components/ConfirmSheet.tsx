import { View } from 'react-native';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { Text } from './Text';

/** In-app confirmation (native alerts don't exist on web and can't be themed). */
export function ConfirmSheet({
  visible,
  title,
  message,
  confirmLabel,
  danger,
  loading,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onCancel}>
      <View style={{ gap: 8 }}>
        <Text variant="h2" accessibilityRole="header">
          {title}
        </Text>
        <Text variant="lede">{message}</Text>
      </View>
      <Button
        label={confirmLabel}
        variant={danger ? 'danger' : 'primary'}
        onPress={onConfirm}
        loading={loading}
      />
      <Button label="Keep" variant="secondary" onPress={onCancel} />
    </Sheet>
  );
}
