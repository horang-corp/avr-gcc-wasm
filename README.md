# AVR GCC WASM

Browser proof of concept for compiling Arduino AVR firmware to Intel HEX with AVR GCC and GNU binutils components built for WebAssembly.

## Prepare Assets

Third-party Arduino core, Arduino libraries, Adafruit libraries, avr-libc objects, and generated AVR object files are not committed to this repository.

Generate them from pinned upstream Arduino package/library archives:

```bash
npm run prepare-assets
```

This creates `assets/` locally. The script downloads exact versions from Arduino package indexes, verifies SHA-256 checksums, extracts headers/libraries, and compiles the fixed Arduino/library object files with the downloaded native AVR GCC toolchain. It currently expects Linux, Node.js 18+, `tar`, and `unzip`.

## Run

Put your firmware source in `src/HorangFirmware.cpp` first. That file is intentionally ignored by git.

```bash
npm run serve
```

Open `http://127.0.0.1:4173/`.

The browser API is exposed on the page:

```js
const result = await buildFirmware([SENSOR.OLED, SENSOR.TOF]);
console.log(result.hex);
```

The UI creates a fresh Worker for each build and terminates it after completion. This makes memory reclamation more predictable on low-end devices.

## Current Result

The build runs fully in the browser through a module Worker:

1. `cc1plus.wasm` compiles `src/HorangFirmware.cpp` with `-DUSE_OLED` and `-DUSE_TOF`.
2. `avr-as.wasm` assembles the generated AVR assembly.
3. `avr-ld.wasm` links the firmware object with precompiled Arduino core and library objects.
4. `avr-objcopy.wasm` emits Intel HEX.

Generated Arduino core and library objects live in `assets/objects`. They are selected by sensor group at link time, so unused sensor libraries are not linked into the output.

The product firmware source used during local validation is not included in this repository.

## Measured In Chrome

Measured on this machine through `agent-browser` against `http://127.0.0.1:4173/`.

| Sensors | Flash bytes | HEX text bytes | Linked objects | Wall time |
| --- | ---: | ---: | ---: | ---: |
| base | 23,914 | 67,276 | 30 | 1.09s |
| TOF | 28,024 | 78,837 | 31 | 0.66s |
| OLED | 33,768 | 95,005 | 32 | 0.62s |
| OLED + TOF | 37,878 | 106,553 | 33 | 0.63s |

For `arduino:avr:uno`, the sketch upload budget is treated as 32,256 bytes. That means TOF fits, while OLED and OLED + TOF do not fit on the Uno-class target.

## Bundle And Memory

Generated uncompressed local asset size after `npm run prepare-assets`:

- `tools`: 17 MB
- `assets`: about 38 MB
- total generated runtime bundle inputs: about 55 MB

The original unstripped WASM tools were about 106 MB. After removing DWARF/custom debug sections, `tools/cc1plus.wasm` is about 14 MB and the binutils tools are about 0.7-1.1 MB each.

Initial WebAssembly linear memory was also reduced:

| Tool | Original initial memory | Current initial memory |
| --- | ---: | ---: |
| `cc1plus.wasm` | 256 MB | 4 MB |
| `avr-as.wasm` | 128 MB | 4 MB |
| `avr-ld.wasm` | 128 MB | 4 MB |
| `avr-objcopy.wasm` | 128 MB | 4 MB |

`ALLOW_MEMORY_GROWTH` is still enabled, so each tool can grow when needed. A 2 MB initial memory also passed the current OLED + TOF build, but 1 MB fails during instantiation because static data no longer fits. The checked-in value is kept at 4 MB for margin.

Measured linear-memory peaks in Chrome after growth:

| Sensors | `cc1plus` peak | `avr-ld` peak | Sequential tool total |
| --- | ---: | ---: | ---: |
| base | 40.8 MB | 7.0 MB | 55.8 MB |
| TOF | 40.8 MB | 7.0 MB | 55.8 MB |
| OLED | 40.8 MB | 7.0 MB | 55.8 MB |
| OLED + TOF | 40.8 MB | 7.0 MB | 55.8 MB |

The real tab/worker footprint is higher than these linear-memory numbers because the browser also holds fetched assets, MEMFS file contents, JS objects, compiled WebAssembly code, and output buffers.

Production should still add HTTP compression, long-lived cache headers, and possibly Cache Storage/IndexedDB preloading.

## Notes

- This does not run QEMU. The actual AVR compiler pieces are WebAssembly modules.
- The GCC driver is not used in-browser because it depends on process behavior such as `vfork`. The browser path drives `cc1plus`, assembler, linker, and objcopy directly.
- The firmware source should allow `USE_OLED` and `USE_TOF` to be overridden from the compiler command line.
- `assets/ldscripts/avr5.xn` and `assets/objects/core_abi.o` are generated because `avr-ld` and `Adafruit_GFX` need them when running/linking in the browser bundle.
- See `THIRD_PARTY_NOTICES.md` before using these artifacts in a public or commercial distribution.
