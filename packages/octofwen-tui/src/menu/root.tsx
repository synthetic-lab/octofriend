import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { Octo } from "../theme/branding.tsx";
import {
	ThemedSelectIndicator as IndicatorComponent,
	ThemedSelectItem as ItemComponent,
	SelectInput,
} from "./select.tsx";

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
	return (
		<Box justifyContent="center" marginBottom={1}>
			<Box justifyContent="center" width={80}>
				<Octo />
				<Box marginLeft={1}>
					<Text>{title}</Text>
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
	return (
		<Box flexDirection="column">
			<MenuHeader title={title} />
			{children && (
				<Box justifyContent="center" alignItems="center" marginBottom={1}>
					<Box flexDirection="column" width={80}>
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
