use std::collections::BTreeMap;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EnvAuth {
    pub name: String,
}

impl EnvAuth {
    pub fn new(name: impl Into<String>) -> Self {
        Self { name: name.into() }
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
    match std::env::var(&auth.name) {
        Ok(value) if !value.is_empty() => KeyResult::ok(value),
        _ => KeyResult::missing(format!("Environment variable {} is not set", auth.name)),
    }
}

pub fn resolve_env_auth_from(auth: &EnvAuth, env: &BTreeMap<String, String>) -> KeyResult {
    match env.get(&auth.name) {
        Some(value) if !value.is_empty() => KeyResult::ok(value.clone()),
        _ => KeyResult::missing(format!("Environment variable {} is not set", auth.name)),
    }
}
