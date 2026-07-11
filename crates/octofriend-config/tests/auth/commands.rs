use octofriend_config::auth::{
    AUTH_COMMAND_MAX_OUTPUT_BYTES, AUTH_COMMAND_TIMEOUT_MS, AuthError, CommandAuth, KeyResult,
    parse_command_stdout, validate_command_auth,
};

#[test]
fn preserves_command_auth_limits_and_cache_key_shape() {
    let auth = CommandAuth::new(["op", "read", "item"]);

    assert_eq!(AUTH_COMMAND_TIMEOUT_MS, 15_000);
    assert_eq!(AUTH_COMMAND_MAX_OUTPUT_BYTES, 16 * 1024);
    assert_eq!(auth.cache_key(), "op\0read\0item");
    assert_eq!(
        validate_command_auth(&auth),
        KeyResult::Ok {
            key: "op\0read\0item".into()
        }
    );
}

#[test]
fn rejects_empty_command_auth_and_empty_stdout() {
    assert_eq!(
        validate_command_auth(&CommandAuth::new(Vec::<String>::new())),
        KeyResult::Err {
            error: AuthError::Invalid {
                message: "Auth command is empty".into()
            }
        }
    );
    assert_eq!(
        parse_command_stdout("  \n"),
        KeyResult::Err {
            error: AuthError::Invalid {
                message: "Auth command returned empty output".into()
            }
        }
    );
    assert_eq!(
        parse_command_stdout("  secret\n"),
        KeyResult::Ok {
            key: "secret".into()
        }
    );
}
