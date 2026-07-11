use std::collections::BTreeMap;

use octofriend_tools::mcp::{
    ConnectModelContextClientInput, ModelContextClientLifecycle, ModelContextClientRegistry,
    ModelContextResult, ModelContextServerConfig, ModelContextStderr,
};

#[derive(Clone, Debug, Eq, PartialEq)]
struct TestClient {
    name: String,
}

impl ModelContextClientLifecycle for TestClient {
    fn close(&self) -> Result<(), String> {
        Ok(())
    }
}

#[test]
fn model_context_client_registry_returns_an_error_for_unknown_servers() {
    let mut registry = ModelContextClientRegistry::with_connector(
        BTreeMap::new(),
        BTreeMap::new(),
        false,
        |_input| {
            Ok(TestClient {
                name: "unused".into(),
            })
        },
    );

    assert_eq!(
        registry.get_client("missing"),
        ModelContextResult::Error {
            error: "MCP server \"missing\" not found in config. Please add it to mcpServers."
                .into(),
        }
    );
}

#[test]
fn model_context_client_registry_connects_once_and_reuses_cached_clients() {
    let mut servers = BTreeMap::new();
    servers.insert(
        "filesystem".into(),
        ModelContextServerConfig {
            command: "server".into(),
            args: vec!["--stdio".into()],
            env: BTreeMap::from([("TOKEN".into(), "abc".into())]),
        },
    );

    let mut connect_inputs = Vec::<ConnectModelContextClientInput>::new();
    let mut registry = ModelContextClientRegistry::with_connector(
        servers.clone(),
        BTreeMap::from([("PATH".into(), Some("/bin".into())), ("EMPTY".into(), None)]),
        false,
        |input| {
            connect_inputs.push(input);
            Ok(TestClient {
                name: "filesystem-client".into(),
            })
        },
    );

    let first = registry.get_client("filesystem");
    let second = registry.get_client("filesystem");

    assert_eq!(
        first,
        ModelContextResult::Success {
            data: TestClient {
                name: "filesystem-client".into(),
            },
        }
    );
    assert_eq!(second, first);
    drop(registry);
    assert_eq!(
        connect_inputs,
        vec![ConnectModelContextClientInput {
            server_name: "filesystem".into(),
            server: servers["filesystem"].clone(),
            env: BTreeMap::from([
                ("PATH".into(), "/bin".into()),
                ("TOKEN".into(), "abc".into())
            ]),
            stderr: ModelContextStderr::Ignore,
        }]
    );
}

#[test]
fn model_context_client_registry_uses_inherited_stderr_when_logging() {
    let mut servers = BTreeMap::new();
    servers.insert(
        "filesystem".into(),
        ModelContextServerConfig {
            command: "server".into(),
            args: Vec::new(),
            env: BTreeMap::new(),
        },
    );
    let mut stderr = None;
    let mut registry =
        ModelContextClientRegistry::with_connector(servers, BTreeMap::new(), true, |input| {
            stderr = Some(input.stderr);
            Ok(TestClient {
                name: "filesystem-client".into(),
            })
        });

    let _ = registry.get_client("filesystem");
    drop(registry);

    assert_eq!(stderr, Some(ModelContextStderr::Inherit));
}

#[test]
fn model_context_client_registry_closes_cached_clients_and_clears_cache() {
    #[derive(Clone)]
    struct ClosingClient {
        name: String,
        closed: std::rc::Rc<std::cell::RefCell<Vec<String>>>,
    }

    impl ModelContextClientLifecycle for ClosingClient {
        fn close(&self) -> Result<(), String> {
            self.closed.borrow_mut().push(self.name.clone());
            Ok(())
        }
    }

    let closed = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
    let client = ClosingClient {
        name: "filesystem".into(),
        closed: closed.clone(),
    };
    let mut servers = BTreeMap::new();
    servers.insert(
        "filesystem".into(),
        ModelContextServerConfig {
            command: "server".into(),
            args: Vec::new(),
            env: BTreeMap::new(),
        },
    );
    let mut connect_count = 0;
    let mut registry =
        ModelContextClientRegistry::with_connector(servers, BTreeMap::new(), false, |_input| {
            connect_count += 1;
            Ok(client.clone())
        });

    let _ = registry.get_client("filesystem");
    registry.shutdown(|_server_name, _reason| {});
    let _ = registry.get_client("filesystem");
    drop(registry);

    assert_eq!(*closed.borrow(), vec!["filesystem".to_string()]);
    assert_eq!(connect_count, 2);
}
