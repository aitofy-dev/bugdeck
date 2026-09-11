/** Capture screen · Pick element · Upload, as one segmented group. */
import { useRef } from 'react';
import { Icon } from './icons.js';
import { ACCEPT_ATTRIBUTE } from './images.js';
import { useWidgetStrings } from './strings-context.js';

export interface EditorToolbarProps {
  capturing: boolean;
  onCapture: () => void;
  onPickRegion: () => void;
  onFiles: (files: File[]) => void;
}

export function EditorToolbar({ capturing, onCapture, onPickRegion, onFiles }: EditorToolbarProps) {
  const strings = useWidgetStrings();
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div className="bd-toolbar" role="group" aria-label={strings.editorHeading}>
      <button type="button" className="bd-seg" onClick={onCapture} disabled={capturing}>
        <Icon name="screen" />
        {/* Never "Recapture": each press adds a picture, it does not redo the last one. */}
        {capturing ? strings.capturing : strings.captureScreen}
      </button>
      <button type="button" className="bd-seg" onClick={onPickRegion} disabled={capturing}>
        <Icon name="target" />
        {strings.pickRegion}
      </button>
      <button type="button" className="bd-seg" onClick={() => fileInput.current?.click()}>
        <Icon name="upload" />
        {strings.uploadImage}
      </button>
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        className="bd-hidden-input"
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
    </div>
  );
}
