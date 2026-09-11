/** The floating bar over the drawing canvas: tools, colours, undo, save. */
import { ANNOTATE_COLORS, type AnnotateTool } from './annotate.js';
import { Icon, type IconName } from './icons.js';
import { useWidgetStrings } from './strings-context.js';
import type { WidgetStringKey } from './strings.js';

/** One row: what the tool is called, what it looks like, and the key that picks it. */
export const ANNOTATE_TOOLS: ReadonlyArray<{
  id: AnnotateTool;
  label: WidgetStringKey;
  icon: IconName;
  shortcut: string;
}> = [
  { id: 'pen', label: 'toolPen', icon: 'pen', shortcut: 'P' },
  { id: 'rect', label: 'toolRect', icon: 'square', shortcut: 'R' },
  { id: 'arrow', label: 'toolArrow', icon: 'arrow', shortcut: 'A' },
  { id: 'crop', label: 'toolCrop', icon: 'crop', shortcut: 'C' },
];

export interface AnnotateToolbarProps {
  tool: AnnotateTool;
  color: string;
  canUndo: boolean;
  canApplyCrop: boolean;
  ready: boolean;
  onTool: (tool: AnnotateTool) => void;
  onColor: (color: string) => void;
  onApplyCrop: () => void;
  onUndo: () => void;
  onCancel: () => void;
  onSave: () => void;
}

export function AnnotateToolbar(props: AnnotateToolbarProps) {
  const strings = useWidgetStrings();
  return (
    <div className="bd-atools" role="toolbar" aria-label={strings.annotate}>
      {ANNOTATE_TOOLS.map((item) => (
        <button
          key={item.id}
          type="button"
          className="bd-atool"
          aria-pressed={props.tool === item.id}
          onClick={() => props.onTool(item.id)}
        >
          <Icon name={item.icon} />
          {strings[item.label]}
          <span className="bd-akbd">{item.shortcut}</span>
        </button>
      ))}
      <span className="bd-sep" />
      {ANNOTATE_COLORS.map((swatch) => (
        <button
          key={swatch.value}
          type="button"
          className="bd-swatch"
          style={{ background: swatch.value }}
          aria-label={strings[swatch.label]}
          aria-pressed={props.color === swatch.value}
          onClick={() => props.onColor(swatch.value)}
        />
      ))}
      <span className="bd-sep" />
      {props.tool === 'crop' && (
        <button
          type="button"
          className="bd-atool"
          aria-pressed={true}
          disabled={!props.canApplyCrop}
          onClick={props.onApplyCrop}
        >
          <Icon name="crop" />
          {strings.applyCrop}
        </button>
      )}
      <button
        type="button"
        className="bd-atool"
        disabled={!props.canUndo}
        onClick={props.onUndo}
      >
        <Icon name="undo" />
        {strings.undo}
      </button>
      <button type="button" className="bd-atool" onClick={props.onCancel}>
        {strings.cancel}
      </button>
      <button
        type="button"
        className="bd-btn bd-btn--primary"
        disabled={!props.ready}
        onClick={props.onSave}
      >
        {strings.save}
      </button>
    </div>
  );
}
