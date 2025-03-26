#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { Command } from "@commander-js/extra-typings";
import App from "./app.tsx";
import { readConfig, readMetadata } from "./config.ts";

const cli = new Command()
.option("--config <path>")
.action(async (opts) => {
	const config = await readConfig(opts.config);
	const metadata = await readMetadata();
	render(<App config={config} metadata={metadata} />);
});

cli.parse();
