import {
	ConfirmDialog as ConfirmDialogImpl,
	type ConfirmDialogProps as ConfirmDialogPropsType,
	type KbPanelProps as KbPanelPropsType,
	KbShortcutPanel as KbShortcutPanelImpl,
} from "./shortcut-panels.tsx";
import {
	type KbSelectProps as KbSelectPropsType,
	KbShortcutSelect as KbShortcutSelectImpl,
} from "./shortcut-select.tsx";

export type {
	AutolistShortcutType,
	Hotkey,
	Item,
	Keymap,
	MapShortcutType,
	ShortcutArray,
} from "./shortcut-render.ts";

export type KbSelectProps<V> = KbSelectPropsType<V>;
export type KbPanelProps<V> = KbPanelPropsType<V>;
export type ConfirmDialogProps = ConfirmDialogPropsType;

export const KbShortcutSelect = KbShortcutSelectImpl;
export const KbShortcutPanel = KbShortcutPanelImpl;
export const ConfirmDialog = ConfirmDialogImpl;
