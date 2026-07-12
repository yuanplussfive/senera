export type ImageVisionToolArguments = {
  // Opaque upload handle copied from an attachment, for example "senera://upload/upl_0123abcd".
  uploadUri: string;

  // The visual task requested by the user, such as "describe", "ocr", "inspect-ui", or "answer-question".
  task: string;

  // Optional natural-language question about the image.
  question?: string;
};

export type ImageVisionToolResult = {
  images: {
    item: Array<{
      uploadUri: string;
      status: "analyzed" | "not_found";
      task: string;
      question?: string;
      name?: string;
      mime?: string;
      size?: number;
      answer: string;
      providerId?: string;
      providerEndpoint?: string;
      providerModel?: string;
      message: string;
    }>;
  };
};
