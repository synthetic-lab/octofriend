import React, { useCallback, useState } from "react";
import { create } from "zustand";
import { guard, statematch, fallback } from "statematch";
import { Text, Box, useInput } from "ink";
import SelectInput from "ink-select-input";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "./state.ts";
import { useConfig, useSetConfig, Config } from "./config.ts";
import { Octo } from "./components/octo.tsx";
import { useColor } from "./theme.ts";
import { IndicatorComponent, ItemComponent } from "./components/select.tsx";
import TextInput from "ink-text-input";

type MenuMode = "main-menu"
              | "model-select"
              | "add-model"
              ;
type MenuState = {
  menuMode: MenuMode,
  setMenuMode: (mode: MenuMode) => void,
};

const useMenuState = create<MenuState>((set, _) => ({
  menuMode: "main-menu",
  setMenuMode: menuMode => {
    set({ menuMode });
  },
}));

export function Menu() {
  const { menuMode } = useMenuState(useShallow(state => ({
    menuMode: state.menuMode,
  })));

  if(menuMode === "main-menu") return <MainMenu />
  if(menuMode === "model-select") return <SwitchModelMenu />
  return <AddModelFlow />
}

function SwitchModelMenu() {
  const { setModelOverride, toggleMenu } = useAppStore(useShallow(state => ({
    setModelOverride: state.setModelOverride,
    toggleMenu: state.toggleMenu,
  })));

  const { setMenuMode } = useMenuState(useShallow(state => ({
    setMenuMode: state.setMenuMode,
  })));

  const config = useConfig();

  useInput((_, key) => {
    if(key.escape) setMenuMode("main-menu");
  });

  const items = [
    ...config.models.map(model => {
      return {
        label: model.nickname,
        value: `model-${model.nickname}`,
      };
    }),
    {
      label: "Back to main menu",
      value: "back",
    },
  ];

	const onSelect = useCallback(async (item: (typeof items)[number]) => {
    if(item.value === "back") {
      setMenuMode("main-menu");
      return;
    }

    setModelOverride(item.value.replace("model-", ""));
    setMenuMode("main-menu");
    toggleMenu();
	}, []);

  return <MenuPanel items={items} onSelect={onSelect} />
}

function MainMenu() {
  const { toggleMenu } = useAppStore(
    useShallow(state => ({
      toggleMenu: state.toggleMenu,
    }))
  );

  const { setMenuMode } = useMenuState(useShallow(state => ({
    setMenuMode: state.setMenuMode,
  })));

  useInput((_, key) => {
    if(key.escape) toggleMenu();
  });

  const items = [
    {
      label: "Switch model",
      value: "switch-model" as const,
    },
    {
      label: "Add a new model",
      value: "add-model" as const,
    },
    {
      label: "Return to Octo",
      value: "return" as const,
    },
  ];

	const onSelect = useCallback((item: (typeof items)[number]) => {
    statematch([
      guard(() => item.value === "switch-model").run(() => {
        setMenuMode("model-select");
      }),
      guard(() => item.value === "add-model").run(() => {
        setMenuMode("add-model");
      }),
      fallback(() => {
        toggleMenu();
      }),
    ]);
	}, []);

  return <MenuPanel items={items} onSelect={onSelect} />
}

type Item<V> = {
  label: string,
  value: V,
}
type MenuPanelProps<V> = {
  items: Array<Item<V>>,
  readonly onSelect: (item: Item<V>) => any,
};

function MenuPanel<V>({ items, onSelect }: MenuPanelProps<V>) {
  return <Box flexDirection="column">
    <Box justifyContent="center">
      <Octo />
      <Box marginLeft={1}>
        <Text>Menu</Text>
      </Box>
    </Box>
    <Box justifyContent="center" marginTop={1}>
      <SelectInput
        items={items}
        onSelect={onSelect}
        indicatorComponent={IndicatorComponent}
        itemComponent={ItemComponent}
      />
    </Box>
  </Box>
}

type ModelVar = keyof (Config["models"][number]);
type AddModelStep<T extends ModelVar> = {
  title: string,
  description: (themeColor: string) => React.ReactNode,
  prompt: string,
  varname: T,
  parse: (val: string) => Config["models"][number][T],
  validate: (val: string) => { valid: true } | { valid: false, error: string },
};

