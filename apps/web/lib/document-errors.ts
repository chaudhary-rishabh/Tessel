const MESSAGES: Record<string, string> = {
  file_missing: "The upload didn't finish. Upload the file again.",
  file_too_large: "Files can be up to 50 MB, and recordings up to 500 MB.",
  no_text: "No text was found. Scanned documents aren't supported yet.",
  unreadable_file: "The file couldn't be read. It may be damaged or password protected.",
  unsupported_encoding: "Text files must be UTF-8.",
  unsupported_file_type: "This file type isn't supported.",
  document_too_long: "This document has too much text to index.",
  daily_cost_cap_reached: "Today's AI usage limit was reached. Retry after it resets.",
  ai_not_configured: "AI isn't set up on this server yet.",
  transcription_unavailable: "Transcribing recordings isn't set up on this server yet.",
  transcription_failed:
    "This recording couldn't be transcribed. Check that it plays and has speech.",
  processing_failed: "Something went wrong while indexing. Try again.",
};

export const documentErrorMessage = (code: string | null) =>
  (code && MESSAGES[code]) ?? "Something went wrong while indexing. Try again.";
