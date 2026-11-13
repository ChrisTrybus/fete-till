import * as AppleAuthentication from 'expo-apple-authentication';
import { useColorScheme } from 'react-native';

/** Apple's own "Continue with Apple" button, which its guidelines ask for. iOS only. */
export function AppleButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  const dark = useColorScheme() === 'dark';
  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
      buttonStyle={dark ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
      cornerRadius={12}
      onPress={disabled ? () => {} : onPress}
      style={{ width: '100%', height: 50, opacity: disabled ? 0.4 : 1 }}
    />
  );
}
