import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppleButton } from '@/components/apple-button';
import { Body, Bunting, Button, Card, Choice, Field, Heading, Label, useTheme } from '@/components/ui';
import {
  availableProviders,
  createEmailAccount,
  deleteAccount,
  MIN_PASSWORD,
  reloadAccount,
  resendVerification,
  sendPasswordReset,
  signInWithEmail,
  signInWithProvider,
  signOutAccount,
  useAccount,
  type Account,
  type Provider,
  type SignInMethod,
} from '@/lib/account';
import { accountErrorMessage } from '@/lib/account-errors';
import { useStore } from '@/lib/store';

const METHOD_LABEL: Record<SignInMethod, string> = { password: 'email and password', google: 'Google', apple: 'Apple' };

/** Signing in to a Cash Tin account, which will hold event packs and saved price lists. */
export default function AccountScreen() {
  const t = useTheme();
  const store = useStore();
  const { ready, account } = useAccount();
  const ctx = { inSharedEvent: store.session?.mode === 'cloud' };

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
    } catch (e) {
      setError(accountErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <Bunting />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <Heading>Account</Heading>
            <Button title="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={{ paddingVertical: 8 }} />
          </View>

          {!store.cloudEnabled ? (
            <Card>
              <Body muted>Accounts need sync, which isn’t set up in this version of the app.</Body>
            </Card>
          ) : !ready ? (
            <ActivityIndicator color={t.accent} />
          ) : account ? (
            <SignedIn account={account} busy={busy} run={run} inSharedEvent={ctx.inSharedEvent} />
          ) : (
            <SignedOut busy={busy} run={run} inSharedEvent={ctx.inSharedEvent} />
          )}

          {notice && <Text style={{ color: t.accent, fontWeight: '700' }}>{notice}</Text>}
          {error && <Text style={{ color: t.danger, fontWeight: '700' }}>{error}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type Run = (fn: () => Promise<unknown>, done?: string) => Promise<void>;

function SignedOut({ busy, run, inSharedEvent }: { busy: boolean; run: Run; inSharedEvent: boolean }) {
  const ctx = { inSharedEvent };
  const [providers, setProviders] = useState<Provider[]>([]);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    let current = true;
    availableProviders()
      .then((p) => current && setProviders(p))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);

  // In a shared event only a new account can be made: signing in to another would change this phone's id.
  const existing = mode === 'existing' && !inSharedEvent;
  const canSubmit = !busy && email.trim().length > 3 && password.length >= (existing ? 1 : MIN_PASSWORD);

  return (
    <>
      <Card>
        <Body>
          An account keeps your event packs and saved price lists, so you still have them on a new phone or after reinstalling the
          app. You don’t need one to run a till.
        </Body>
        {providers.includes('apple') && <AppleButton disabled={busy} onPress={() => run(() => signInWithProvider('apple', ctx))} />}
        {providers.includes('google') && (
          <Button title="Continue with Google" disabled={busy} onPress={() => run(() => signInWithProvider('google', ctx))} />
        )}
      </Card>

      <Card>
        <Label>Email and password</Label>
        {!inSharedEvent && (
          <Choice
            value={mode}
            onChange={setMode}
            options={[
              { value: 'new', title: 'New account' },
              { value: 'existing', title: 'I have an account' },
            ]}
          />
        )}
        <Field
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          accessibilityLabel="Email"
        />
        <Field
          value={password}
          onChangeText={setPassword}
          placeholder={existing ? 'Password' : `Password (at least ${MIN_PASSWORD} characters)`}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={existing ? 'current-password' : 'new-password'}
          textContentType={existing ? 'password' : 'newPassword'}
          accessibilityLabel="Password"
        />
        <Button
          title={busy ? 'Please wait…' : existing ? 'Sign in' : 'Create account'}
          kind="primary"
          disabled={!canSubmit}
          onPress={() =>
            existing ? run(() => signInWithEmail(email, password, ctx)) : run(() => createEmailAccount(email, password, ctx))
          }
        />
        {existing && (
          <Button
            title="Forgot password"
            disabled={busy}
            onPress={() => run(() => sendPasswordReset(email), `If there’s an account for ${email.trim()}, we’ve emailed a link to reset its password.`)}
          />
        )}
        {inSharedEvent && (
          <Body muted>
            This phone is in a shared event, so you can make a new account now. To sign in to an account you already have, leave the
            event first.
          </Body>
        )}
      </Card>
    </>
  );
}

function SignedIn({ account, busy, run, inSharedEvent }: { account: Account; busy: boolean; run: Run; inSharedEvent: boolean }) {
  const t = useTheme();
  const ctx = { inSharedEvent };
  const [confirmDelete, setConfirmDelete] = useState(false);
  const via = account.methods.map((m) => METHOD_LABEL[m]).join(' or ') || 'an account';

  return (
    <>
      <Card>
        <Label>Signed in</Label>
        <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800' }}>{account.name || account.email || 'Your account'}</Text>
        {account.name && account.email && <Body muted>{account.email}</Body>}
        <Body muted>Signs in with {via}.</Body>
      </Card>

      {!account.emailVerified && (
        <Card>
          <Label>Confirm your email</Label>
          <Body muted>We’ve sent a link to {account.email}. Open it to confirm this is your address.</Body>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="I’ve confirmed it" disabled={busy} onPress={() => run(reloadAccount)} style={{ flex: 1 }} />
            <Button
              title="Send again"
              disabled={busy}
              onPress={() => run(resendVerification, `Sent another link to ${account.email}.`)}
              style={{ flex: 1 }}
            />
          </View>
        </Card>
      )}

      <Card>
        <Body muted>
          {inSharedEvent
            ? 'This phone is in a shared event. Leave it before signing out or deleting your account.'
            : 'Signing out leaves this phone’s past events where they are.'}
        </Body>
        <Button title="Sign out" disabled={busy || inSharedEvent} onPress={() => run(() => signOutAccount(ctx))} />
        <Button
          title={confirmDelete ? 'Tap again to delete for good' : 'Delete account'}
          kind="danger"
          disabled={busy || inSharedEvent}
          onPress={() => {
            if (!confirmDelete) return setConfirmDelete(true);
            setConfirmDelete(false);
            run(() => deleteAccount(ctx), 'Your account has been deleted.');
          }}
        />
      </Card>
    </>
  );
}
