use octofwen_tools::shell::{
    ShellPermission, ShellPermissionDecision, ShellPermissionPolicy, ShellPermissionRule,
};

#[test]
fn exact_permission_rules_match_commands_verbatim() {
    let policy = ShellPermissionPolicy::new([ShellPermissionRule::exact(
        "cargo test --workspace",
        ShellPermission::Allow,
    )]);

    assert_eq!(
        policy.decide("cargo test --workspace"),
        ShellPermissionDecision::Matched {
            permission: ShellPermission::Allow,
            pattern: "cargo test --workspace".into(),
        }
    );
    assert_eq!(
        policy.decide("cargo test"),
        ShellPermissionDecision::NoMatch
    );
}

#[test]
fn prefix_permission_rules_match_subcommands() {
    let policy = ShellPermissionPolicy::new([ShellPermissionRule::prefix(
        "git status",
        ShellPermission::Allow,
    )]);

    assert_eq!(
        policy.decide("git status --short"),
        ShellPermissionDecision::Matched {
            permission: ShellPermission::Allow,
            pattern: "git status".into(),
        }
    );
    assert_eq!(policy.decide("git diff"), ShellPermissionDecision::NoMatch);
}

#[test]
fn deny_rules_take_precedence_over_later_allow_rules() {
    let policy = ShellPermissionPolicy::new([
        ShellPermissionRule::prefix("rm", ShellPermission::Deny),
        ShellPermissionRule::prefix("rm -rf /tmp/project", ShellPermission::Allow),
    ]);

    assert_eq!(
        policy.decide("rm -rf /tmp/project"),
        ShellPermissionDecision::Matched {
            permission: ShellPermission::Deny,
            pattern: "rm".into(),
        }
    );
}
