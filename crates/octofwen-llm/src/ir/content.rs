#[derive(Clone, Debug, PartialEq)]
pub enum ContentPart {
    Text { content: String },
    Image { image: ImageInfo },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImageInfo {
    pub file_path: String,
    pub mime_type: String,
    pub base64_data: String,
    pub data_url: String,
    pub size_bytes: Option<u64>,
}
