import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

/**
 * Turns an HTML document into a PDF and opens the share sheet for it, so it can
 * be emailed, messaged or saved. In a browser there is no file to share, so the
 * document opens in a new tab with the print dialog, which can save as PDF.
 */
export async function sharePdf(html: string, title: string) {
  if (Platform.OS === 'web') {
    const w = window.open('', '_blank');
    if (!w) throw new Error('Allow pop-ups for this page to open the summary.');
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf', dialogTitle: title });
  } else {
    await Print.printAsync({ uri }); // no share sheet on this device: offer to print instead
  }
}
