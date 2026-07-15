import React, { useState, useCallback, useEffect, createContext, useContext } from "react";
import TextInput from "./text-input.tsx";
import {
  Config,
  Auth,
  apiKeyFromAuth,
  hasExistingAuthForBaseUrl,
  readAuthForModel,
} from "../config.ts";
import { useColor } from "../theme.ts";
import OpenAI from "openai";
import { trackTokens } from "../token-tracker.ts";
import { SetApiKey } from "./set-api-key.tsx";
import { KbShortcutPanel } from "./kb-select/kb-shortcut-panel.tsx";
import { Item, ShortcutArray } from "./kb-select/kb-shortcut-select.tsx";
import { router, Back } from "../router.tsx";
import { providerForBaseUrl } from "../providers.ts";
import * as logger from "../logger.ts";
import { parse } from "shell-quote";
import { getDefaultOpenaiClient } from "../compilers/openai.ts";
import {
  CODEX_OAUTH_FILE,
  hasCodexOAuthTokens,
  openDefaultBrowser,
  pollCodexDeviceAuthorization,
  startCodexDeviceAuthorization,
  writeCodexOAuthTokens,
} from "../codex-oauth.ts";
import { Span } from "paintcannon-react";
import { TerminalFlex } from "./terminal-flex.tsx";
type Model = Config["models"][number];
type ValidationResult =
  | {
      valid: true;
    }
  | {
      valid: false;
      error: string;
    };
