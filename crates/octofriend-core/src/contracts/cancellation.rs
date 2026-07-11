#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct CancellationToken {
    cancelled: bool,
}

impl CancellationToken {
    pub const fn new(cancelled: bool) -> Self {
        Self { cancelled }
    }

    pub const fn is_cancelled(self) -> bool {
        self.cancelled
    }
}
