#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ShellPermission {
    Allow,
    Ask,
    Deny,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ShellPermissionMatch {
    Exact,
    Prefix,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShellPermissionRule {
    pub pattern: String,
    pub permission: ShellPermission,
    pub match_kind: ShellPermissionMatch,
}

impl ShellPermissionRule {
    pub fn exact(pattern: impl Into<String>, permission: ShellPermission) -> Self {
        Self {
            pattern: pattern.into(),
            permission,
            match_kind: ShellPermissionMatch::Exact,
        }
    }

    pub fn prefix(pattern: impl Into<String>, permission: ShellPermission) -> Self {
        Self {
            pattern: pattern.into(),
            permission,
            match_kind: ShellPermissionMatch::Prefix,
        }
    }

    fn matches(&self, command: &str) -> bool {
        match self.match_kind {
            ShellPermissionMatch::Exact => command == self.pattern,
            ShellPermissionMatch::Prefix => {
                command == self.pattern || command.starts_with(&format!("{} ", self.pattern))
            }
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ShellPermissionDecision {
    Matched {
        permission: ShellPermission,
        pattern: String,
    },
    NoMatch,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ShellPermissionPolicy {
    rules: Vec<ShellPermissionRule>,
}

impl ShellPermissionPolicy {
    pub fn new(rules: impl IntoIterator<Item = ShellPermissionRule>) -> Self {
        Self {
            rules: rules.into_iter().collect(),
        }
    }

    pub fn decide(&self, command: &str) -> ShellPermissionDecision {
        for rule in &self.rules {
            if rule.matches(command) {
                return ShellPermissionDecision::Matched {
                    permission: rule.permission,
                    pattern: rule.pattern.clone(),
                };
            }
        }
        ShellPermissionDecision::NoMatch
    }
}