type AddModelStep<T> = {
  title: string;
  prompt: string;
  defaultValue?: string;
  parse: (val: string) => T;
  validate: (val: string) => ValidationResult;
  onSubmit: (t: T) => any;
  children: React.ReactNode;
};
type ModelStepRoute<T> = T & {
  renderExamples: boolean;
  done: (data: Model) => any;
  cancel: () => any;
  config: Config | null;
};
type FullFlowRouteData = {
  baseUrl: ModelStepRoute<{}>;
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
  codexOAuth: ModelStepRoute<{
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
const errorContext = createContext<{
  setErrorMessage: (m: string) => any;
  errorMessage: string;
}>({
  errorMessage: "",
  setErrorMessage: () => {},
});
const fullFlow = router<FullFlowRouteData>();
type AuthAskRoute = "apiKey" | "envVar" | "command";
type AuthAskSelection = AuthAskRoute | "back";
const baseUrl = fullFlow
  .withRoutes("authAsk", "baseUrl", "postAuth", "codexOAuth")
  .build("baseUrl", to => props => {
    return (
      <Back go={props.cancel}>
        <Step<string>
          title="What's the base URL for the API you're connecting to?"
          prompt="Base URL:"
          parse={val => val}
          validate={() => ({
            valid: true,
          })}
          onSubmit={async baseUrl => {
            const provider = providerForBaseUrl(baseUrl);
            if (provider?.type === "codex") {
              if (await hasCodexOAuthTokens()) {
                to.postAuth({
                  ...props,
                  baseUrl,
                  auth: {
                    type: "codex",
                  },
                });
              } else {
                to.codexOAuth({
                  ...props,
                  baseUrl,
                });
              }
              return;
            }
            const hasExistingAuth = await hasExistingAuthForBaseUrl(baseUrl, props.config);
            if (hasExistingAuth) {
              to.postAuth({
                ...props,
                baseUrl,
              });
            } else {
              to.authAsk({
                ...props,
                baseUrl,
              });
            }
          }}
        >
          <TerminalFlex
            style={{
              flexDirection: "column",
            }}
          >
            {props.renderExamples && (
              <TerminalFlex
                style={{
                  marginBottom: 1,
                }}
              >
                <Span>(For example, for Moonshot's Kimi K2 API, https://api.moonshot.ai/v1)</Span>
              </TerminalFlex>
            )}
            <Span>
              You can usually find this information in your inference provider's documentation.
            </Span>
          </TerminalFlex>
        </Step>
      </Back>
    );
  });
function AuthAsk(
  props: FullFlowRouteData["authAsk"] &
    Pick<Transitions<void>, "back"> & {
      onSelect: (route: AuthAskRoute) => void;
    },
) {
  const provider = providerForBaseUrl(props.baseUrl);
  const shortcutItems = [
    {
      type: "key" as const,
      mapping: {
        a: {
          label: "Enter an API key",
          value: "apiKey",
        },
        e: {
          label: "I have an existing environment variable I use...",
          value: "envVar",
        },
        c: {
          label: "Use a command (e.g. pass, op, gopass)...",
          value: "command",
        },
        b: {
          label: "Back",
          value: "back",
        },
      },
    },
  ] satisfies ShortcutArray<AuthAskSelection>;
  const onSelect = useCallback((item: Item<AuthAskSelection>) => {
    if (item.value === "back") props.back();
    else props.onSelect(item.value);
  }, []);
  return (
    <Back go={props.back}>
      <KbShortcutPanel
        title="How do you want to authenticate?"
        shortcutItems={shortcutItems}
        onSelect={onSelect}
      >
        {provider && (
          <Span>
            It looks like you don't have the default {provider.envVar} environment variable defined
            in your current shell. How do you want to authenticate with {provider.name}?
          </Span>
        )}
      </KbShortcutPanel>
    </Back>
  );
}
function CodexOAuthStep({ cancel, onComplete }: { cancel: () => void; onComplete: () => void }) {
  const [status, setStatus] = useState<
    | {
        type: "starting";
      }
    | {
        type: "waiting";
        url: string;
        code: string;
        opened: boolean;
      }
    | {
        type: "error";
        message: string;
      }
  >({
    type: "starting",
  });
  useEffect(() => {
    const abortController = new AbortController();
    async function authorize() {
      const device = await startCodexDeviceAuthorization();
      if (abortController.signal.aborted) return;
      if (!device.success) {
        setStatus({
          type: "error",
          message: device.error,
        });
        return;
      }
      const openedResult = await openDefaultBrowser(device.data.verificationUri);
      const opened = openedResult.success ? openedResult.data : false;
      if (abortController.signal.aborted) return;
      setStatus({
        type: "waiting",
        url: device.data.verificationUri,
        code: device.data.userCode,
        opened,
      });
      const tokens = await pollCodexDeviceAuthorization(device.data, abortController.signal);
      if (abortController.signal.aborted) return;
      if (!tokens.success) {
        setStatus({
          type: "error",
          message: tokens.error,
        });
        return;
      }
      const written = await writeCodexOAuthTokens(tokens.data);
      if (abortController.signal.aborted) return;
      if (!written.success) {
        setStatus({
          type: "error",
          message: written.error,
        });
        return;
      }
      onComplete();
    }
    authorize();
    return () => abortController.abort();
  }, [onComplete]);
  return (
    <Back go={cancel}>
      <TerminalFlex
        style={{
          flexDirection: "column",
        }}
      >
        <TerminalFlex
          style={{
            justifyContent: "center",
            marginBottom: 1,
          }}
        >
          <TerminalFlex
            style={{
              flexDirection: "column",
              width: "100%",
              minWidth: 0,
              maxWidth: 80,
            }}
          >
            <Span
              style={{
                color: "yellow",
                fontWeight: "bold",
              }}
            >
              ChatGPT Codex authorization
            </Span>
            {status.type === "starting" && <Span>Requesting an authorization code...</Span>}
            {status.type === "waiting" && (
              <>
                <Span>
                  {status.opened
                    ? "Opened your browser. If it did not appear, open this URL manually:"
                    : "Could not open your browser automatically. Open this URL manually:"}
                </Span>
                <Span
                  style={{
                    fontWeight: "bold",
                  }}
                >
                  {status.url}
                </Span>
                <Span>
                  Code:{" "}
                  <Span
                    style={{
                      fontWeight: "bold",
                    }}
                  >
                    {status.code}
                  </Span>
                </Span>
                <Span
                  style={{
                    color: "gray",
                  }}
                >
                  Waiting for authorization. Press ESC to cancel.
                </Span>
              </>
            )}
            {status.type === "error" && (
              <>
                <Span
                  style={{
                    color: "red",
                  }}
                >
                  Authorization failed: {status.message}
                </Span>
                <Span
                  style={{
                    color: "gray",
                  }}
                >
                  Press ESC to go back.
                </Span>
              </>
            )}
            {status.type !== "error" && (
              <Span
                style={{
                  color: "gray",
                }}
              >
                Credentials will be saved to {CODEX_OAUTH_FILE}
              </Span>
            )}
          </TerminalFlex>
        </TerminalFlex>
      </TerminalFlex>
    </Back>
  );
}
const codexOAuth = fullFlow
  .withRoutes("codexOAuth", "authAsk", "postAuth")
  .build("codexOAuth", to => props => {
    return (
      <CodexOAuthStep
        cancel={props.cancel}
        onComplete={() =>
          to.postAuth({
            ...props,
            auth: {
              type: "codex",
            },
          })
        }
      />
    );
  });
const envVar = fullFlow.withRoutes("authAsk", "envVar", "postAuth").build("envVar", to => props => {
  return (
    <Back go={() => to.authAsk(props)}>
      <Step<string>
        title="What environment variable should Octo read to get the API key?"
        prompt="Environment variable name:"
        parse={val => val}
        validate={val => {
          if (process.env[val])
            return {
              valid: true,
            };
          return {
            valid: false,
            error: `
Env var ${val} isn't defined in your current shell. Do you need to re-source your .bashrc or .zshrc?
          `.trim(),
          };
        }}
        onSubmit={envVar =>
          to.postAuth({
            ...props,
            auth: {
              type: "env",
              name: envVar,
            },
          })
        }
      >
        <TerminalFlex
          style={{
            flexDirection: "column",
          }}
        >
          {props.renderExamples && (
            <TerminalFlex
              style={{
                marginBottom: 1,
              }}
            >
              <Span>(For example, MOONSHOT_API_KEY)</Span>
            </TerminalFlex>
          )}
          <Span>
            You can typically find your API key on your account or settings page on your inference
            provider's website.
          </Span>
          {props.renderExamples && (
            <>
              <Span>
                After getting an API key, make sure to export it in your shell; for example:
              </Span>
              <Span
                style={{
                  fontWeight: "bold",
                }}
              >
                export MOONSHOT_API_KEY="your-api-key-here"
              </Span>
              <Span>(If you're running a local LLM, you can use any non-empty env var.)</Span>
            </>
          )}
        </TerminalFlex>
      </Step>
    </Back>
  );
});
const command = fullFlow
  .withRoutes("authAsk", "command", "postAuth")
  .build("command", to => props => {
    return (
      <Back go={() => to.authAsk(props)}>
        <Step<string[]>
          title="What command should Octo run to get the API key?"
          prompt="Command:"
          parse={val => {
            const parsed = parse(val);
            // shell-quote returns an array that may include shell operators (objects)
            // We filter to keep only string arguments for the command
            return parsed.filter((item): item is string => typeof item === "string");
          }}
          validate={val => {
            const parsed = parse(val);

            // Detect shell operators (pipes, redirects, etc.) which shell-quote parses as objects
            const hasOperators = parsed.some(item => typeof item !== "string");
            if (hasOperators) {
              return {
                valid: false,
                error:
                  "Shell operators like pipes (|) and redirects (>, <) aren't supported. Enter only the command and its arguments.",
              };
            }
            const [commandName] = parsed;
            if (!commandName) {
              return {
                valid: false,
                error: "Command can't be empty",
              };
            }
            return {
              valid: true,
            };
          }}
          onSubmit={command =>
            to.postAuth({
              ...props,
              auth: {
                type: "command",
                command,
              },
            })
          }
        >
          <TerminalFlex
            style={{
              flexDirection: "column",
            }}
          >
            <Span>
              Enter the command and arguments separated by spaces. The command should output only
              the API key to stdout.
            </Span>
            {props.renderExamples && (
              <>
                <Span>Examples:</Span>
                <Span
                  style={{
                    fontWeight: "bold",
                  }}
                >
                  pass show openai/api-key
                </Span>
                <Span
                  style={{
                    fontWeight: "bold",
                  }}
                >
                  op read "op://vault/openai/key"
                </Span>
                <Span
                  style={{
                    fontWeight: "bold",
                  }}
                >
                  gopass show -o openai/key
                </Span>
              </>
            )}
          </TerminalFlex>
        </Step>
      </Back>
    );
  });
type Transitions<T> = {
  back: () => void;
  onSubmit: (data: T) => void;
};
const apiKey = fullFlow.withRoutes("apiKey", "authAsk", "postAuth").build("apiKey", to => props => {
  return (
    <SetApiKey
      baseUrl={props.baseUrl}
      onComplete={() => to.postAuth(props)}
      onCancel={() => to.authAsk(props)}
    />
  );
});
function PostAuth(
  props: FullFlowRouteData["postAuth"] & {
    handleAuth: () => void;
  },
) {
  useEffect(() => {
    props.handleAuth();
  }, []);
  return <></>;
}
function Model(props: FullFlowRouteData["model"] & Transitions<string>) {
  return (
    <Back go={props.back}>
      <Step<string>
        title="What's the model string for the API you're using?"
        prompt="Model string:"
        parse={val => val}
        validate={val => {
          if (props.baseUrl === "https://synthetic.new") {
            if (!val.startsWith("hf:")) {
              return {
                valid: false,
                error: `Synthetic model names need to be prefixed with "hf:" (without the quotes)`,
              };
            }
          }
          return {
            valid: true,
          };
        }}
        onSubmit={props.onSubmit}
      >
        {props.renderExamples && (
          <TerminalFlex
            style={{
              marginBottom: 1,
            }}
          >
            <Span>
              (For example, to use Kimi K2 with the Moonshot API, you would use
              kimi-k2-0711-preview)
            </Span>
          </TerminalFlex>
        )}
        <Span>
          This varies by inference provider: you can typically find this information in your
          inference provider's documentation.
        </Span>
      </Step>
    </Back>
  );
}
function TestConnection(
  props: FullFlowRouteData["testConnection"] & {
    errorNav: () => any;
  } & Transitions<ModelMetadata>,
) {
  const { setErrorMessage } = useContext(errorContext);
  useEffect(() => {
    testConnection({
      model: props.model,
      auth: props.auth,
      baseUrl: props.baseUrl,
      config: props.config,
    }).then(result => {
      if (result.valid) {
        props.onSubmit(result.metadata);
        return;
      }
      setErrorMessage("Connection failed.");
      props.errorNav();
    });
  }, [props]);
  return (
    <Back go={props.back}>
      <TerminalFlex
        style={{
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          marginTop: 1,
        }}
      >
        <TerminalFlex
          style={{
            flexDirection: "column",
            width: "100%",
            minWidth: 0,
            maxWidth: 80,
          }}
        >
          <Span
            style={{
              color: "yellow",
              fontWeight: "bold",
            }}
          >
            Testing connection...
          </Span>
        </TerminalFlex>
      </TerminalFlex>
    </Back>
  );
}
const nickname = fullFlow
  .withRoutes("nickname", "model", "context")
  .build("nickname", router => props => {
    const defaultNickname =
      props.nickname || props.metadata.name?.split("/").pop()?.replace(/-/g, " ") || "";
    return (
      <Back go={() => router.model(props)}>
        <Step<string>
          title="Let's give this model a nickname so we can easily reference it later."
          prompt="Nickname:"
          defaultValue={defaultNickname}
          parse={val => val}
          validate={() => ({
            valid: true,
          })}
          onSubmit={nickname =>
            router.context({
              ...props,
              nickname,
            })
          }
        >
          <TerminalFlex
            style={{
              flexDirection: "column",
            }}
          >
            {props.renderExamples && (
              <Span>
                For example, if this was set up to talk to Kimi K2, you might want to call it that.
              </Span>
            )}
          </TerminalFlex>
        </Step>
      </Back>
    );
  });
function formatContextTokens(tokens: number): string {
  const halfTokens = tokens / 2;
  const kValue = Math.round(halfTokens / 1024);
  return `${kValue}k`;
}
function Context(props: FullFlowRouteData["context"] & Pick<Transitions<number>, "back">) {
  const color = useColor();
  const { baseUrl, auth, model, nickname, done, metadata } = props;
  const defaultContext = metadata.contextLength ? formatContextTokens(metadata.contextLength) : "";
  return (
    <Back go={props.back}>
      <Step<number>
        title="What's the maximum number of tokens Octo should use per request?"
        prompt="Maximum tokens:"
        defaultValue={defaultContext}
        parse={val => {
          return parseInt(val.replace("k", ""), 10) * 1024;
        }}
        validate={value => {
          if (value.replace("k", "").match(/^\d+$/))
            return {
              valid: true,
            };
          return {
            valid: false,
            error: "Couldn't parse your input as a number: please try again",
          };
        }}
        onSubmit={context => {
          if (auth?.type === "codex") {
            done({
              type: "codex",
              model,
              nickname,
              context,
              auth,
            });
            return;
          }
          done({
            baseUrl,
            model,
            nickname,
            context,
            auth,
          });
        }}
      >
        <TerminalFlex
          style={{
            flexDirection: "column",
          }}
        >
          <Span>
            You can usually find this information in the documentation for the model on your
            inference company's website.
          </Span>
          <TerminalFlex
            style={{
              marginTop: 1,
              marginBottom: 1,
            }}
          >
            <Span>
              (This is an estimate: leave some buffer room. Best performance is often at half the
              number of tokens supported by the API.)
            </Span>
          </TerminalFlex>
          <Span>
            Format the number in k: for example,{" "}
            <Span
              style={{
                color: color,
              }}
            >
              32k
            </Span>{" "}
            or,{" "}
            <Span
              style={{
                color: color,
              }}
            >
              64k
            </Span>
            .
          </Span>
        </TerminalFlex>
      </Step>
    </Back>
  );
}
const fullFlowRoutes = fullFlow.route({
  baseUrl,
  envVar,
  command,
  apiKey,
  codexOAuth,
  nickname,
  authAsk: to => props => {
    return (
      <AuthAsk {...props} onSelect={route => to[route](props)} back={() => to.baseUrl(props)} />
    );
  },
  postAuth: to => props => {
    return <PostAuth {...props} handleAuth={() => to.model(props)} />;
  },
  model: to => props => {
    return (
      <Model
        {...props}
        back={() => to.authAsk(props)}
        onSubmit={model =>
          to.testConnection({
            ...props,
            model,
          })
        }
      />
    );
  },
  testConnection: to => props => {
    return (
      <TestConnection
        {...props}
        back={() => to.model(props)}
        errorNav={() => to.baseUrl(props)}
        onSubmit={metadata =>
          to.nickname({
            ...props,
            metadata,
          })
        }
      />
    );
  },
  context: to => props => {
    return <Context {...props} back={() => to.nickname(props)} />;
  },
});
export function FullAddModelFlow({
  onComplete,
  onCancel,
  config,
}: {
  onComplete: (args: Model) => any;
  onCancel: () => any;
  config: Config | null;
}) {
  const [errorMessage, setErrorMessage] = useState("");
  return (
    <errorContext.Provider
      value={{
        errorMessage,
        setErrorMessage,
      }}
    >
      <fullFlowRoutes.Root
        route="baseUrl"
        props={{
          renderExamples: true,
          done: onComplete,
          cancel: onCancel,
          config: config,
        }}
      />
    </errorContext.Provider>
  );
}
type CustomModelFlowRouteData = Pick<
  FullFlowRouteData,
  "model" | "testConnection" | "nickname" | "context"
>;
const customModelFlow = router<CustomModelFlowRouteData>();
const customModelFlowRoutes = customModelFlow.route({
  model: to => props => {
    return (
      <Model
        {...props}
        back={() => props.cancel()}
        onSubmit={model =>
          to.testConnection({
            ...props,
            model,
          })
        }
      />
    );
  },
  testConnection: to => props => {
    return (
      <TestConnection
        {...props}
        back={() => to.model(props)}
        errorNav={() => to.model(props)}
        onSubmit={metadata =>
          to.nickname({
            ...props,
            metadata,
          })
        }
      />
    );
  },
  nickname,
  context: to => props => {
    return <Context {...props} back={() => to.nickname(props)} />;
  },
});
export function CustomModelFlow({
  onComplete,
  onCancel,
  baseUrl,
  auth,
  config,
}: {
  onComplete: (args: Model) => any;
  onCancel: () => any;
  baseUrl: string;
  auth?: Auth;
  config: Config | null;
}) {
  const [errorMessage, setErrorMessage] = useState("");
  return (
    <errorContext.Provider
      value={{
        errorMessage,
        setErrorMessage,
      }}
    >
      <customModelFlowRoutes.Root
        route="model"
        props={{
          renderExamples: false,
          done: onComplete,
          cancel: onCancel,
          baseUrl,
          auth,
          config,
        }}
      />
    </errorContext.Provider>
  );
}
const customAuthDoneCtx = createContext<(auth?: Auth) => any>(() => {});
type CustomAuthFlowData = Pick<FullFlowRouteData, "authAsk" | "envVar" | "command" | "apiKey"> & {
  codexOAuth: ModelStepRoute<{}>;
  postAuth: ModelStepRoute<{
    baseUrl?: string;
    auth?: Auth;
  }>;
};
type CustomAuthData =
  | {
      modelType: Exclude<Model["type"], "codex">;
      baseUrl: string;
    }
  | {
      modelType: "codex";
    };
const customAuthFlow = router<CustomAuthFlowData>();
const customCodexOAuth = customAuthFlow
  .withRoutes("codexOAuth", "postAuth")
  .build("codexOAuth", to => props => {
    return (
      <CodexOAuthStep
        cancel={props.cancel}
        onComplete={() =>
          to.postAuth({
            ...props,
            auth: {
              type: "codex",
            },
          })
        }
      />
    );
  });
const customAuthRoutes = customAuthFlow.route({
  authAsk: to => props => {
    return <AuthAsk {...props} onSelect={route => to[route](props)} back={() => props.cancel()} />;
  },
  envVar,
  command,
  apiKey,
  codexOAuth: customCodexOAuth,
  postAuth: _ => props => {
    const done = useContext(customAuthDoneCtx);
    useEffect(() => {
      done(props.auth);
    }, [done, props.auth]);
    return <></>;
  },
});
export function CustomAuthFlow({
  onComplete,
  onCancel,
  authData,
  config,
}: {
  onComplete: (auth?: Auth) => any;
  onCancel: () => any;
  authData: CustomAuthData;
  config: Config | null;
}) {
  const [errorMessage, setErrorMessage] = useState("");
  const [hasCheckedExistingKey, setHasCheckedExistingKey] = useState(false);
  const authBaseUrl = authData.modelType === "codex" ? undefined : authData.baseUrl;
  useEffect(() => {
    if (!hasCheckedExistingKey) {
      if (authData.modelType === "codex") {
        hasCodexOAuthTokens().then(hasTokens => {
          if (hasTokens)
            onComplete({
              type: "codex",
            });
          else setHasCheckedExistingKey(true);
        });
      } else {
        hasExistingAuthForBaseUrl(authData.baseUrl, config).then(hasAuth => {
          if (hasAuth) {
            onComplete();
          }
          setHasCheckedExistingKey(true);
        });
      }
    }
  }, [hasCheckedExistingKey, authData.modelType, authBaseUrl, config, onComplete]);

  // Show nothing while checking for existing key (will auto-complete if found)
  if (!hasCheckedExistingKey) {
    return <></>;
  }
  return (
    <errorContext.Provider
      value={{
        errorMessage,
        setErrorMessage,
      }}
    >
      <customAuthDoneCtx.Provider value={onComplete}>
        {authData.modelType === "codex" ? (
          <customAuthRoutes.Root
            route="codexOAuth"
            props={{
              renderExamples: false,
              done: () => {},
              cancel: onCancel,
              config,
            }}
          />
        ) : (
          <customAuthRoutes.Root
            route="authAsk"
            props={{
              renderExamples: false,
              done: () => {},
              cancel: onCancel,
              baseUrl: authData.baseUrl,
              config,
            }}
          />
        )}
      </customAuthDoneCtx.Provider>
    </errorContext.Provider>
  );
}
type CustomAutofixFlowRouteData = Pick<
  FullFlowRouteData,
  | "baseUrl"
  | "authAsk"
  | "envVar"
  | "command"
  | "apiKey"
  | "codexOAuth"
  | "postAuth"
  | "model"
  | "testConnection"
  | "context"
>;
const customAutofixFlow = router<CustomAutofixFlowRouteData>();
const customAutofixRoutes = customAutofixFlow.route({
  baseUrl,
  envVar,
  command,
  apiKey,
  codexOAuth,
  authAsk: to => props => {
    return (
      <AuthAsk {...props} onSelect={route => to[route](props)} back={() => to.baseUrl(props)} />
    );
  },
  postAuth: to => props => {
    return <PostAuth {...props} handleAuth={() => to.model(props)} />;
  },
  model: to => props => {
    return (
      <Model
        {...props}
        back={() => props.cancel()}
        onSubmit={model =>
          to.testConnection({
            ...props,
            model,
          })
        }
      />
    );
  },
  testConnection: to => props => {
    return (
      <TestConnection
        {...props}
        back={() => to.model(props)}
        errorNav={() => to.model(props)}
        onSubmit={metadata =>
          to.context({
            ...props,
            nickname: "custom-autofix",
            metadata,
          })
        }
      />
    );
  },
  context: to => props => {
    return <Context {...props} back={() => to.model(props)} />;
  },
});
export function CustomAutofixFlow({
  onComplete,
  onCancel,
  config,
}: {
  onComplete: (args: Model) => any;
  onCancel: () => any;
  config: Config | null;
}) {
  const [errorMessage, setErrorMessage] = useState("");
  return (
    <errorContext.Provider
      value={{
        errorMessage,
        setErrorMessage,
      }}
    >
      <customAutofixRoutes.Root
        route="baseUrl"
        props={{
          renderExamples: false,
          done: onComplete,
          cancel: onCancel,
          config,
        }}
      />
    </errorContext.Provider>
  );
}
function Step<T>(props: AddModelStep<T>) {
  const { errorMessage, setErrorMessage } = useContext(errorContext);
  const [varValue, setVarValue] = useState(props.defaultValue || "");
  const themeColor = useColor();
  const onValueChange = useCallback((value: string) => {
    setErrorMessage("");
    setVarValue(value);
  }, []);
  const onSubmit = useCallback(() => {
    const trimmed = varValue.trim();
    if (trimmed === "") {
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
  }, [props, varValue]);
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        marginTop: 1,
      }}
    >
      <TerminalFlex
        style={{
          flexDirection: "column",
          width: "100%",
          minWidth: 0,
          maxWidth: 80,
          gap: 1,
        }}
      >
        <Span
          style={{
            color: themeColor,
          }}
        >
          {props.title}
        </Span>
        {props.children}
      </TerminalFlex>

      <TerminalFlex
        style={{
          marginTop: 1,
          marginBottom: 1,
          width: "100%",
          minWidth: 0,
          maxWidth: 80,
        }}
      >
        <TerminalFlex
          style={{
            marginRight: 1,
          }}
        >
          <Span>{props.prompt}</Span>
        </TerminalFlex>

        <TextInput value={varValue} onChange={onValueChange} onSubmit={onSubmit} />
      </TerminalFlex>

      {errorMessage && (
        <TerminalFlex
          style={{
            width: "100%",
            minWidth: 0,
            maxWidth: 80,
          }}
        >
          <Span
            style={{
              color: "red",
              fontWeight: "bold",
            }}
          >
            {errorMessage}
          </Span>
        </TerminalFlex>
      )}
    </TerminalFlex>
  );
}
type ModelMetadata = {
  name?: string;
  contextLength?: number;
};
type TestConnectionResult =
  | {
      valid: true;
      metadata: ModelMetadata;
    }
  | {
      valid: false;
    };
type MinConnectArgs = {
  model: string;
  auth?: Auth;
  baseUrl: string;
  config: Config | null;
};
async function testConnection({
  model,
  auth,
  baseUrl,
  config,
}: MinConnectArgs): Promise<TestConnectionResult> {
  try {
    const provider = providerForBaseUrl(baseUrl);
    if (provider?.type === "codex") {
      const configuredModel = provider.models.find(candidate => candidate.model === model);
      return {
        valid: true,
        metadata: {
          name: configuredModel?.nickname ?? model,
          contextLength: configuredModel?.context,
        },
      };
    }
    const authResult = await readAuthForModel(
      {
        baseUrl,
        auth,
      },
      config,
    );
    if (!authResult.ok || authResult.auth.type !== "apiKey")
      return {
        valid: false,
      };
    const apiKey = apiKeyFromAuth(authResult.auth);
    const client = getDefaultOpenaiClient({
      baseUrl,
      apiKey,
    });
    const testPromise = client.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: "Respond with the word 'hi' and only the word 'hi'",
        },
      ],
    });
    const metadataPromise = fetchModelMetadata(client, model);
    const [response, metadata] = await Promise.all([testPromise, metadataPromise]);
    if (response.usage) {
      trackTokens(model, "input", response.usage.prompt_tokens);
      trackTokens(model, "output", response.usage.completion_tokens);
    }
    return {
      valid: true,
      metadata,
    };
  } catch (e) {
    logger.error("verbose", e);
    return {
      valid: false,
    };
  }
}
async function fetchModelMetadata(client: OpenAI, model: string): Promise<ModelMetadata> {
  try {
    const models = await client.models.list({
      timeout: 3000,
    });
    const modelInfo = models.data.find(m => m.id === model) as
      | (OpenAI.Models.Model & {
          name?: string;
          context_length?: number;
        })
      | undefined;
    if (!modelInfo) {
      return {};
    }
    return {
      name: modelInfo.name,
      contextLength: modelInfo.context_length,
    };
  } catch {
    return {};
  }
}
