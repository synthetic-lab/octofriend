import type React from "react";
import type { Auth, Config } from "../../internal/configuration/schemas.ts";
import type { ModelConnectionTester } from "./add-model-connection.ts";

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
};

export type FullFlowRouteData = {
	baseUrl: ModelStepRoute<unknown>;
	authAsk: ModelStepRoute<{
		baseUrl: string;
	}>;
	envVar: ModelStepRoute<{
		baseUrl: string;
	}>;
	command: ModelStepRoute<{
		baseUrl: string;
	}>;
	apiKey: ModelStepRoute<{
		baseUrl: string;
	}>;
	postAuth: ModelStepRoute<{
		baseUrl: string;
		auth?: Auth;
	}>;
	model: ModelStepRoute<{
		baseUrl: string;
		auth?: Auth;
	}>;
	testConnection: ModelStepRoute<{
		baseUrl: string;
		auth?: Auth;
		model: string;
	}>;
	nickname: ModelStepRoute<{
		baseUrl: string;
		auth?: Auth;
		model: string;
		metadata: ModelMetadata;
		nickname?: string;
	}>;
	context: ModelStepRoute<{
		baseUrl: string;
		auth?: Auth;
		model: string;
		nickname: string;
		metadata: ModelMetadata;
	}>;
};

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
	config: Config | null;
	modelConnectionTest: ModelConnectionTester;
};
