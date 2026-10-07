declare module "bs58" {
  function encode(buffer: Uint8Array): string;
  function decode(str: string): Uint8Array;
  export default { encode, decode };
}
