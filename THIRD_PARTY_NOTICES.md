# Third Party Notices

This repository contains WebAssembly build artifacts derived from third-party open source projects. Other Arduino/library assets are generated locally by `npm run prepare-assets`.

## Toolchain

- GCC AVR compiler components, including `cc1plus.wasm`: GNU GPL v3 or later.
- GNU binutils components, including `avr-as.wasm`, `avr-ld.wasm`, and `avr-objcopy.wasm`: GNU GPL v3 or later.
- avr-libc archive/startup objects generated into `assets/libs`: avr-libc license, generally BSD-style with project-specific notices.

The checked-in WebAssembly files were stripped of debug/custom sections and have reduced initial WebAssembly memory. Any public or product distribution should also provide the corresponding source, local patches, and build scripts used to reproduce these artifacts.

## Generated Arduino And Library Assets

The object files generated into `assets/objects` are precompiled from Arduino AVR core and Arduino libraries downloaded by `scripts/prepare-assets.mjs`. Their original licenses are controlled by their upstream projects.

Known inputs include:

- Arduino AVR core
- Servo
- Wire
- SPI
- Firmata
- Adafruit BMP085
- Adafruit BusIO
- Adafruit GFX
- Adafruit SSD1306
- DHT sensor library
- VL53L0X

## Product Firmware

The product firmware source is intentionally not included. `src/HorangFirmware.cpp` is ignored by git.
