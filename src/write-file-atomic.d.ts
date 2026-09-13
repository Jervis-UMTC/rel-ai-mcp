declare module 'write-file-atomic' {
  interface WriteFileAtomicOptions {
    encoding?: BufferEncoding;
    fsync?: boolean;
    mode?: number;
  }

  function writeFileAtomic(
    filename: string,
    data: string | Uint8Array,
    options?: WriteFileAtomicOptions
  ): Promise<void>;

  function sync(
    filename: string,
    data: string | Uint8Array,
    options?: WriteFileAtomicOptions
  ): void;

  export { sync };
  export default writeFileAtomic;
}
