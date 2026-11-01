import { Linking } from 'react-native';

/** Opens the phone dialler. On web or a tablet without calling it does nothing harmful. */
export function call(e164: string) {
  void Linking.openURL(`tel:${e164}`).catch(() => undefined);
}

/** +94771234567 -> 077 123 4567 */
export function localPhone(e164: string): string {
  const d = e164.replace(/^\+94/, '0').replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : e164;
}
