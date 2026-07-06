import { createContext } from "react";

export const errorContext = createContext<{
	setErrorMessage: (message: string) => unknown;
	errorMessage: string;
}>({
	errorMessage: "",
	setErrorMessage: () => undefined,
});
