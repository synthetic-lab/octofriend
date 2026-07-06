use std::collections::BTreeMap;

use octofwen_config::auth::{AuthError, EnvAuth, KeyResult, resolve_env_auth_from};

#[test]
fn resolves_non_empty_env_values_and_reports_missing_or_empty_values() {
    let mut env = BTreeMap::new();
    env.insert("OPENAI_API_KEY".into(), "sk-test".into());
    env.insert("EMPTY_KEY".into(), "".into());

    assert_eq!(
        resolve_env_auth_from(&EnvAuth::new("OPENAI_API_KEY"), &env),
        KeyResult::Ok {
            key: "sk-test".into()
        }
    );
    assert_eq!(
        resolve_env_auth_from(&EnvAuth::new("EMPTY_KEY"), &env),
        KeyResult::Err {
            error: AuthError::Missing {
                message: "Environment variable EMPTY_KEY is not set".into()
            }
        }
    );
    assert_eq!(
        resolve_env_auth_from(&EnvAuth::new("MISSING_KEY"), &env),
        KeyResult::Err {
            error: AuthError::Missing {
                message: "Environment variable MISSING_KEY is not set".into()
            }
        }
    );
}
