import type React from "react";
import type { Auth, Config } from "../../runtime/config/schemas";
import type { ProviderConfig } from "../../runtime/models/catalog/main";
import type { ModelConnectionTester } from "./connection";

export type Model = Config["models"][number];
export type ValidationResult =
	| { valid: true }
	| { valid: false; error: string };

export type AddModelStep<T> = {
	title: string;
	prompt: string;
	defaultValue?: string;
	parse: (val: string) => T;
	validate: (val: string) => ValidationResult;
	onSubmit: (t: T) => unknown;
	children: React.ReactNode;
};

export type ModelStepRoute<T> = T & {
	renderExamples: boolean;
	done: (data: Model) => unknown;
	cancel: () => unknown;
	config: Config | null;
};

export type ModelMetadata = {
	name?: string;
	contextLength?: number;
	models?: Array<{ model: string; nickname: string; context?: number }>;
};

export type ProviderAuthRouteState = {
	baseUrl: string;
	provider?: ProviderConfig;
	env?: Record<string, string | undefined>;
};

export type AuthenticatedRouteState = ProviderAuthRouteState & {
	auth?: Auth;
};

export type SelectedModelRouteState = AuthenticatedRouteState & {
	model: string;
};

export type NicknamedModelRouteState = SelectedModelRouteState & {
	nickname: string;
	metadata: ModelMetadata;
};

export type BaseUrlFlowRouteData = {
	baseUrl: ModelStepRoute<unknown>;
};

export type AuthFlowRouteData = {
	authAsk: ModelStepRoute<ProviderAuthRouteState>;
	envVar: ModelStepRoute<ProviderAuthRouteState>;
	chatGptOAuth: ModelStepRoute<ProviderAuthRouteState>;
	command: ModelStepRoute<ProviderAuthRouteState>;
	apiKey: ModelStepRoute<ProviderAuthRouteState>;
};

export type ModelFlowRouteData = {
	postAuth: ModelStepRoute<AuthenticatedRouteState>;
	model: ModelStepRoute<AuthenticatedRouteState>;
	testConnection: ModelStepRoute<SelectedModelRouteState>;
	nickname: ModelStepRoute<
		SelectedModelRouteState & { metadata: ModelMetadata; nickname?: string }
	>;
	context: ModelStepRoute<NicknamedModelRouteState>;
};

export type FullFlowRouteData = BaseUrlFlowRouteData &
	AuthFlowRouteData &
	ModelFlowRouteData;

export type Transitions<T> = {
	back: () => void;
	onSubmit: (data: T) => void;
};

export type TestConnectionResult =
	| { valid: true; metadata: ModelMetadata }
	| { valid: false; errorMessage?: string };

export type MinConnectArgs = {
	model: string;
	auth?: Auth;
	baseUrl: string;
	provider?: ProviderConfig;
	config: Config | null;
	modelConnectionTest: ModelConnectionTester;
	env?: Record<string, string | undefined>;
};
