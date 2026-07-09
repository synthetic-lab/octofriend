import type { AppStateGet, AppStateSet, UiState } from "./types";

export function createWhitelistActions(set: AppStateSet, get: AppStateGet) {
	return {
		addToWhitelist: async (whitelistKey: string) => {
			await Promise.resolve();
			const currentWhitelist = get().whitelist;
			const newWhitelist = new Set(currentWhitelist);
			newWhitelist.add(whitelistKey);
			set({ whitelist: newWhitelist });
		},

		isWhitelisted: async (whitelistKey: string) => {
			await Promise.resolve();
			return get().whitelist.has(whitelistKey);
		},
	} satisfies Pick<UiState, "addToWhitelist" | "isWhitelisted">;
}
