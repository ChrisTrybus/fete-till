// Touch feedback for the till. Volunteers often look at the customer, not the
// screen, so a tap they can feel confirms the item went in.
//
// Android uses the system haptic constants (no VIBRATE permission, and they
// respect the user's touch-feedback setting). Haptics are a nicety: failures
// (unsupported hardware, Low Power Mode, web) are swallowed.
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const run = (p: Promise<void>) => void p.catch(() => {});

/** A light tick: an item was added or a quantity changed. */
export function tapFeedback() {
  if (Platform.OS === 'android') run(Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Keyboard_Tap));
  else if (Platform.OS === 'ios') run(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** A firmer confirmation: the sale was saved. */
export function saleFeedback() {
  if (Platform.OS === 'android') run(Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm));
  else if (Platform.OS === 'ios') run(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}
