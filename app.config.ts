import type { ConfigContext, ExpoConfig } from 'expo/config';

// app.json holds the config. This adds Google sign-in's iOS URL scheme, which comes
// from the iOS OAuth client id in the environment (see .env.example). Without that id
// the plugin is left out: Android needs nothing from it, and on iOS Google sign-in is
// then not offered.
export default ({ config }: ConfigContext): ExpoConfig => {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
  const iosUrlScheme = iosClientId
    ? `com.googleusercontent.apps.${iosClientId.replace(/\.apps\.googleusercontent\.com$/, '')}`
    : null;
  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      ...(iosUrlScheme ? [['@react-native-google-signin/google-signin', { iosUrlScheme }] as [string, object]] : []),
    ],
  } as ExpoConfig;
};
