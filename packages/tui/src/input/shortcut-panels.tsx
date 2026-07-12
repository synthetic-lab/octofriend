import { Box, Text } from "ink";
import { type ReactNode, useCallback, useMemo } from "react";
import { normalizeRenderedLineBreaks } from "../render/lines.ts";
import { Octo } from "../theme/branding.tsx";
import type { Item, ShortcutArray } from "./shortcut-render.ts";
import { KbShortcutSelect } from "./shortcut-select.tsx";

export type KbPanelProps<V> = {
	shortcutItems: ShortcutArray<V>;
	onSelect: (item: Item<V>) => unknown;
	title: string;
	children?: ReactNode;
};

function ShortcutMenuHeader({ title }: { title: string }) {
	return (
		<Box justifyContent="center" marginBottom={1}>
			<Box justifyContent="center" width={80}>
				<Octo />
				<Box marginLeft={1}>
					<Text>{normalizeRenderedLineBreaks(title)}</Text>
				</Box>
			</Box>
		</Box>
	);
}

export function KbShortcutPanel<V>({
	shortcutItems,
	onSelect,
	title,
	children,
}: KbPanelProps<V>) {
	return (
		<Box flexDirection="column">
			<ShortcutMenuHeader title={title} />
			{children && (
				<Box justifyContent="center" alignItems="center" marginBottom={1}>
					<Box flexDirection="column" width={80}>
						{children}
					</Box>
				</Box>
			)}
			<Box justifyContent="center">
				<KbShortcutSelect shortcutItems={shortcutItems} onSelect={onSelect} />
			</Box>
		</Box>
	);
}

export type ConfirmDialogProps = {
	confirmLabel: string;
	rejectLabel: string;
	onConfirm: () => unknown;
	onReject: () => unknown;
	rejectFirst?: boolean;
};

export function ConfirmDialog({
	confirmLabel,
	rejectLabel,
	onConfirm,
	onReject,
	rejectFirst = false,
}: ConfirmDialogProps) {
	const items = useMemo(
		() =>
			[
				{
					type: "key" as const,
					mapping: rejectFirst
						? {
								n: { label: rejectLabel, value: "reject" as const },
								y: { label: confirmLabel, value: "confirm" as const },
							}
						: {
								y: { label: confirmLabel, value: "confirm" as const },
								n: { label: rejectLabel, value: "reject" as const },
							},
				},
			] satisfies ShortcutArray<"confirm" | "reject">,
		[confirmLabel, rejectFirst, rejectLabel],
	);

	const onSelect = useCallback(
		(item: Item<"confirm" | "reject">) => {
			if (item.value === "confirm") return onConfirm();
			return onReject();
		},
		[onConfirm, onReject],
	);

	return (
		<Box justifyContent="center">
			<KbShortcutSelect shortcutItems={items} onSelect={onSelect} />
		</Box>
	);
}
