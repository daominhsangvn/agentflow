// Copies the Flyfish file viewer runtime assets (Workers, WASM, fonts) into
// apps/app/public/file-viewer so task file previews are served from our own origin
// (no CDN, no third-party requests). Only the office renderer groups are copied;
// the AGPL CAD runtime and other heavy groups are excluded. The payload is gitignored.
import path from "node:path";
import { copyFileViewerAssets } from "file-viewer-copy-assets";

const skip = process.env.FILE_VIEWER_SKIP_ASSET_COPY;

if (skip === "1" || skip === "true") {
  console.log("[file-viewer] asset copy skipped (FILE_VIEWER_SKIP_ASSET_COPY)");
} else {
  const targetDir = path.join(
    import.meta.dirname,
    "..",
    "public",
    "file-viewer"
  );
  const result = await copyFileViewerAssets({
    targetDir,
    clean: true,
    confirmClean: true,
    rendererIds: getOfficeRendererIds(),
  });

  if (result.validation.valid) {
    console.log(`[file-viewer] assets copied to ${targetDir}`);
  } else {
    console.error(
      `[file-viewer] missing required assets:\n${result.validation.missingRequired.join("\n")}`
    );
    process.exit(1);
  }
}

function getOfficeRendererIds() {
  return [
    "pdf",
    "office-word-openxml",
    "office-presentation",
    "office-presentation-binary",
    "spreadsheet-openxml",
    "apple-pages",
    "apple-numbers",
    "apple-keynote",
    "office-hangul",
    "office-wordperfect",
  ];
}
