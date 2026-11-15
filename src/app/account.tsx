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
import { buyPack, packPrices, PACKS, purchasesAvailable, syncPurchases, useCredits, type PackId } from '@/lib/packs';
import { useStore } from '@/lib/store';

const METHOD_LABEL: Record<SignInMethod, string> = { password: 'email and password', google: 'Google', apple: 'Apple' };

/** Signing in to a Cash Tin account, which will hold event packs and saved price lists. */
export default function AccountScreen() {
  const t = useTheme();
  const store = useStore();
  const { ready, account } = useAccount();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>, done?: string | (() => string | undefined)) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      const message = typeof done === 'function' ? done() : done;
      if (message) setNotice(message);
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
            <SignedIn account={account} busy={busy} run={run} />
          ) : (
            <SignedOut busy={busy} run={run} />
          )}

          {notice && <Text style={{ color: t.accent, fontWeight: '700' }}>{notice}</Text>}
          {error && <Text style={{ color: t.danger, fontWeight: '700' }}>{error}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type Run = (fn: () => Promise<unknown>, done?: string | (() => string | undefined)) => Promise<void>;

/** The account's event credits, and buying more. */
function Packs({ uid, busy, run }: { uid: string; busy: boolean; run: Run }) {
  const t = useTheme();
  const credits = useCredits(uid);
  const [prices, setPrices] = useState<Record<PackId, string> | null>(null);

  useEffect(() => {
    let current = true;
    packPrices().then((p) => current && setPrices(p));
    // Count anything bought before that didn't reach the server (no signal at the time).
    if (purchasesAvailable) syncPurchases().catch(() => {});
    return () => {
      current = false;
    };
  }, [uid]);

  const left = credits?.credits ?? 0;
  return (
    <Card>
      <Label>Event packs</Label>
      {credits === null ? (
        <ActivityIndicator color={t.accent} />
      ) : (
        <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800' }}>
          {left === 0 ? 'No events left' : `${left} ${left === 1 ? 'event' : 'events'} left`}
        </Text>
      )}
      <Body muted>Each event with several tills uses one. Events on just this phone are always free.</Body>
      {purchasesAvailable ? (
        <>
          {PACKS.map((p) => (
            <Button
              key={p.id}
              title={`${p.events === 1 ? '1 event' : `${p.events} events`} · ${prices?.[p.id] ?? p.fallbackPrice}`}
              kind={p.events > 1 ? 'primary' : 'plain'}
              disabled={busy || !prices}
              onPress={() => {
                let outcome: Awaited<ReturnType<typeof buyPack>> = 'cancelled';
                run(
                  async () => {
                    outcome = await buyPack(p.id);
                  },
                  () =>
                    outcome === 'counted'
                      ? `Added ${p.events === 1 ? '1 event' : `${p.events} events`} to your account.`
                      : outcome === 'paid'
                        ? 'Your purchase went through. It will be added when you have signal: tap “Check for purchases”.'
                        : undefined,
                );
              }}
            />
          ))}
          <Button
            title="Check for purchases"
            disabled={busy}
            onPress={() => {
              let added = 0;
              run(
                async () => {
                  added = (await syncPurchases()).added;
                },
                () => (added ? `Added ${added === 1 ? '1 event' : `${added} events`} from earlier purchases.` : 'Everything you’ve bought is already counted.'),
              );
            }}
          />
        </>
      ) : (
        <Body muted>Buy event packs in the Cash Tin app on your phone.</Body>
      )}
    </Card>
  );
}

function SignedOut({ busy, run }: { busy: boolean; run: Run }) {
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

  const existing = mode === 'existing';
  const canSubmit = !busy && email.trim().length > 3 && password.length >= (existing ? 1 : MIN_PASSWORD);

  return (
    <>
      <Card>
        <Body>
          An account keeps your event packs and saved price lists, so you still have them on a new phone or after reinstalling the
          app. You don’t need one to run a till.
        </Body>
        {providers.includes('apple') && <AppleButton disabled={busy} onPress={() => run(() => signInWithProvider('apple'))} />}
        {providers.includes('google') && (
          <Button title="Continue with Google" disabled={busy} onPress={() => run(() => signInWithProvider('google'))} />
        )}
      </Card>

      <Card>
        <Label>Email and password</Label>
        <Choice
          value={mode}
          onChange={setMode}
          options={[
            { value: 'new', title: 'New account' },
            { value: 'existing', title: 'I have an account' },
          ]}
        />
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
            existing ? run(() => signInWithEmail(email, password)) : run(() => createEmailAccount(email, password))
          }
        />
        {existing && (
          <Button
            title="Forgot password"
            disabled={busy}
            onPress={() => run(() => sendPasswordReset(email), `If there’s an account for ${email.trim()}, we’ve emailed a link to reset its password.`)}
          />
        )}
      </Card>
    </>
  );
}

function SignedIn({ account, busy, run }: { account: Account; busy: boolean; run: Run }) {
  const t = useTheme();
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

      <Packs uid={account.uid} busy={busy} run={run} />

      <Card>
        <Body muted>Signing out doesn’t affect any event this phone is in, or its past events.</Body>
        <Button title="Sign out" disabled={busy} onPress={() => run(signOutAccount)} />
        <Button
          title={confirmDelete ? 'Tap again to delete for good' : 'Delete account'}
          kind="danger"
          disabled={busy}
          onPress={() => {
            if (!confirmDelete) return setConfirmDelete(true);
            setConfirmDelete(false);
            run(deleteAccount, 'Your account has been deleted.');
          }}
        />
        {confirmDelete && <Body muted>Any event credits left on the account go with it.</Body>}
      </Card>
    </>
  );
}