const MODEL_STEPS = [
  {
    title: "What's the base URL for the API you're connecting to?",
    prompt: "Base URL:",
    description: () => {
      return <Box flexDirection="column">
        <Text>
          (For example, https://api.synthetic.new/v1)
        </Text>
        <Text>
          You can usually find this information in your inference provider's documentation.
        </Text>
      </Box>
    },
    varname: "baseUrl",
    parse(val) {
      return val;
    },
    validate: () => ({ valid: true }),
  } satisfies AddModelStep<"baseUrl">,
  {
    title: "What environment variable should Octo read to get the API key?",
    prompt: "Environment variable name:",
    description: () => {
      return <Box flexDirection="column">
        <Text>
          (For example, SYNTHETIC_API_KEY)
        </Text>
        <Text>
          You can typically find your API key on your account or settings page on your
          inference provider's website.
        </Text>
        <Text>
          For Synthetic, go to: https://synthetic.new/user-settings/api
        </Text>
        <Text>
          After getting an API key, make sure to export it in your shell; for example:
        </Text>
        <Text bold>
          export SYNTHETIC_API_KEY="your-api-key-here"
        </Text>
        <Text>
          (If you're running a local LLM, you can use any non-empty env var.)
        </Text>
      </Box>
    },
    varname: "apiEnvVar",
    parse(val) {
      return val;
    },
    validate(val) {
      if(process.env[val]) return { valid: true };
      return {
        valid: false,
        error: `
Env var ${val} isn't defined in your current shell. Do you need to re-source your .bashrc or .zshrc?
        `.trim(),
      };
    },
  } satisfies AddModelStep<"apiEnvVar">,
  {
    title: "What's the model string for the API you're using?",
    prompt: "Model string:",
    varname: "model",
    description() {
      return <Box flexDirection="column">
        <Text>
          (For example, with Synthetic, you could use hf:deepseek-ai/DeepSeek-R1-0528)
        </Text>
        <Text>
          This varies by inference provider: you can typically find this information in your
          inference provider's documentation.
        </Text>
      </Box>
    },
    parse(val) {
      return val;
    },
    validate: () => ({ valid: true }),
  } satisfies AddModelStep<"model">,
  {
    title: "Let's give this model a nickname so we can easily reference it later.",
    prompt: "Nickname:",
    varname: "nickname",
    description() {
      return <Box flexDirection="column">
        <Text>
          For example, if this was set up to talk to DeepSeek-V3-0324, you might want to call it
          that.
        </Text>
      </Box>
    },
    parse(val) {
      return val;
    },
    validate: () => ({ valid: true }),
  } satisfies AddModelStep<"nickname">,
  {
    title: "What's the maximum number of tokens Octo should use per request?",
    prompt: "Maximum tokens:",
    varname: "context",
    description() {
      const color = useColor();

      return <Box flexDirection="column">
        <Text>
          You can usually find this information in the documentation for the model on your inference
          company's website.
        </Text>
        <Text>
          (This is an estimate: leave some buffer room. Best performance is often at half the number
          of tokens supported by the API.)
        </Text>
        <Text>
          Format the number in k: for example,
          { " " }
          <Text color={color}>32k</Text>
          { " " }
          or,
          { " " }
          <Text color={color}>64k</Text>.
        </Text>
      </Box>
    },
    parse(val) {
      return parseInt(val.replace("k", ""), 10) * 1024;
    },
    validate(value) {
      if(value.replace("k", "").match(/^\d+$/)) return { valid: true };
      return {
        valid: false,
        error: "Couldn't parse your input as a number: please try again",
      };
    },
  } satisfies AddModelStep<"context">,
];

// Assert all model variables have defined steps. This will cause compiler errors if not all steps
// are defined
type DefinedVarnames = (typeof MODEL_STEPS)[number]["varname"];
function checkCovered(_: DefinedVarnames) {}
function _assertCovered(x: ModelVar) {
  checkCovered(x);
}

function AddModelFlow() {
  const [ errorMessage, setErrorMessage ] = useState<null | string>(null);
  const [ modelProgress, setModelProgress ] = useState<Partial<Config["models"][number]>>({});
  const [ stepVar, setStepVar ] = useState<ModelVar>(MODEL_STEPS[0].varname);
  const [ varValue, setVarValue ] = useState<string>("");
  const currentStep = MODEL_STEPS.find(step => step.varname === stepVar)!;

  const onValueChange = useCallback((value: string) => {
    setErrorMessage("");
    setVarValue(value);
  }, [currentStep]);

  const config = useConfig();
  const setConfig = useSetConfig();
  const { setMenuMode } = useMenuState(useShallow(state => ({
    setMenuMode: state.setMenuMode,
  })));

  const onSubmit = useCallback(() => {
    const trimmed = varValue.trim();
    const validationResult = currentStep.validate(trimmed);
    if(!validationResult.valid) {
      setVarValue("");
      setErrorMessage(validationResult.error);
      return;
    }

    let parsed = currentStep.parse(trimmed);
    if(currentStep.varname === "model") {
      if(modelProgress["baseUrl"] === "https://api.synthetic.new/v1") {
        if(!(parsed as string).startsWith("hf:")) {
          setVarValue("");
          setErrorMessage(`
Synthetic model names need to be prefixed with "hf:" (without the quotes)
          `.trim());
          return;
        }
      }
    }

    const newModelProgress = {
      ...modelProgress,
      [ currentStep.varname ]: parsed,
    };
    setModelProgress(newModelProgress);
    setVarValue("");
    const index = MODEL_STEPS.indexOf(currentStep);
    if(index < MODEL_STEPS.length - 1) {
      setStepVar(MODEL_STEPS[index + 1].varname);
    }
    else {
      setConfig({
        ...config,
        models: [
          ...config.models,
          newModelProgress as Config["models"][number],
        ],
      });
      setMenuMode("model-select");
    }
  }, [ currentStep, MODEL_STEPS, varValue ]);

  const themeColor = useColor();


  useInput((_, key) => {
    if(key.escape) {
      const index = MODEL_STEPS.indexOf(currentStep);
      if(index <= 0) {
        setMenuMode("main-menu");
      }
      else {
        setVarValue("");
        setStepVar(MODEL_STEPS[index - 1].varname);
      }
    }
  });

  return <Box flexDirection="column" justifyContent="center" alignItems="center" marginTop={1}>
    <Box flexDirection="column" width={80}>
      <Text color={themeColor}>{ currentStep.title }</Text>
      <currentStep.description />
    </Box>

    <Box marginTop={1} width={80}>
      <Box marginRight={1}>
        <Text>{currentStep.prompt}</Text>
      </Box>

      <TextInput value={varValue} onChange={onValueChange} onSubmit={onSubmit} />
    </Box>

    {
      errorMessage && <Box width={80}>
        <Text color="red" bold>{ errorMessage }</Text>
      </Box>
    }
  </Box>
}
