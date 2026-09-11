/** The floating pill. Everything it can lead to lives behind one press. */
import { WIDGET_ROOT_ATTR } from './capture.js';
import { Icon } from './icons.js';
import { useWidgetStrings } from './strings-context.js';
import { useWidgetStyles } from './styles/sheet.js';
import {
  accentStyle,
  launcherAnchor,
  themeAttrs,
  type LauncherPosition,
  type WidgetTheme,
} from './theme.js';

export interface LauncherProps {
  zIndex: number;
  theme: WidgetTheme;
  accent?: string;
  position: LauncherPosition;
  offset: number;
  label: string;
  /** A draft nobody can see is a draft nobody comes back to. */
  hasDraft: boolean;
  onClick: () => void;
}

export function Launcher(props: LauncherProps) {
  const strings = useWidgetStrings();
  useWidgetStyles();
  return (
    <div {...{ [WIDGET_ROOT_ATTR]: '' }} {...themeAttrs(props.theme)} style={accentStyle(props.accent)}>
      <button
        type="button"
        className="bd-launcher"
        style={{ zIndex: props.zIndex, ...launcherAnchor(props.position, props.offset) }}
        onClick={props.onClick}
      >
        <Icon name="bug" />
        {props.label}
        {props.hasDraft && (
          <span className="bd-launcher-dot" role="img" aria-label={strings.launcherDraftTitle} />
        )}
      </button>
    </div>
  );
}
