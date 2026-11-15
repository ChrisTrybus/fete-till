import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';
import { Body, Button, Card, Field, Heading, Label, useTheme } from '@/components/ui';
import { declarationProblems, declarationText, donationIn, giftAidOn, MAX_HOUSE, MAX_NAME } from '@/lib/giftaid';
import { formatPence } from '@/lib/money';
import { useStore } from '@/lib/store';
import type { Sale } from '@/lib/types';

/**
 * Asks whether a donor will Gift Aid their donation and, if so, takes their name and
 * address and has them agree to the declaration. Opened by the volunteer, from the
 * Add Gift Aid button the till shows after a larger donation or from the sale on Day
 * total. The sale is already saved, so closing this loses nothing.
 */
export function GiftAidPrompt({ sale, onDone }: { sale: Sale | null; onDone: (message: string | null) => void }) {
  return (
    <Modal visible={sale !== null} transparent animationType="fade" onRequestClose={() => onDone(null)}>
      {/* Remounted per sale, so one donor's details are never left in the boxes for the next. */}
      {sale && <PromptBody key={sale.id} sale={sale} onDone={onDone} />}
    </Modal>
  );
}

function PromptBody({ sale, onDone }: { sale: Sale; onDone: (message: string | null) => void }) {
  const t = useTheme();
  const { recordGiftAid, session } = useStore();
  const [step, setStep] = useState<'ask' | 'details'>('ask');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [house, setHouse] = useState('');
  const [postcode, setPostcode] = useState('');
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = donationIn(sale);
  const fields = { firstName, lastName, house, postcode };
  const problems = declarationProblems(fields);

  const save = () => {
    setTried(true);
    if (problems.length) return;
    try {
      recordGiftAid(sale.id, fields);
      onDone(`Gift Aid added: ${formatPence(giftAidOn(amount))} more for the charity.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save the declaration.');
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center' }}
    >
      <ScrollView contentContainerStyle={{ padding: 16, flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
        <Card style={{ maxWidth: 520, width: '100%', alignSelf: 'center' }}>
          {step === 'ask' ? (
            <>
              <Heading>Gift Aid it?</Heading>
              <Body>
                If the donor pays UK income tax, Gift Aid adds {formatPence(giftAidOn(amount))} to their {formatPence(amount)} donation, at
                no cost to them.
              </Body>
              <Body muted>It needs their name, house number and postcode. Only donations count, not things bought.</Body>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button title="No thanks" onPress={() => onDone(null)} style={{ flex: 1 }} />
                <Button title="Yes, add details" kind="primary" onPress={() => setStep('details')} style={{ flex: 2 }} />
              </View>
            </>
          ) : (
            <>
              <Heading>Gift Aid declaration</Heading>
              <Body muted>Hand the phone to the donor, or fill this in for them.</Body>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Label>First name</Label>
                  <Field accessibilityLabel="Donor’s first name" value={firstName} onChangeText={setFirstName} autoComplete="given-name" textContentType="givenName" maxLength={MAX_NAME} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Label>Last name</Label>
                  <Field accessibilityLabel="Donor’s last name" value={lastName} onChangeText={setLastName} autoComplete="family-name" textContentType="familyName" maxLength={MAX_NAME} />
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 3, gap: 4 }}>
                  <Label>House name or number</Label>
                  <Field accessibilityLabel="Donor’s house name or number" value={house} onChangeText={setHouse} maxLength={MAX_HOUSE} />
                </View>
                <View style={{ flex: 2, gap: 4 }}>
                  <Label>Postcode</Label>
                  <Field
                    accessibilityLabel="Donor’s postcode"
                    value={postcode}
                    onChangeText={setPostcode}
                    autoCapitalize="characters"
                    autoComplete="postal-code"
                    textContentType="postalCode"
                    maxLength={10}
                  />
                </View>
              </View>
              <View style={{ padding: 12, borderRadius: 10, backgroundColor: t.bg, gap: 4 }}>
                <Label>Declaration</Label>
                <Text style={{ color: t.ink, fontSize: 14, lineHeight: 20 }}>
                  {declarationText(formatPence(amount), session?.eventName ?? 'this charity')}
                </Text>
              </View>
              {tried && problems.length > 0 && <Text style={{ color: t.danger, fontWeight: '700' }}>{problems.join(' ')}</Text>}
              {error && <Text style={{ color: t.danger, fontWeight: '700' }}>{error}</Text>}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button title="Cancel" onPress={() => onDone(null)} style={{ flex: 1 }} />
                <Button title="Donor agrees" kind="primary" onPress={save} style={{ flex: 2 }} />
              </View>
            </>
          )}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
