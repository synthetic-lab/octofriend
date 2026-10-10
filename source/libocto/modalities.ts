export type ImageModalityConfig = {
  enabled: boolean;
  maxSizeMB: number;
  acceptedMimeTypes: string[];
};

export type MultimodalConfig = {
  image?: ImageModalityConfig;
};
