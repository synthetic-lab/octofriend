import React, { useState, useCallback, useEffect, createContext, useContext } from "react";
import { t } from "structural";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { Config, assertKeyForModel } from "../config.ts";
import { useColor } from "../theme.ts";
import OpenAI from "openai";
import { trackTokens } from "../token-tracker.ts";
import { SetApiKey } from "./set-api-key.tsx";
import { MenuPanel } from "./menu-panel.tsx";
import { router, Back } from "../router.tsx";
import { PROVIDERS } from "./providers.ts";

type Model = Config["models"][number];
type ValidationResult = { valid: true } | { valid: false, error: string };

type AddModelStep<T> = {
  title: string;
  prompt: string;
  parse: (val: string) => T;
  validate: (val: string) => ValidationResult;
  onSubmit: (t: T) => any,
  children: React.ReactNode;
};

type ModelStepRoute<T> = T & {
  renderExamples: boolean,
  done: (data: Model) =>  any,
  cancel: () => any,
};

type FullFlowRouteData = {
  baseUrl: ModelStepRoute<{}>,
  authAsk: ModelStepRoute<{
    baseUrl: string,
  }>,
  envVar: ModelStepRoute<{
    baseUrl: string,
  }>,
  apiKey: ModelStepRoute<{
    baseUrl: string,
  }>,
  postAuth: ModelStepRoute<{
    baseUrl: string,
    envVar?: string,
  }>,
  model: ModelStepRoute<{
    baseUrl: string,
    envVar?: string,
  }>,
  testConnection: ModelStepRoute<{
    baseUrl: string,
    envVar?: string,
    model: string,
  }>,
  nickname: ModelStepRoute<{
    baseUrl: string,
    envVar?: string,
    model: string,
  }>,
  context: ModelStepRoute<{
    baseUrl: string,
    envVar?: string,
    model: string,
    nickname: string,
  }>,
};

const errorContext = createContext<{
  setErrorMessage: (m: string) => any,
  errorMessage: string,
}>({
  errorMessage: "",
  setErrorMessage: () => {},
});

const fullFlow = router<FullFlowRouteData>();

