import { configDefaultPaths } from "./agentd-config";

const paths = await configDefaultPaths();

export const PACKAGE_DIR = import.meta.dirname;
export const CONFIG_DIR = paths.configDir;
export const KEY_FILE = paths.keyFile;
export const CONFIG_FILE = paths.configFile;
