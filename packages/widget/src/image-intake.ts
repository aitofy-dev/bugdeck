/** The three ways an image gets into the editor: dropped, dragged over, pasted. */
import { isAcceptedMime } from './images.js';

/** Images only. A dropped .zip must not read as "nothing happened". */
export function imagesFromDataTransfer(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  const files = transfer.files ? Array.from(transfer.files) : [];
  return files.filter((file) => isAcceptedMime(file.type) || file.type.startsWith('image/'));
}

/** True while a drag carries files — a dragged link or selection must not arm the dropzone. */
export function dragHasFiles(transfer: DataTransfer | null): boolean {
  if (!transfer) return false;
  const types = transfer.types ? Array.from(transfer.types) : [];
  return types.includes('Files');
}

/** The chord to show in the paste hint. Wrong platform, wrong key, dead hint. */
export function pasteShortcut(platform: string): string {
  return /mac|iphone|ipad/i.test(platform) ? '⌘V' : 'Ctrl+V';
}
