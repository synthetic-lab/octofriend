use std::collections::{BTreeMap, HashMap};

use super::model_context_error_message;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ModelContextServerConfig {
    pub command: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ModelContextStderr {
    Inherit,
    Ignore,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConnectModelContextClientInput {
    pub server_name: String,
    pub server: ModelContextServerConfig,
    pub env: BTreeMap<String, String>,
    pub stderr: ModelContextStderr,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ModelContextResult<T> {
    Success { data: T },
    Error { error: String },
}

pub trait ModelContextClientLifecycle {
    fn close(&self) -> Result<(), String>;
}

pub struct ModelContextClientRegistry<Client, Connect> {
    clients: HashMap<String, Client>,
    servers: BTreeMap<String, ModelContextServerConfig>,
    base_env: BTreeMap<String, Option<String>>,
    connect: Connect,
    log: bool,
}

impl<Client, Connect> ModelContextClientRegistry<Client, Connect>
where
    Client: Clone + ModelContextClientLifecycle,
    Connect: FnMut(ConnectModelContextClientInput) -> Result<Client, String>,
{
    pub fn with_connector(
        servers: BTreeMap<String, ModelContextServerConfig>,
        base_env: BTreeMap<String, Option<String>>,
        log: bool,
        connect: Connect,
    ) -> Self {
        Self {
            clients: HashMap::new(),
            servers,
            base_env,
            connect,
            log,
        }
    }

    pub fn get_client(&mut self, server_name: &str) -> ModelContextResult<Client> {
        if let Some(client) = self.clients.get(server_name) {
            return ModelContextResult::Success {
                data: client.clone(),
            };
        }

        let Some(server) = self.servers.get(server_name) else {
            return ModelContextResult::Error {
                error: format!(
                    "MCP server \"{server_name}\" not found in config. Please add it to mcpServers."
                ),
            };
        };

        match (self.connect)(ConnectModelContextClientInput {
            server_name: server_name.to_owned(),
            server: server.clone(),
            env: model_context_process_env(&self.base_env, &server.env),
            stderr: if self.log {
                ModelContextStderr::Inherit
            } else {
                ModelContextStderr::Ignore
            },
        }) {
            Ok(client) => {
                self.clients.insert(server_name.to_owned(), client.clone());
                ModelContextResult::Success { data: client }
            }
            Err(error) => ModelContextResult::Error {
                error: model_context_error_message(error),
            },
        }
    }

    pub fn shutdown(&mut self, mut on_close_error: impl FnMut(&str, String)) {
        let entries = self.clients.drain().collect::<Vec<_>>();

        for (server_name, client) in entries {
            if let Err(error) = client.close() {
                on_close_error(&server_name, error);
            }
        }
    }
}

fn model_context_process_env(
    base_env: &BTreeMap<String, Option<String>>,
    server_env: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let mut env = base_env
        .iter()
        .filter_map(|(key, value)| value.as_ref().map(|value| (key.clone(), value.clone())))
        .collect::<BTreeMap<_, _>>();

    env.extend(server_env.clone());
    env
}
