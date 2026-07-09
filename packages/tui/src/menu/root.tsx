import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { useTerminalContentWidth } from "../layout/viewport";
import { normalizeRenderedLineBreaks } from "../render/lines";
import { Octo } from "../theme/branding";
import {
	ThemedSelectIndicator as IndicatorComponent,
	ThemedSelectItem as ItemComponent,
	SelectInput,
} from "./select";

export type MenuItem<V> = {
	label: string;
	value: V;
};

export type MenuHeaderProps = {
	title: string;
};

export type MenuPanelProps<V> = {
	items: MenuItem<V>[];
	onSelect: (item: MenuItem<V>) => unknown;
	title: string;
	children?: ReactNode;
};

export function MenuHeader({ title }: MenuHeaderProps) {
	const width = useTerminalContentWidth();

	return (
		<Box justifyContent="center" marginBottom={1}>
			<Box justifyContent="center" width={width}>
				<Octo />
				<Box marginLeft={1}>
					<Text>{normalizeRenderedLineBreaks(title)}</Text>
				</Box>
			</Box>
		</Box>
	);
}

export function MenuPanel<V>({
	items,
	onSelect,
	title,
	children,
}: MenuPanelProps<V>) {
	const width = useTerminalContentWidth();

	return (
		<Box flexDirection="column">
			<MenuHeader title={title} />
			{children && (
				<Box justifyContent="center" alignItems="center" marginBottom={1}>
					<Box flexDirection="column" width={width}>
						{children}
					</Box>
				</Box>
			)}
			<Box justifyContent="center">
				<SelectInput
					items={items}
					onSelect={onSelect}
					indicatorComponent={IndicatorComponent}
					itemComponent={ItemComponent}
				/>
			</Box>
		</Box>
	);
}