const baseUrl = fullFlow.withRoutes(
  "authAsk", "baseUrl"
).build("baseUrl", to => props => {
  return <Back go={props.cancel}>
    <Step<string>
      title="What's the base URL for the API you're connecting to?"
      prompt="Base URL:"
      parse={val => val}
      validate={() => ({ valid: true })}
      onSubmit={baseUrl => {
        to.authAsk({ ...props, baseUrl })
      }}
    >
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text>
            (For example, for Moonshot's Kimi K2 API, https://api.moonshot.ai/v1)
          </Text>
        </Box>
        <Text>
          You can usually find this information in your inference provider's documentation.
        </Text>
      </Box>
    </Step>
  </Back>
});

function AuthAsk(props: FullFlowRouteData["authAsk"] & Pick<Transitions<void>, "back"> & {
  onSelect: (route: "apiKey" | "envVar") => void
}) {
  const items = [
    {
      label: "Enter an API key",
      value: "apiKey" as const,
    },
    {
      label: "I have an existing environment variable I use...",
      value: "envVar" as const,
    },
    {
      label: "Back",
      value: "back" as const,
    },
  ];
  const onSelect = useCallback((item: (typeof items)[number]) => {
    if(item.value === "back") props.back();
    else props.onSelect(item.value);
  }, []);

  const provider = Object.values(PROVIDERS).find(provider => {
    return provider.baseUrl === props.baseUrl;
  });

  return <Back go={props.back}>
    <MenuPanel
      title="How do you want to authenticate?"
      items={items}
      onSelect={onSelect}
    >
      {
        provider && <Text>
          It looks like you don't have the default {provider.envVar} environment variable defined
          in your current shell. How do you want to authenticate with {provider.name}?
        </Text>
      }
    </MenuPanel>
  </Back>
}

const envVar = fullFlow.withRoutes(
  "authAsk", "envVar", "postAuth",
).build("envVar", to => props => {
  return <Back go={() => to.authAsk(props)}>
    <Step<string>
      title="What environment variable should Octo read to get the API key?"
      prompt="Environment variable name:"
      parse={val => val}
      validate={val => {
        if(process.env[val]) return { valid: true };

        return {
          valid: false,
          error: `
Env var ${val} isn't defined in your current shell. Do you need to re-source your .bashrc or .zshrc?
          `.trim(),
        };
      }}
      onSubmit={envVar => to.postAuth({ ...props, envVar })}
    >
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text>
            (For example, MOONSHOT_API_KEY)
          </Text>
        </Box>
        <Text>
          You can typically find your API key on your account or settings page on your
          inference provider's website.
        </Text>
        <Text>
          After getting an API key, make sure to export it in your shell; for example:
        </Text>
        <Text bold>
          export MOONSHOT_API_KEY="your-api-key-here"
        </Text>
        <Text>
          (If you're running a local LLM, you can use any non-empty env var.)
        </Text>
      </Box>
    </Step>
  </Back>
});

type Transitions<T> = {
  back: () => any,
  onSubmit: (data: T) => any,
};

const apiKey = fullFlow.withRoutes(
  "apiKey", "authAsk", "postAuth",
).build("apiKey", to => props => {
  return <SetApiKey
    baseUrl={props.baseUrl}
    onComplete={() => to.postAuth(props)}
    onCancel={() => to.authAsk(props)}
  />
});

function PostAuth(props: FullFlowRouteData["postAuth"] & {
  handleAuth: () => any,
}) {
  useEffect(() => {
    props.handleAuth();
  }, []);
  return <></>
}

function Model(props: FullFlowRouteData["model"] & Transitions<string>) {
  return <Back go={props.back}>
    <Step<string>
      title="What's the model string for the API you're using?"
      prompt="Model string:"
      parse={val => val}
      validate={val => {
        if(props.baseUrl === "https://synthetic.new") {
          if(!val.startsWith("hf:")) {
            return {
              valid: false,
              error: `Synthetic model names need to be prefixed with "hf:" (without the quotes)`,
            };
          }
        }
        return {valid: true }
      }}
      onSubmit={props.onSubmit}
    >
      {
        props.renderExamples && <Box marginBottom={1}>
          <Text>
            (For example, to use Kimi K2 with the Moonshot API, you would use kimi-k2-0711-preview)
          </Text>
        </Box>
      }
      <Text>
        This varies by inference provider: you can typically find this information in your
        inference provider's documentation.
      </Text>
    </Step>
  </Back>
}

function TestConnection(props: FullFlowRouteData["testConnection"] & {
  errorNav: () => any,
} & Transitions<void>) {
  const { setErrorMessage } = useContext(errorContext);
  useEffect(() => {
    testConnection({
      model: props.model,
      apiEnvVar: props.envVar,
      baseUrl: props.baseUrl,
    }).then(valid => {
      if(valid) {
        props.onSubmit();
        return;
      }
      setErrorMessage("Connection failed.");
      props.errorNav();
    });
  }, [ props ]);

  return <Back go={props.back}>
    <Box flexDirection="column" justifyContent="center" alignItems="center" marginTop={1}>
      <Box flexDirection="column" width={80}>
        <Text color="yellow" bold>Testing connection...</Text>
      </Box>
    </Box>
  </Back>
}

const nickname = fullFlow.withRoutes(
  "nickname", "model", "context",
).build("nickname", router => props => {
  return <Back go={() => router.model(props)}>
    <Step<string>
      title="Let's give this model a nickname so we can easily reference it later."
      prompt="Nickname:"
      parse={val => val}
      validate={() => ({ valid: true })}
      onSubmit={nickname => router.context({ ...props, nickname })}
    >
      return <Box flexDirection="column">
        {
          props.renderExamples && <Text>
            For example, if this was set up to talk to Kimi K2, you might want to call it that.
          </Text>
        }
      </Box>
    </Step>
  </Back>
});

function Context(props: FullFlowRouteData["context"] & Pick<Transitions<number>, "back">) {
  const color = useColor();
  const { baseUrl, envVar, model, nickname, done } = props;
  return <Back go={props.back}>
    <Step<number>
      title="What's the maximum number of tokens Octo should use per request?"
      prompt="Maximum tokens:"
      parse={val => {
        return parseInt(val.replace("k", ""), 10) * 1024;
      }}
      validate={(value) => {
        if(value.replace("k", "").match(/^\d+$/)) return { valid: true };
        return {
          valid: false,
          error: "Couldn't parse your input as a number: please try again",
        };
      }}
      onSubmit={context => done({
        baseUrl, model, nickname, context,
        apiEnvVar: envVar,
      })}
    >
      <Box flexDirection="column">
        <Text>
          You can usually find this information in the documentation for the model on your inference
          company's website.
        </Text>
        <Box marginY={1}>
          <Text>
            (This is an estimate: leave some buffer room. Best performance is often at half the
            number of tokens supported by the API.)
          </Text>
        </Box>
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
    </Step>
  </Back>
}

const fullFlowRoutes = fullFlow.route({
  baseUrl, envVar, apiKey, nickname,

  authAsk: to => props => {
    return <AuthAsk {...props}
      onSelect={route => to[route](props)}
      back={() => to.baseUrl(props)}
    />
  },

  postAuth: to => props => {
    return <PostAuth {...props} handleAuth={() => to.model(props)} />
  },

  model: to => props => {
    return <Model {...props}
      back={() => to.authAsk(props)}
      onSubmit={model => to.testConnection({ ...props, model })}
    />
  },

  testConnection: to => props => {
    return <TestConnection {...props}
      back={() => to.model(props)}
      errorNav={() => to.baseUrl(props)}
      onSubmit={() => to.nickname(props)}
    />
  },

  context: to => props => {
    return <Context {...props} back={to.nickname(props)} />
  },
});

export function FullAddModelFlow({ onComplete, onCancel }: {
  onComplete: (args: Model) => any,
  onCancel: () => any,
}) {
  const [ errorMessage, setErrorMessage ] = useState("");
  return <errorContext.Provider value={{ errorMessage, setErrorMessage }}>
    <fullFlowRoutes.Root route="baseUrl" props={{
      renderExamples: true,
      done: onComplete,
      cancel: onCancel,
    }} />
  </errorContext.Provider>
}

type CustomModelFlowRouteData = Pick<
  FullFlowRouteData,
  "model"
  | "testConnection"
  | "nickname"
  | "context"
>;
const customModelFlow = router<CustomModelFlowRouteData>();
const customModelFlowRoutes = customModelFlow.route({
  model: to => props => {
    return <Model {...props}
      back={() => props.cancel()}
      onSubmit={model => to.testConnection({ ...props, model })}
    />
  },

  testConnection: to => props => {
    return <TestConnection {...props}
      back={() => to.model(props)}
      errorNav={() => to.model(props)}
      onSubmit={() => to.nickname(props)}
    />
  },

  nickname,

  context: to => props => {
    return <Context {...props} back={to.nickname(props)} />
  },
});

export function CustomModelFlow({ onComplete, onCancel, baseUrl, envVar }: {
  onComplete: (args: Model) => any,
  onCancel: () => any,
  baseUrl: string,
  envVar: string | undefined,
}) {
  const [ errorMessage, setErrorMessage ] = useState("");
  return <errorContext.Provider value={{ errorMessage, setErrorMessage }}>
    <customModelFlowRoutes.Root route="model" props={{
      renderExamples: false,
      done: onComplete,
      cancel: onCancel,
      baseUrl, envVar,
    }} />
  </errorContext.Provider>
}

const customAuthDoneCtx = createContext<(apiKeyEnvVar?: string) => any>(() => {});
type CustomAuthFlowData = Pick<
  FullFlowRouteData,
  "authAsk"
  | "envVar"
  | "apiKey"
  | "postAuth"
>;
const customAuthFlow = router<CustomAuthFlowData>();
const customAuthRoutes = customAuthFlow.route({
  authAsk: to => props => {
    return <AuthAsk {...props}
      onSelect={route => to[route](props)}
      back={() => props.cancel()}
    />
  },
  envVar, apiKey,
  postAuth: _ => props => {
    const done = useContext(customAuthDoneCtx);
    return <PostAuth { ...props } handleAuth={done(props.envVar)} />
  },
});

export function CustomAuthFlow({ onComplete, onCancel, baseUrl }: {
  onComplete: (apiEnvVar?: string) => any,
  onCancel: () => any,
  baseUrl: string,
}) {
  const [ errorMessage, setErrorMessage ] = useState("");
  return <errorContext.Provider value={{ errorMessage, setErrorMessage }}>
    <customAuthDoneCtx.Provider value={onComplete}>
      <customAuthRoutes.Root route="authAsk" props={{
        renderExamples: false,
        done: () => {},
        cancel: onCancel,
        baseUrl,
      }} />
    </customAuthDoneCtx.Provider>
  </errorContext.Provider>
}

type CustomAutofixFlowRouteData = Pick<
  FullFlowRouteData,
  "baseUrl"
  | "authAsk"
  | "envVar"
  | "apiKey"
  | "postAuth"
  | "model"
  | "testConnection"
  | "context"
>
const customAutofixFlow = router<CustomAutofixFlowRouteData>();
const customAutofixRoutes = customAutofixFlow.route({
  baseUrl, envVar, apiKey,

  authAsk: to => props => {
    return <AuthAsk {...props}
      onSelect={route => to[route](props)}
      back={() => to.baseUrl(props)}
    />
  },

  postAuth: to => props => {
    return <PostAuth {...props} handleAuth={() => to.model(props)} />
  },

  model: to => props => {
    return <Model {...props}
      back={() => props.cancel()}
      onSubmit={model => to.testConnection({ ...props, model })}
    />
  },

  testConnection: to => props => {
    return <TestConnection {...props}
      back={() => to.model(props)}
      errorNav={() => to.model(props)}
      onSubmit={() => to.context({ ...props, nickname: "custom-autofix" })}
    />
  },

  context: to => props => {
    return <Context {...props} back={to.model(props)} />
  },
});

export function CustomAutofixFlow({ onComplete, onCancel }: {
  onComplete: (args: Model) => any,
  onCancel: () => any,
}) {
  const [ errorMessage, setErrorMessage ] = useState("");
  return <errorContext.Provider value={{ errorMessage, setErrorMessage }}>
    <customAutofixRoutes.Root route="baseUrl" props={{
      renderExamples: false,
      done: onComplete,
      cancel: onCancel,
    }} />
  </errorContext.Provider>
}

function Step<T>(props: AddModelStep<T>) {
  const { errorMessage, setErrorMessage } = useContext(errorContext);
  const [ varValue, setVarValue ] = useState("");
  const themeColor = useColor();

  const onValueChange = useCallback((value: string) => {
    setErrorMessage("");
    setVarValue(value);
  }, []);

  const onSubmit = useCallback(() => {
    const trimmed = varValue.trim();
    if(trimmed === "") {
      setErrorMessage("Entry can't be empty");
      return;
    }

    const validationResult = props.validate(trimmed);
    if (!validationResult.valid) {
      setVarValue("");
      setErrorMessage(validationResult.error);
      return;
    }

    let parsed = props.parse(trimmed);
    props.onSubmit(parsed);
  }, [ props, varValue ]);

  return <Box flexDirection="column" justifyContent="center" alignItems="center" marginTop={1}>
    <Box flexDirection="column" width={80} gap={1}>
      <Text color={themeColor}>{ props.title }</Text>
      { props.children }
    </Box>

    <Box marginY={1} width={80}>
      <Box marginRight={1}>
        <Text>{props.prompt}</Text>
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

const MinConnectArgsSchema = t.subtype({
  model: t.str,
  apiEnvVar: t.optional(t.str),
  baseUrl: t.str,
});
type MinConnectArgs = t.GetType<typeof MinConnectArgsSchema>;
async function testConnection({ model, apiEnvVar, baseUrl }: MinConnectArgs) {
  try {
    const apiKey = await assertKeyForModel({ baseUrl, apiEnvVar });
    const client = new OpenAI({
      baseURL: baseUrl,
      apiKey,
    });

    const response = await client.chat.completions.create({
      model,
      messages: [{
        role: "user",
        content: "Respond with the word 'hi' and only the word 'hi'",
      }],
    });

    if(response.usage) {
      trackTokens(model, "input", response.usage.prompt_tokens);
      trackTokens(model, "output", response.usage.completion_tokens);
    }

    return true;
  } catch(e) {
    return false;
  }
}
