/** A minimal ustar archive with fixed file names; input never becomes shell text. */
export function archive(program: Buffer, input: Buffer): Buffer {
  const parts: Buffer[] = [];
  for (const [name, data, mode] of [
    ['program', program, 0o700],
    ['input', input, 0o600],
  ] as const) {
    const header = Buffer.alloc(512);
    const octal = (offset: number, length: number, value: number) => {
      header.write(`${value.toString(8).padStart(length - 1, '0')}\0`, offset, length, 'ascii');
    };
    header.write(name, 0, 100, 'ascii');
    octal(100, 8, mode);
    octal(108, 8, 65534);
    octal(116, 8, 65534);
    octal(124, 12, data.length);
    octal(136, 12, 0);
    header.fill(0x20, 148, 156);
    header.write('0', 156, 1, 'ascii');
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    const sum = header.reduce((total, byte) => total + byte, 0);
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
    parts.push(header, data);
    const padding = (512 - (data.length % 512)) % 512;
    if (padding) parts.push(Buffer.alloc(padding));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}
