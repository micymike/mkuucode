// Minimal DOM-ish globals referenced by the SDK's generated fetch types that
// the extension's lib ("ES2022" + @types/node) does not provide. The SDK is
// bundled by esbuild and not type-checked at runtime; this keeps tsc happy.
type BodyInit = Blob | ArrayBuffer | FormData | URLSearchParams | string | ReadableStream