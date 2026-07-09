use env as safe_env;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EnvAuth {
    pub name: String,
}

impl EnvAuth {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into().trim().into(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AuthError {
    Missing { message: String },
    Invalid { message: String },
    CommandFailed { message: String },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum KeyResult {
    Ok { key: String },
    Err { error: AuthError },
}

impl KeyResult {
    pub fn ok(key: impl Into<String>) -> Self {
        Self::Ok { key: key.into() }
    }

    pub fn missing(message: impl Into<String>) -> Self {
        Self::Err {
            error: AuthError::Missing {
                message: message.into(),
            },
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::Err {
            error: AuthError::Invalid {
                message: message.into(),
            },
        }
    }
}

pub fn resolve_env_auth(auth: &EnvAuth) -> KeyResult {
    match safe_env::var(&auth.name) {
        Ok(value) => env_value_result(&auth.name, &value),
        _ => KeyResult::missing(format!("Environment variable {} is not set", auth.name)),
    }
}

pub fn resolve_env_auth_from(auth: &EnvAuth, env: &BTreeMap<String, String>) -> KeyResult {
    match env.get(&auth.name) {
        Some(value) => env_value_result(&auth.name, value),
        _ => KeyResult::missing(format!("Environment variable {} is not set", auth.name)),
    }
}

fn env_value_result(name: &str, value: &str) -> KeyResult {
    let key = value.trim();
    if key.is_empty() {
        KeyResult::missing(format!("Environment variable {name} is not set"))
    } else {
        KeyResult::ok(key)
    }
}
