pub mod a2a;
pub mod acp;
pub mod json_rpc;
pub mod model_context;

#[cfg(test)]
mod upstream_schema_link_tests {
    use core::mem::size_of;

    #[test]
    fn links_dev_only_upstream_protocol_schema_crates() {
        assert_eq!(a2a::VERSION, "1.0");
        assert!(size_of::<agent_client_protocol_schema::v1::InitializeRequest>() > 0);
    }
}
